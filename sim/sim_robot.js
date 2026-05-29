/**
 * sim_robot.js — rosbridge 호환 시뮬레이션 로봇 (맵 + 실제 LiDAR)
 *
 * 사용법: node sim/sim_robot.js [--port 9095] [--name sim1] [--ns /sim1]
 */
const WebSocket = require('ws');

const args = process.argv.slice(2);
function getArg(k, d) { const i = args.indexOf(k); return i !== -1 && args[i+1] ? args[i+1] : d; }
const PORT       = parseInt(getArg('--port', '9095'));
const ROBOT_NAME = getArg('--name', 'sim_robot');
const NS         = getArg('--ns', '');
const t          = name => NS ? `${NS}${name}` : name;

// ═══════════════════════════════════════════
// 환경 맵 (벽 세그먼트 [x1,y1,x2,y2])
// ═══════════════════════════════════════════
const MAP_WALLS = [
  // 외벽 (20×20 방)
  [-10,-10,  10,-10],
  [ 10,-10,  10, 10],
  [ 10, 10, -10, 10],
  [-10, 10, -10,-10],
  // 칸막이 1 (좌측 복도)
  [-6, -10, -6,  2],
  [-6,   4, -6, 10],
  // 칸막이 2 (중앙 방)
  [-6,  2,   0,  2],
  [ 0,  2,   0, -4],
  // 칸막이 3 (우측 방)
  [ 4, -10,  4,  0],
  [ 4,   0,  8,  0],
  // 장애물 박스들
  [-3, -7,  -1, -7],
  [-3, -7,  -3, -5],
  [-1, -7,  -1, -5],
  [-3, -5,  -1, -5],

  [ 6,  4,   8,  4],
  [ 6,  4,   6,  8],
  [ 8,  4,   8,  8],
  [ 6,  8,   8,  8],

  [ 1,  5,   3,  5],
  [ 1,  5,   1,  9],
  [ 3,  5,   3,  9],
  [ 1,  9,   3,  9],
];

// 맵 메타 (웹 렌더러에 전송)
const MAP_META = {
  walls:    MAP_WALLS,
  width:    20,
  height:   20,
  origin_x: -10,
  origin_y: -10,
};

// ═══════════════════════════════════════════
// LiDAR 레이캐스팅
// ═══════════════════════════════════════════
function raySegmentDist(rx, ry, angle, x1, y1, x2, y2) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const ex = x2 - x1,        ey = y2 - y1;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return Infinity;
  const t = ((x1 - rx) * ey - (y1 - ry) * ex) / denom;
  const u = ((x1 - rx) * dy - (y1 - ry) * dx) / denom;
  if (t >= 0.01 && u >= 0 && u <= 1) return t;
  return Infinity;
}

function castRay(rx, ry, angle, maxRange) {
  let minDist = maxRange;
  for (const [x1,y1,x2,y2] of MAP_WALLS) {
    const d = raySegmentDist(rx, ry, angle, x1, y1, x2, y2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ═══════════════════════════════════════════
// 충돌 감지
// ═══════════════════════════════════════════
const ROBOT_RADIUS = 0.3;

function pointSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx*dx + dy*dy;
  if (len2 < 1e-10) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px-x1)*dx + (py-y1)*dy) / len2));
  return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
}

function isColliding(nx, ny) {
  for (const [x1,y1,x2,y2] of MAP_WALLS) {
    if (pointSegmentDist(nx, ny, x1, y1, x2, y2) < ROBOT_RADIUS) return true;
  }
  return false;
}

// ═══════════════════════════════════════════
// 로봇 상태
// ═══════════════════════════════════════════
const state = {
  x: 0, y: 0, theta: 0,
  vx: 0, vtheta: 0,
  battery: 85.0,
  logSeq: 0,
};

// ═══════════════════════════════════════════
// 토픽 목록
// ═══════════════════════════════════════════
const TOPICS = {
  [t('/odom')]:           'nav_msgs/msg/Odometry',
  [t('/scan')]:           'sensor_msgs/msg/LaserScan',
  [t('/imu/data')]:       'sensor_msgs/msg/Imu',
  [t('/battery_state')]:  'sensor_msgs/msg/BatteryState',
  [t('/cmd_vel')]:        'geometry_msgs/msg/Twist',
  [t('/rosout')]:         'rcl_interfaces/msg/Log',
  [t('/tf')]:             'tf2_msgs/msg/TFMessage',
  [t('/map_meta')]:       'std_msgs/msg/String',
  [t('/pose')]:           'geometry_msgs/msg/Pose2D',
};
const NODES = [
  `/${ROBOT_NAME}`, `/${ROBOT_NAME}/controller`,
  `/${ROBOT_NAME}/lidar_driver`, `/${ROBOT_NAME}/imu_driver`, '/rosapi',
];

// ═══════════════════════════════════════════
// 구독자 관리
// ═══════════════════════════════════════════
const subscribers = new Map();

function addSub(topicName, ws, subId) {
  if (!subscribers.has(topicName)) subscribers.set(topicName, new Set());
  subscribers.get(topicName).add({ ws, id: subId });
}
function removeSub(subId) {
  for (const [, set] of subscribers)
    for (const e of set) if (e.id === subId) { set.delete(e); break; }
}
function pub(topicName, msg) {
  const set = subscribers.get(topicName);
  if (!set || !set.size) return;
  const p = JSON.stringify({ op: 'publish', topic: topicName, msg });
  for (const { ws } of set)
    if (ws.readyState === WebSocket.OPEN) ws.send(p);
}

// ═══════════════════════════════════════════
// 메시지 생성
// ═══════════════════════════════════════════
function stamp() {
  const n = Date.now();
  return { sec: Math.floor(n/1000), nanosec: (n%1000)*1e6 };
}
function quat(theta) {
  return { x: 0, y: 0, z: Math.sin(theta/2), w: Math.cos(theta/2) };
}

function makeOdom() {
  return {
    header: { stamp: stamp(), frame_id: 'odom' },
    child_frame_id: `${NS || ''}/base_link`,
    pose: { pose: { position: { x: state.x, y: state.y, z: 0 }, orientation: quat(state.theta) }, covariance: Array(36).fill(0) },
    twist: { twist: { linear: { x: state.vx, y: 0, z: 0 }, angular: { x: 0, y: 0, z: state.vtheta } }, covariance: Array(36).fill(0) },
  };
}

const SCAN_COUNT = 360;
function makeScan() {
  const ranges = [];
  for (let i = 0; i < SCAN_COUNT; i++) {
    const angle = state.theta + (i / SCAN_COUNT) * Math.PI * 2 - Math.PI;
    const d = castRay(state.x, state.y, angle, 10.0);
    ranges.push(d + (Math.random() - 0.5) * 0.02);
  }
  return {
    header: { stamp: stamp(), frame_id: `${NS || ''}/laser` },
    angle_min: -Math.PI, angle_max: Math.PI,
    angle_increment: (Math.PI * 2) / SCAN_COUNT,
    time_increment: 0, scan_time: 0.1,
    range_min: 0.1, range_max: 10.0,
    ranges, intensities: [],
  };
}

function makeImu() {
  return {
    header: { stamp: stamp(), frame_id: `${NS || ''}/imu` },
    orientation: quat(state.theta),
    orientation_covariance: Array(9).fill(0),
    angular_velocity:    { x: 0, y: 0, z: state.vtheta + (Math.random()-0.5)*0.001 },
    angular_velocity_covariance: Array(9).fill(0),
    linear_acceleration: { x: (Math.random()-0.5)*0.01, y: (Math.random()-0.5)*0.01, z: 9.81 },
    linear_acceleration_covariance: Array(9).fill(0),
  };
}

function makeBattery() {
  return {
    header: { stamp: stamp(), frame_id: `${NS || ''}/battery` },
    voltage: 12.0 + (state.battery/100)*4.0,
    temperature: 25.0 + Math.random()*2,
    current: -(0.5 + Math.abs(state.vx)*2 + Math.abs(state.vtheta)),
    percentage: state.battery / 100.0,
    power_supply_status: 1, power_supply_health: 1,
    power_supply_technology: 2, present: true,
    charge: -1, capacity: -1, design_capacity: 10.0,
  };
}

function makeLog(level, msg) {
  return { stamp: stamp(), level, name: `/${ROBOT_NAME}`, msg, file: 'sim_robot.js', function: 'simulate', line: 0 };
}

function makePose() {
  return { x: state.x, y: state.y, theta: state.theta };
}

function makeMapMeta() {
  return { data: JSON.stringify(MAP_META) };
}

// ═══════════════════════════════════════════
// 물리 시뮬레이션 (50 Hz)
// ═══════════════════════════════════════════
const DT = 0.02;
setInterval(() => {
  const nx = state.x + state.vx * Math.cos(state.theta) * DT;
  const ny = state.y + state.vx * Math.sin(state.theta) * DT;
  if (!isColliding(nx, ny)) {
    state.x = nx;
    state.y = ny;
  } else {
    // 충돌 시 속도 제거
    state.vx = 0;
  }
  state.theta += state.vtheta * DT;
  state.theta = ((state.theta + Math.PI) % (Math.PI * 2)) - Math.PI;
  const load = Math.abs(state.vx) + Math.abs(state.vtheta) * 0.3;
  state.battery = Math.max(0, state.battery - load * 0.0001);
}, DT * 1000);

// ═══════════════════════════════════════════
// 토픽 발행 타이머
// ═══════════════════════════════════════════
setInterval(() => pub(t('/odom'),    makeOdom()),    100);   // 10 Hz
setInterval(() => pub(t('/scan'),    makeScan()),    200);   //  5 Hz
setInterval(() => pub(t('/imu/data'), makeImu()),   50);    // 20 Hz
setInterval(() => pub(t('/battery_state'), makeBattery()), 1000);
setInterval(() => pub(t('/pose'),    makePose()),   100);
setInterval(() => pub(t('/tf'),      {
  transforms: [{
    header: { stamp: stamp(), frame_id: 'odom' },
    child_frame_id: `${NS||''}/base_link`,
    transform: { translation: { x:state.x, y:state.y, z:0 }, rotation: quat(state.theta) },
  }]
}), 100);

// 맵 메타 (처음 구독 시 한 번 + 주기적으로)
setInterval(() => pub(t('/map_meta'), makeMapMeta()), 5000);

// 주기적 로그
const LOGS = [
  [20, () => `정상 작동 중 | x:${state.x.toFixed(2)} y:${state.y.toFixed(2)} θ:${(state.theta*(180/Math.PI)).toFixed(1)}°`],
  [20, () => `배터리: ${state.battery.toFixed(1)}% | v:${state.vx.toFixed(2)}m/s ω:${state.vtheta.toFixed(2)}rad/s`],
  [30, () => `LiDAR 전방 거리: ${castRay(state.x, state.y, state.theta, 10).toFixed(2)}m`],
];
let logIdx = 0;
setInterval(() => {
  const [level, fn] = LOGS[logIdx++ % LOGS.length];
  pub(t('/rosout'), makeLog(level, fn()));
}, 2000);

// ═══════════════════════════════════════════
// rosbridge WebSocket 서버
// ═══════════════════════════════════════════
const wss = new WebSocket.Server({ port: PORT });

wss.on('listening', () => {
  console.log(`[${ROBOT_NAME}] rosbridge mock 시작: ws://0.0.0.0:${PORT}`);
  console.log(`[${ROBOT_NAME}] 맵: ${MAP_WALLS.length}개 벽 세그먼트, 20×20m`);
  console.log(`[${ROBOT_NAME}] 토픽: ${Object.keys(TOPICS).join(', ')}`);
});

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[${ROBOT_NAME}] 연결: ${ip}`);

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { op } = msg;

    if (op === 'subscribe') {
      addSub(msg.topic, ws, msg.id || msg.topic);
      // 맵 메타는 구독 즉시 전송
      if (msg.topic === t('/map_meta')) {
        ws.send(JSON.stringify({ op: 'publish', topic: t('/map_meta'), msg: makeMapMeta() }));
      }
      return;
    }
    if (op === 'unsubscribe')  { removeSub(msg.id || msg.topic); return; }
    if (op === 'publish') {
      if (msg.topic === t('/cmd_vel') && msg.msg) {
        const { linear, angular } = msg.msg;
        state.vx     = linear?.x  ?? 0;
        state.vtheta = angular?.z ?? 0;
        console.log(`[${ROBOT_NAME}] cmd_vel  v:${state.vx.toFixed(2)}  ω:${state.vtheta.toFixed(2)}`);
      }
      return;
    }
    if (op === 'call_service') { handleService(ws, msg); return; }
  });

  ws.on('close', () => {
    console.log(`[${ROBOT_NAME}] 연결 해제: ${ip}`);
    for (const [, set] of subscribers)
      for (const e of set) if (e.ws === ws) set.delete(e);
    // 연결 해제 시 로봇 정지
    state.vx = 0; state.vtheta = 0;
  });
  ws.on('error', () => {});
});

function handleService(ws, { id, service, args: a = {} }) {
  function res(values, result = true) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ op: 'service_response', id, service, values, result }));
  }
  if (service === '/rosapi/topics')        return res({ topics: Object.keys(TOPICS), types: Object.values(TOPICS) });
  if (service === '/rosapi/nodes')         return res({ nodes: NODES });
  if (service === '/rosapi/topic_type')    return res({ type: TOPICS[a.topic] || 'unknown' });
  if (service === '/rosapi/service_type')  return res({ type: 'std_srvs/srv/Empty' });
  if (service === '/rosapi/get_param')     return res({ value: { '/robot_name': `"${ROBOT_NAME}"`, '/use_sim_time': 'true' }[a.name] || 'null' });
  if (service === '/rosapi/get_param_names') return res({ names: ['/robot_name', '/use_sim_time', '/max_vel', '/robot_radius'] });
  if (service === '/rosapi/set_param')     { console.log(`[${ROBOT_NAME}] param set ${a.name}=${a.value}`); return res({}); }
  console.log(`[${ROBOT_NAME}] unknown service: ${service}`);
  res({ error: `없음: ${service}` }, false);
}

process.on('SIGINT', () => { console.log(`\n[${ROBOT_NAME}] 종료`); wss.close(() => process.exit(0)); });
