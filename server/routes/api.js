const express  = require('express');
const router   = express.Router();
const registry = require('../robots/RobotRegistry');

// SSE 클라이언트 목록
const sseClients = new Set();

// GET /api/robots - 로봇 정보 (단일)
router.get('/robots', (req, res) => {
  res.json(registry.getAll());
});

// GET /api/robots/local/status
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

  const robots = registry.getAll();
  res.write(`event: init\ndata: ${JSON.stringify(robots)}\n\n`);

  sseClients.add(res);
  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

registry.on('robot_status', (data) => broadcast('robot_status', data));

module.exports = router;
