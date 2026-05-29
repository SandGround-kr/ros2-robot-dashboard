const express      = require('express');
const WebSocket    = require('ws');
const http         = require('http');
const path         = require('path');
const fs           = require('fs');
const { spawn }    = require('child_process');
const multer       = require('multer');
const os           = require('os');

const SAVE_DIR = path.join(process.env.HOME, 'slam_saves');
fs.mkdirSync(SAVE_DIR, { recursive: true });

const app    = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════
// 파일 다운로드
// ════════════════════════════════════════
app.get('/download/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(SAVE_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: '파일 없음' });
    if (fs.statSync(filepath).isDirectory()) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
        res.setHeader('Content-Type', 'application/zip');
        const zip = spawn('zip', ['-r', '-', filename], { cwd: SAVE_DIR });
        zip.stdout.pipe(res);
        zip.stderr.on('data', d => console.error('[zip]', d.toString()));
        zip.on('error', err => { if (!res.headersSent) res.status(500).send('zip 실패'); });
    } else {
        res.download(filepath, filename);
    }
});

// ════════════════════════════════════════
// Replay 페이지
// ════════════════════════════════════════
app.get('/replay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'replay.html'));
});

// ════════════════════════════════════════
// Bag 목록 API
// ════════════════════════════════════════
app.get('/api/bags', (req, res) => {
    try {
        if (!fs.existsSync(SAVE_DIR)) return res.json([]);
        const result = [];
        const items  = fs.readdirSync(SAVE_DIR);
        items.forEach(name => {
            const fpath = path.join(SAVE_DIR, name);
            try {
                if (!fs.statSync(fpath).isDirectory() || !name.startsWith('bag_')) return;
                const files = fs.readdirSync(fpath);
                const db3   = files.find(f => f.endsWith('.db3'));
                const total = files.reduce((acc, f) => {
                    try {
                        const fp = path.join(fpath, f);
                        return acc + (fs.statSync(fp).isFile() ? fs.statSync(fp).size : 0);
                    } catch { return acc; }
                }, 0);
                result.push({
                    name,
                    path:   fpath,
                    size:   `${(total / 1024 / 1024).toFixed(1)} MB`,
                    time:   new Date(fs.statSync(fpath).mtime).toLocaleString('ko-KR'),
                    hasDb3: !!db3,
                });
            } catch { }
        });
        res.json(result.sort((a, b) => b.name.localeCompare(a.name)));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ════════════════════════════════════════
// Bag 재생 / 정지 / 상태
// ════════════════════════════════════════
let bagPlayProcess = null;
let bagPlayFile    = null;

function broadcastToBrowsers(payload) {
    const msg = JSON.stringify(payload);
    clients.pointcloud.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
    clients.meta.forEach(c =>       { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

app.post('/api/bag/play', express.json(), (req, res) => {
    const { bagPath, rate } = req.body;
    if (!bagPath || !fs.existsSync(bagPath))
        return res.status(404).json({ error: `경로 없음: ${bagPath}` });

    if (bagPlayProcess && bagPlayProcess.exitCode === null) {
        bagPlayProcess.kill('SIGINT');
        bagPlayProcess = null;
    }

    const playRate = parseFloat(rate) || 1.0;
    console.log(`[bag play] ${bagPath} (rate: ${playRate})`);

    bagPlayProcess = spawn('ros2', ['bag', 'play', bagPath, '--rate', String(playRate)],
        { env: { ...process.env } });
    bagPlayFile = bagPath;

    bagPlayProcess.stdout.on('data', d => process.stdout.write(`[bag] ${d}`));
    bagPlayProcess.stderr.on('data', d => process.stderr.write(`[bag] ${d}`));

    bagPlayProcess.on('exit', code => {
        console.log(`[bag play] 종료 (code: ${code})`);
        bagPlayProcess = null;
        bagPlayFile    = null;
        broadcastToBrowsers({ type: 'bag_play_status', playing: false });
    });
    bagPlayProcess.on('error', err => {
        bagPlayProcess = null;
        bagPlayFile    = null;
        broadcastToBrowsers({ type: 'bag_play_status', playing: false });
    });

    broadcastToBrowsers({ type: 'bag_play_status', playing: true, file: path.basename(bagPath) });
    res.json({ ok: true });
});

app.post('/api/bag/stop', (req, res) => {
    if (bagPlayProcess) {
        bagPlayProcess.kill('SIGINT');
        bagPlayProcess = null;
        bagPlayFile    = null;
    }
    broadcastToBrowsers({ type: 'bag_play_status', playing: false });
    res.json({ ok: true });
});

app.get('/api/bag/status', (req, res) => {
    res.json({
        playing: bagPlayProcess !== null && bagPlayProcess.exitCode === null,
        file:    bagPlayFile ? path.basename(bagPlayFile) : null,
    });
});

// ════════════════════════════════════════
// 업로드 (로컬 db3)
// ════════════════════════════════════════
const UPLOAD_DIR = path.join(os.tmpdir(), 'replay_upload');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!req.sessionDir) {
            req.sessionDir = path.join(UPLOAD_DIR, `upload_${Date.now()}`);
            fs.mkdirSync(req.sessionDir, { recursive: true });
        }
        cb(null, req.sessionDir);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.db3') || file.originalname.endsWith('.yaml'))
            cb(null, true);
        else
            cb(new Error('.db3 또는 .yaml 파일만 가능'));
    }
});

app.post('/api/upload', upload.array('files'), (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ error: '파일 없음' });
        const db3 = req.files.find(f => f.originalname.endsWith('.db3'));
        if (!db3) return res.status(400).json({ error: '.db3 파일 필요' });
        const bagPath = path.dirname(db3.path);
        const size    = req.files.reduce((a, f) => a + f.size, 0);
        console.log(`[upload] ${db3.originalname} → ${bagPath}`);
        res.json({
            ok: true, bagPath,
            name: path.basename(bagPath),
            size: `${(size / 1024 / 1024).toFixed(1)} MB`,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ════════════════════════════════════════
// WebSocket — 기존 구조 그대로
// ════════════════════════════════════════
const wss = new WebSocket.Server({ server });

const BRIDGES = {
    pointcloud: 'ws://localhost:9090',
    camera:     'ws://localhost:9091',
    meta:       'ws://localhost:9092',
    cmd:        'ws://localhost:9093',
};

const latest = { pointcloud: null, camera: null };
const clients = {
    pointcloud: new Set(),
    camera:     new Set(),
    meta:       new Set(),
    cmd:        new Set(),
};
const bridgeSockets = {};

function connectBridge(type) {
    const socket = new WebSocket(BRIDGES[type]);
    bridgeSockets[type] = socket;

    socket.on('open', () => console.log(`[${type}] 브리지 연결`));

    socket.on('message', (data) => {
        if (type === 'camera') {
            latest.camera = data;
            clients.camera.forEach(c => {
                if (c.readyState === WebSocket.OPEN) c.send(data);
            });
        } else {
            const msg = data.toString('utf8');
            if (type === 'pointcloud') latest.pointcloud = msg;
            clients[type].forEach(c => {
                if (c.readyState === WebSocket.OPEN) c.send(msg);
            });
        }
    });

    socket.on('close', () => {
        console.log(`[${type}] 브리지 끊김. 3초 후 재연결`);
        bridgeSockets[type] = null;
        setTimeout(() => connectBridge(type), 3000);
    });
    socket.on('error', err => console.log(`[${type}] 오류:`, err.message));
}

wss.on('connection', (ws, req) => {
    const url  = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type') || 'pointcloud';
    if (!clients[type]) { ws.close(); return; }

    clients[type].add(ws);

    if (type === 'pointcloud' && latest.pointcloud) ws.send(latest.pointcloud);
    if (type === 'camera'     && latest.camera)     ws.send(latest.camera);

    if (type === 'cmd') {
        ws.on('message', (data) => {
            const bridge = bridgeSockets['cmd'];
            if (bridge && bridge.readyState === WebSocket.OPEN) {
                bridge.send(data.toString('utf8'));
            }
        });
    }

    ws.on('close', () => clients[type].delete(ws));
});

Object.keys(BRIDGES).forEach(connectBridge);

server.listen(3000, '0.0.0.0', () =>
    console.log('웹 서버: http://0.0.0.0:3000'));