const express = require('express');
const router = express.Router();
const registry = require('../robots/RobotRegistry');
const RobotConnection = require('../robots/RobotConnection');
const { loadRobotsConfig, saveRobotsConfig, healthCheckInterval } = require('../config');

// SSE 클라이언트 목록
const sseClients = new Set();

// GET /api/robots - 전체 로봇 목록
router.get('/robots', (req, res) => {
  res.json(registry.getAll());
});

// POST /api/robots - 로봇 동적 추가
router.post('/robots', (req, res) => {
  const { id, name, host, port } = req.body;
  if (!id || !host) return res.status(400).json({ error: 'id, host 필수' });
  if (registry.get(id)) return res.status(409).json({ error: '이미 존재하는 ID' });

  const robot = { id, name: name || id, host, port: port || 9090 };
  registry.add(robot);

  const config = loadRobotsConfig();
  config.robots.push(robot);
  saveRobotsConfig(config);

  // 연결 시작
  const interval = req.app.get('healthCheckInterval') || 5000;
  const conn = new RobotConnection(robot, interval);
  req.app.get('connections').set(id, conn);

  res.status(201).json(registry.get(id));
});

// DELETE /api/robots/:id - 로봇 제거
router.delete('/robots/:id', (req, res) => {
  const { id } = req.params;
  const conn = req.app.get('connections').get(id);
  if (conn) {
    conn.destroy();
    req.app.get('connections').delete(id);
  }
  registry.remove(id);

  const config = loadRobotsConfig();
  config.robots = config.robots.filter((r) => r.id !== id);
  saveRobotsConfig(config);

  res.json({ ok: true });
});

// GET /api/robots/:id/status - 특정 로봇 상태
router.get('/robots/:id/status', (req, res) => {
  const record = registry.get(req.params.id);
  if (!record) return res.status(404).json({ error: '로봇을 찾을 수 없습니다' });
  res.json(record);
});

// GET /api/events - SSE 스트림
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 현재 상태 즉시 전송
  const robots = registry.getAll();
  res.write(`event: init\ndata: ${JSON.stringify(robots)}\n\n`);

  sseClients.add(res);

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// 레지스트리 이벤트 → SSE 브로드캐스트
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

registry.on('robot_status', (data) => broadcast('robot_status', data));
registry.on('robot_added', (data) => broadcast('robot_added', data));
registry.on('robot_removed', (data) => broadcast('robot_removed', data));

module.exports = router;
