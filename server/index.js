const express = require('express');
const cors    = require('cors');
const path    = require('path');
const config  = require('./config');
const registry = require('./robots/RobotRegistry');
const RobotConnection = require('./robots/RobotConnection');
const apiRouter    = require('./routes/api');
const rosbagRouter = require('./routes/rosbag');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const connections = new Map();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.set('connections', connections);
app.set('healthCheckInterval', config.healthCheckInterval);

app.use('/api', apiRouter);
app.use('/api', rosbagRouter);
app.use(errorHandler);

// ── 로컬 로봇 자동 등록 (.env 기반) ────────────────────────
const robot = {
  id:   'local',
  name: config.robotName,
  host: config.rosbridgeHost,
  port: config.rosbridgePort,
};
registry.add(robot);
connections.set(robot.id, new RobotConnection(robot, config.healthCheckInterval));

app.listen(config.port, () => {
  console.log(`ROS2 Dashboard 서버 실행: http://localhost:${config.port}`);
  console.log(`rosbridge 연결 대상: ws://${robot.host}:${robot.port}  (${robot.name})`);
});
