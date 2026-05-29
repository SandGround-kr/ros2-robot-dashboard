/**
 * sim_robot.js — rosbridge 프로토콜 호환 시뮬레이션 로봇
 *
 * ROS2 없이 웹 대시보드에서 바로 테스트할 수 있는 가상 로봇.
 * rosbridge_suite 의 WebSocket 프로토콜을 Node.js로 구현.
 *
 * 시뮬레이션 토픽:
 *   /odom           (nav_msgs/msg/Odometry)       - 위치·속도
 *   /scan           (sensor_msgs/msg/LaserScan)    - LiDAR 스캔
 *   /imu/data       (sensor_msgs/msg/Imu)          - IMU
 *   /battery_state  (sensor_msgs/msg/BatteryState) - 배터리
 *   /rosout         (rcl_interfaces/msg/Log)        - 로그
 *   /cmd_vel        (geometry_msgs/msg/Twist)       - 속도 명령 수신
 *
 * 서비스:
 *   /rosapi/topics      → 토픽 목록
 *   /rosapi/nodes       → 노드 목록
 *   /rosapi/topic_type  → 토픽 타입 조회
 *
 * 사용법:
 *   node sim/sim_robot.js [--port 9090] [--name sim_robot1]
 */

const WebSocket = require('ws');

// ─── CLI 인자 파싱 ────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const PORT      = parseInt(getArg('--port', '9090'));
const ROBOT_NAME = getArg('--name', 'sim_robot');
const NS        = getArg('--ns', '');  // 네임스페이스 (예: /robot1)

function topic(name) { return NS ? `${NS}${name}` : name; }

// ─── 시뮬레이션 상태 ──────────────────────────────────────────
const state = {
  x: 0, y: 0, theta: 0,
  vx: 0, vy: 0, vtheta: 0,
  battery: 85.0,
  scanAngle: 0,
  logSeq: 0,
};

// ─── 토픽 메타 정보 ───────────────────────────────────────────
const TOPICS = {
  [topic('/odom')]:          'nav_msgs/msg/Odometry',
  [topic('/scan')]:          'sensor_msgs/msg/LaserScan',
  [topic('/imu/data')]:      'sensor_msgs/msg/Imu',
  [topic('/battery_state')]: 'sensor_msgs/msg/BatteryState',
  [topic('/cmd_vel')]:       'geometry_msgs/msg/Twist',
  [topic('/rosout')]:        'rcl_interfaces/msg/Log',
  [topic('/tf')]:            'tf2_msgs/msg/TFMessage',
};

const NODES = [
  `/${ROBOT_NAME}`,
  `/${ROBOT_NAME}/controller`,
  `/${ROBOT_NAME}/lidar_driver`,
  `/${ROBOT_NAME}/imu_driver`,
  '/rosapi',
];

// ─── 구독자 관리 ──────────────────────────────────────────────
// topicName → Set<{ ws, id }>
const subscribers = new Map();

function addSubscriber(topicName, ws, subId) {
  if (!subscribers.has(topicName)) subscribers.set(topicName, new Set());
  subscribers.get(topicName).add({ ws, id: subId });
}

function removeSubscriber(subId) {
  for (const [, set] of subscribers) {
    for (const entry of set) {
      if (entry.id === subId) { set.delete(entry); break; }
    }
  }
}

function publish(topicName, type, msg) {
  const set = subscribers.get(topicName);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ op: 'publish', topic: topicName, msg });
  for (const { ws } of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// ─── 메시지 생성 함수 ─────────────────────────────────────────
function stamp() {
  const now = Date.now();
  return { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1e6 };
}

function makeOdom() {
  const c = Math.cos(state.theta), s = Math.sin(state.theta);
  return {
    header: { stamp: stamp(), frame_id: 'odom' },
    child_frame_id: `${NS || ''}/base_link`,
    pose: {
      pose: {
        position: { x: state.x, y: state.y, z: 0 },
        orientation: { x: 0, y: 0, z: Math.sin(state.theta / 2), w: Math.cos(state.theta / 2) },
      },
      covariance: Array(36).fill(0),
    },
    twist: {
      twist: {
        linear:  { x: state.vx,     y: 0, z: 0 },
        angular: { x: 0, y: 0,      z: state.vtheta },
      },
      covariance: Array(36).fill(0),
    },
  };
}

function makeScan() {
  const count = 360;
  const ranges = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    // 원형 방 + 노이즈 시뮬레이션
    const base = 3.0 + Math.sin(angle * 3 + state.scanAngle) * 0.5;
    return Math.max(0.1, base + (Math.random() - 0.5) * 0.05);
  });
  return {
    header: { stamp: stamp(), frame_id: `${NS || ''}/laser` },
    angle_min: -Math.PI,
    angle_max:  Math.PI,
    angle_increment: (Math.PI * 2) / count,
    time_increment: 0,
    scan_time: 0.1,
    range_min: 0.1,
    range_max: 10.0,
    ranges,
    intensities: [],
  };
}

function makeImu() {
  return {
    header: { stamp: stamp(), frame_id: `${NS || ''}/imu` },
    orientation: { x: 0, y: 0, z: Math.sin(state.theta / 2), w: Math.cos(state.theta / 2) },
    orientation_covariance: Array(9).fill(0),
    angular_velocity:    { x: 0, y: 0, z: state.vtheta + (Math.random() - 0.5) * 0.001 },
    angular_velocity_covariance: Array(9).fill(0),
    linear_acceleration: {
      x: (Math.random() - 0.5) * 0.01,
      y: (Math.random() - 0.5) * 0.01,
      z: 9.81 + (Math.random() - 0.5) * 0.01,
    },
    linear_acceleration_covariance: Array(9).fill(0),
  };
}

function makeBattery() {
  return {
    header: { stamp: stamp(), frame_id: `${NS || ''}/battery` },
    voltage: 12.0 + (state.battery / 100) * 4.0,
    temperature: 25.0 + Math.random() * 2,
    current: -(0.5 + Math.abs(state.vx) * 2 + Math.abs(state.vtheta)),
    charge: -1.0,
    capacity: -1.0,
    design_capacity: 10.0,
    percentage: state.battery / 100.0,
    power_supply_status: 1,  // DISCHARGING
    power_supply_health: 1,  // GOOD
    power_supply_technology: 2, // LION
    present: true,
  };
}

function makeTf() {
  return {
    transforms: [{
      header:        { stamp: stamp(), frame_id: 'odom' },
      child_frame_id: `${NS || ''}/base_link`,
      transform: {
        translation: { x: state.x, y: state.y, z: 0 },
        rotation:    { x: 0, y: 0, z: Math.sin(state.theta / 2), w: Math.cos(state.theta / 2) },
      },
    }],
  };
}

function makeLog(level, msg) {
  state.logSeq++;
  return {
    stamp: stamp(),
    level,
    name: `/${ROBOT_NAME}`,
    msg,
    file: 'sim_robot.js',
    function: 'simulate',
    line: 0,
  };
}

// ─── 물리 시뮬레이션 (50Hz) ──────────────────────────────────
const DT = 0.02;
setInterval(() => {
  state.x     += state.vx * Math.cos(state.theta) * DT;
  state.y     += state.vx * Math.sin(state.theta) * DT;
  state.theta += state.vtheta * DT;
  state.theta  = ((state.theta + Math.PI) % (Math.PI * 2)) - Math.PI;
  state.scanAngle += 0.02;

  // 배터리 소모 (매우 천천히)
  const load = Math.abs(state.vx) + Math.abs(state.vtheta) * 0.5;
  state.battery = Math.max(0, state.battery - load * 0.0001);
}, DT * 1000);

// ─── 토픽 발행 타이머 ────────────────────────────────────────
setInterval(() => publish(topic('/odom'), TOPICS[topic('/odom')], makeOdom()), 100);   // 10 Hz
setInterval(() => publish(topic('/imu/data'), TOPICS[topic('/imu/data')], makeImu()), 50); // 20 Hz
setInterval(() => publish(topic('/battery_state'), TOPICS[topic('/battery_state')], makeBattery()), 1000); // 1 Hz
setInterval(() => publish(topic('/tf'), TOPICS[topic('/tf')], makeTf()), 100);          // 10 Hz
setInterval(() => publish(topic('/scan'), TOPICS[topic('/scan')], makeScan()), 200);    // 5 Hz

// 주기적 로그
const logMessages = [
  [20, '로봇 정상 작동 중'],
  [20, `위치: x=${state.x.toFixed(2)}, y=${state.y.toFixed(2)}`],
  [20, `배터리: ${state.battery.toFixed(1)}%`],
  [30, '속도 명령 대기 중'],
];
let logIdx = 0;
setInterval(() => {
  const [level, msg] = logMessages[logIdx % logMessages.length];
  const dynamic = msg.includes('위치')
    ? `위치: x=${state.x.toFixed(2)}, y=${state.y.toFixed(2)}`
    : msg.includes('배터리')
    ? `배터리: ${state.battery.toFixed(1)}%`
    : msg;
  publish(topic('/rosout'), TOPICS[topic('/rosout')], makeLog(level, dynamic));
  logIdx++;
}, 3000);

// ─── rosbridge WebSocket 서버 ────────────────────────────────
const wss = new WebSocket.Server({ port: PORT });

wss.on('listening', () => {
  console.log(`[${ROBOT_NAME}] rosbridge mock 서버 시작: ws://0.0.0.0:${PORT}`);
  console.log(`[${ROBOT_NAME}] 네임스페이스: ${NS || '(없음)'}`);
  console.log(`[${ROBOT_NAME}] 시뮬레이션 토픽: ${Object.keys(TOPICS).join(', ')}`);
});

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[${ROBOT_NAME}] 클라이언트 연결: ${ip}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const { op, id } = msg;

    // ── subscribe ──────────────────────────────────────────
    if (op === 'subscribe') {
      const { topic: t, type, id: subId } = msg;
      addSubscriber(t, ws, subId || t);
      return;
    }

    // ── unsubscribe ─────────────────────────────────────────
    if (op === 'unsubscribe') {
      removeSubscriber(msg.id || msg.topic);
      return;
    }

    // ── publish (cmd_vel 수신) ──────────────────────────────
    if (op === 'publish') {
      if (msg.topic === topic('/cmd_vel') && msg.msg) {
        const { linear, angular } = msg.msg;
        state.vx     = (linear  && linear.x  != null) ? linear.x  : 0;
        state.vtheta = (angular && angular.z != null) ? angular.z : 0;
        console.log(`[${ROBOT_NAME}] cmd_vel: linear.x=${state.vx.toFixed(2)} angular.z=${state.vtheta.toFixed(2)}`);
      }
      return;
    }

    // ── call_service ────────────────────────────────────────
    if (op === 'call_service') {
      handleService(ws, msg);
      return;
    }
  });

  ws.on('close', () => {
    console.log(`[${ROBOT_NAME}] 클라이언트 연결 해제: ${ip}`);
    // 이 클라이언트의 구독 정리
    for (const [, set] of subscribers) {
      for (const entry of set) {
        if (entry.ws === ws) set.delete(entry);
      }
    }
  });

  ws.on('error', () => {});
});

// ─── 서비스 핸들러 ────────────────────────────────────────────
function handleService(ws, msg) {
  const { id, service, args: svcArgs = {} } = msg;

  function respond(values, result = true) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 'service_response', id, service, values, result }));
    }
  }

  // /rosapi/topics
  if (service === '/rosapi/topics') {
    return respond({
      topics: Object.keys(TOPICS),
      types:  Object.values(TOPICS),
    });
  }

  // /rosapi/nodes
  if (service === '/rosapi/nodes') {
    return respond({ nodes: NODES });
  }

  // /rosapi/topic_type
  if (service === '/rosapi/topic_type') {
    const t = svcArgs.topic;
    return respond({ type: TOPICS[t] || 'unknown' });
  }

  // /rosapi/service_type
  if (service === '/rosapi/service_type') {
    return respond({ type: 'std_srvs/srv/Empty' });
  }

  // /rosapi/get_param
  if (service === '/rosapi/get_param') {
    const params = {
      '/robot_name':          `"${ROBOT_NAME}"`,
      '/max_linear_velocity': '1.0',
      '/max_angular_velocity':'2.0',
      '/use_sim_time':        'true',
    };
    return respond({ value: params[svcArgs.name] || 'null' });
  }

  // /rosapi/get_param_names
  if (service === '/rosapi/get_param_names') {
    return respond({
      names: ['/robot_name', '/max_linear_velocity', '/max_angular_velocity', '/use_sim_time'],
    });
  }

  // /rosapi/set_param
  if (service === '/rosapi/set_param') {
    console.log(`[${ROBOT_NAME}] 파라미터 설정: ${svcArgs.name} = ${svcArgs.value}`);
    return respond({});
  }

  // 알 수 없는 서비스
  console.log(`[${ROBOT_NAME}] 알 수 없는 서비스: ${service}`);
  return respond({ error: `서비스 없음: ${service}` }, false);
}

// ─── 종료 처리 ────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log(`\n[${ROBOT_NAME}] 종료 중...`);
  wss.close(() => process.exit(0));
});
