/**
 * rosbag.js — 로봇별 rosbag 녹화 + 전역 재생 관리
 *
 * 전제: 이 서버가 ROS2 네트워크에 접근 가능한 환경에서 실행됨.
 * 다중 로봇이 네임스페이스(/robot1/..., /robot2/...)로 구분된다면
 * topics 배열에 해당 네임스페이스 토픽들을 넘기면 됨.
 */
const express   = require('express');
const router    = express.Router();
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');

const SAVE_DIR = process.env.BAG_SAVE_DIR || path.join(os.homedir(), 'ros2_bags');
fs.mkdirSync(SAVE_DIR, { recursive: true });

// robotId → { process, startTime, filename, topics }
const recordings = new Map();

// 전역 재생 프로세스 (한 번에 하나)
let playProcess = null;
let playFile    = null;
let playClients = new Set(); // SSE 클라이언트

// ─── 헬퍼 ────────────────────────────────────────────────────
function broadcastPlayStatus(playing, file) {
  const payload = `event: bag_play_status\ndata: ${JSON.stringify({ playing, file })}\n\n`;
  for (const res of playClients) res.write(payload);
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function bagDirSize(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    return files.reduce((acc, f) => {
      try { return acc + fs.statSync(path.join(dirPath, f)).size; } catch { return acc; }
    }, 0);
  } catch { return 0; }
}

// ─── 저장된 bag 목록 ─────────────────────────────────────────
router.get('/bags', (req, res) => {
  try {
    if (!fs.existsSync(SAVE_DIR)) return res.json([]);
    const result = [];
    for (const name of fs.readdirSync(SAVE_DIR).sort().reverse()) {
      const fullPath = path.join(SAVE_DIR, name);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory() || !name.startsWith('bag_')) continue;
        const files  = fs.readdirSync(fullPath);
        const hasDb3 = files.some(f => f.endsWith('.db3'));
        const size   = bagDirSize(fullPath);
        result.push({
          name,
          path: fullPath,
          size: `${(size / 1024 / 1024).toFixed(1)} MB`,
          time: new Date(stat.mtime).toLocaleString('ko-KR'),
          hasDb3,
        });
      } catch { /* skip */ }
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── bag 파일 다운로드 ────────────────────────────────────────
router.get('/download/:filename', (req, res) => {
  const name     = path.basename(req.params.filename);
  const fullPath = path.join(SAVE_DIR, name);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '파일 없음' });

  if (fs.statSync(fullPath).isDirectory()) {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const zip = spawn('zip', ['-r', '-', name], { cwd: SAVE_DIR });
    zip.stdout.pipe(res);
    zip.stderr.on('data', d => console.error('[zip]', d.toString()));
    zip.on('error', err => { if (!res.headersSent) res.status(500).send('zip 실패'); });
  } else {
    res.download(fullPath, name);
  }
});

// ─── 로봇별 녹화 시작 ─────────────────────────────────────────
router.post('/robots/:id/bag/start', express.json(), (req, res) => {
  const { id } = req.params;
  const { topics = [] } = req.body; // [] 이면 전체 토픽 녹화

  if (recordings.has(id)) {
    const rec = recordings.get(id);
    if (rec.process && rec.process.exitCode === null) {
      return res.status(409).json({ error: '이미 녹화 중' });
    }
  }

  const filename = `bag_${id}_${ts()}`;
  const bagPath  = path.join(SAVE_DIR, filename);
  const args     = ['bag', 'record', '-o', bagPath];

  if (topics.length > 0) {
    args.push(...topics);
  } else {
    args.push('-a'); // 전체 토픽
  }

  console.log(`[rosbag] 녹화 시작 (${id}):`, args.join(' '));

  const proc = spawn('ros2', args, { env: { ...process.env } });
  proc.stdout.on('data', d => process.stdout.write(`[bag:${id}] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[bag:${id}] ${d}`));

  recordings.set(id, {
    process:   proc,
    startTime: Date.now(),
    filename,
    topics,
  });

  proc.on('exit', () => {
    const rec = recordings.get(id);
    if (rec && rec.filename === filename) recordings.delete(id);
  });
  proc.on('error', () => recordings.delete(id));

  res.json({ ok: true, filename });
});

// ─── 로봇별 녹화 중지 ─────────────────────────────────────────
router.post('/robots/:id/bag/stop', (req, res) => {
  const { id } = req.params;
  const rec = recordings.get(id);

  if (!rec || !rec.process || rec.process.exitCode !== null) {
    return res.status(400).json({ error: '녹화 중이 아님' });
  }

  rec.process.kill('SIGINT');
  const elapsed = Math.round((Date.now() - rec.startTime) / 1000);
  const info    = `${rec.filename} (${elapsed}s)`;
  recordings.delete(id);

  res.json({ ok: true, info });
});

// ─── 로봇별 녹화 상태 ─────────────────────────────────────────
router.get('/robots/:id/bag/status', (req, res) => {
  const { id } = req.params;
  const rec    = recordings.get(id);
  const recording = !!rec && !!rec.process && rec.process.exitCode === null;
  res.json({
    recording,
    filename:  recording ? rec.filename  : null,
    elapsed:   recording ? Math.round((Date.now() - rec.startTime) / 1000) : 0,
    topics:    recording ? rec.topics    : [],
  });
});

// ─── 전체 녹화 상태 목록 ──────────────────────────────────────
router.get('/bag/recordings', (req, res) => {
  const list = [];
  for (const [id, rec] of recordings) {
    if (rec.process && rec.process.exitCode === null) {
      list.push({
        robotId:  id,
        filename: rec.filename,
        elapsed:  Math.round((Date.now() - rec.startTime) / 1000),
        topics:   rec.topics,
      });
    }
  }
  res.json(list);
});

// ─── bag 재생 ────────────────────────────────────────────────
router.post('/bag/play', express.json(), (req, res) => {
  const { bagPath, rate = 1.0 } = req.body;
  if (!bagPath || !fs.existsSync(bagPath)) {
    return res.status(404).json({ error: `경로 없음: ${bagPath}` });
  }

  if (playProcess && playProcess.exitCode === null) {
    playProcess.kill('SIGINT');
  }

  const playRate = parseFloat(rate) || 1.0;
  console.log(`[bag play] ${bagPath} (rate: ${playRate})`);

  playProcess = spawn('ros2', ['bag', 'play', bagPath, '--rate', String(playRate)],
    { env: { ...process.env } });
  playFile = bagPath;

  playProcess.stdout.on('data', d => process.stdout.write(`[play] ${d}`));
  playProcess.stderr.on('data', d => process.stderr.write(`[play] ${d}`));

  playProcess.on('exit', () => {
    playProcess = null;
    playFile    = null;
    broadcastPlayStatus(false, null);
  });
  playProcess.on('error', () => {
    playProcess = null;
    playFile    = null;
    broadcastPlayStatus(false, null);
  });

  broadcastPlayStatus(true, path.basename(bagPath));
  res.json({ ok: true });
});

// ─── bag 재생 중지 ────────────────────────────────────────────
router.post('/bag/stop', (req, res) => {
  if (playProcess) {
    playProcess.kill('SIGINT');
    playProcess = null;
    playFile    = null;
  }
  broadcastPlayStatus(false, null);
  res.json({ ok: true });
});

// ─── bag 재생 상태 ────────────────────────────────────────────
router.get('/bag/status', (req, res) => {
  res.json({
    playing: !!playProcess && playProcess.exitCode === null,
    file:    playFile ? path.basename(playFile) : null,
  });
});

// ─── bag 재생 SSE ─────────────────────────────────────────────
router.get('/bag/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 현재 상태 즉시 전송
  const playing = !!playProcess && playProcess.exitCode === null;
  res.write(`event: bag_play_status\ndata: ${JSON.stringify({
    playing, file: playFile ? path.basename(playFile) : null
  })}\n\n`);

  playClients.add(res);
  const hb = setInterval(() => res.write(':hb\n\n'), 30000);
  req.on('close', () => { clearInterval(hb); playClients.delete(res); });
});

module.exports = router;
