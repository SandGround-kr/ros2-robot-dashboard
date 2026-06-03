const express  = require('express');
const router   = express.Router();
const https    = require('https');
const { exec, spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');

const ROOT = path.join(__dirname, '../..');
const REPO = 'SandGround-kr/ros2-robot-dashboard';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ros2-dashboard-updater' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => res.statusCode < 400 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}`)));
    }).on('error', reject);
  });
}

function semverGt(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// GET /api/update/check
router.get('/check', async (req, res) => {
  try {
    const localRaw = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');
    const local    = JSON.parse(localRaw);

    const remoteRaw = await httpsGet(
      `https://raw.githubusercontent.com/${REPO}/master/version.json`
    );
    const remote = JSON.parse(remoteRaw);

    const hasUpdate = semverGt(remote.version, local.version);

    let commits = [];
    if (hasUpdate) {
      try {
        const apiData = await httpsGet(
          `https://api.github.com/repos/${REPO}/commits?per_page=10`
        );
        commits = JSON.parse(apiData).slice(0, 8).map(c => ({
          sha:     c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          date:    c.commit.author.date.slice(0, 10),
        }));
      } catch (_) {}
    }

    res.json({ current: local.version, latest: remote.version, hasUpdate, commits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/update/apply
router.post('/apply', (req, res) => {
  exec('git pull origin master', { cwd: ROOT }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }

    res.json({ success: true, output: stdout.trim() });

    // npm install 후 재시작
    exec('npm install --production', { cwd: ROOT }, () => {
      setTimeout(() => {
        const child = spawn(process.execPath, [process.argv[1]], {
          cwd:      ROOT,
          detached: true,
          stdio:    'ignore',
          env:      process.env,
        });
        child.unref();
        process.exit(0);
      }, 600);
    });
  });
});

module.exports = router;
