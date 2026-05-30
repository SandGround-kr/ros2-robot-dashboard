/**
 * TopicDiscovery — 주기적으로 rosapi를 폴링해 새 토픽/노드를 자동 감지
 *
 * 사용:
 *   const disc = new TopicDiscovery(client, 3000);
 *   disc.on('topics_updated', ({ topics, nodes }) => ...);
 *   disc.on('new_detected',   ({ topics, nodes }) => ...);
 *   disc.start();
 */
class TopicDiscovery {
  // 네임스페이스 → 모듈 이름 매핑 (알려진 패키지 기준)
  static MODULE_MAP = [
    // LiDAR
    { prefix: '/livox',          name: 'MID360 LiDAR',       icon: '📡' },
    { prefix: '/velodyne',       name: 'Velodyne LiDAR',     icon: '📡' },
    { prefix: '/rslidar',        name: 'RoboSense LiDAR',    icon: '📡' },
    { prefix: '/lslidar',        name: 'LSLiDAR',            icon: '📡' },
    { prefix: '/scan',           name: 'LiDAR 스캔',          icon: '📡' },
    // 카메라
    { prefix: '/zed',            name: 'ZED Mini 카메라',     icon: '📷' },
    { prefix: '/camera',         name: '카메라',              icon: '📷' },
    { prefix: '/image',          name: '이미지',              icon: '📷' },
    { prefix: '/realsense',      name: 'RealSense 카메라',    icon: '📷' },
    // GPS/위치
    { prefix: '/ublox',          name: 'Ublox GPS',          icon: '🛰️' },
    { prefix: '/gps',            name: 'GPS',                icon: '🛰️' },
    { prefix: '/fix',            name: 'GNSS Fix',           icon: '🛰️' },
    { prefix: '/navsat',         name: 'NavSat',             icon: '🛰️' },
    // IMU
    { prefix: '/imu',            name: 'IMU',                icon: '🔄' },
    // 이동/제어
    { prefix: '/odom',           name: '오도메트리',          icon: '🚗' },
    { prefix: '/cmd_vel',        name: '속도 제어',           icon: '🚗' },
    { prefix: '/move_base',      name: 'Navigation',         icon: '🗺️' },
    { prefix: '/local_costmap',  name: 'Local Costmap',      icon: '🗺️' },
    { prefix: '/global_costmap', name: 'Global Costmap',     icon: '🗺️' },
    { prefix: '/map',            name: '맵',                  icon: '🗺️' },
    { prefix: '/path',           name: '경로',                icon: '🗺️' },
    // TF / 시스템
    { prefix: '/tf',             name: 'TF 변환',             icon: '🔗' },
    { prefix: '/rosout',         name: '시스템 로그',         icon: '📋' },
    { prefix: '/diagnostics',    name: '진단',                icon: '🔧' },
    { prefix: '/battery',        name: '배터리',              icon: '🔋' },
    { prefix: '/joint_states',   name: '조인트 상태',         icon: '⚙️' },
  ];

  constructor(client, pollIntervalMs = 3000) {
    this.client = client;
    this._interval = pollIntervalMs;
    this._knownTopics = new Map();  // name → type
    this._knownNodes  = new Set();
    this._listeners   = {};
    this._timer       = null;
    this._running     = false;
    this._pollCount   = 0;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._poll();
    this._timer = setInterval(() => this._poll(), this._interval);
  }

  stop() {
    this._running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  reset() {
    this._knownTopics.clear();
    this._knownNodes.clear();
    this._pollCount = 0;
  }

  async _poll() {
    if (!this.client.connected) return;
    try {
      const [topicsRes, nodesRes] = await Promise.all([
        this.client.callService('/rosapi/topics', 'rosapi/Topics'),
        this.client.callService('/rosapi/nodes',  'rosapi/Nodes'),
      ]);

      const names = topicsRes.topics || [];
      const types = topicsRes.types  || [];
      const nodes = nodesRes.nodes   || [];

      // 새 토픽 감지
      const newTopics = [];
      names.forEach((n, i) => {
        if (!this._knownTopics.has(n)) {
          newTopics.push({ name: n, type: types[i] || '' });
          this._knownTopics.set(n, types[i] || '');
        }
      });

      // 새 노드 감지
      const newNodes = nodes.filter(n => !this._knownNodes.has(n));
      nodes.forEach(n => this._knownNodes.add(n));

      this._pollCount++;

      // 항상 전체 목록 emit
      const allTopics = Array.from(this._knownTopics.entries())
        .map(([name, type]) => ({ name, type }))
        .sort((a, b) => a.name.localeCompare(b.name));

      this._emit('topics_updated', {
        topics: allTopics,
        nodes: Array.from(this._knownNodes),
      });

      // 새로 감지된 것만 별도 emit
      if (newTopics.length || newNodes.length) {
        this._emit('new_detected', {
          topics: newTopics,
          nodes:  newNodes,
          modules: TopicDiscovery.detectModules(newTopics),
        });
      }

    } catch (e) {
      // rosapi 미응답 시 무시 (아직 ROS2 미시작 등)
    }
  }

  getAllTopics() {
    return Array.from(this._knownTopics.entries())
      .map(([name, type]) => ({ name, type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getAllNodes() {
    return Array.from(this._knownNodes).sort();
  }

  // 토픽 목록을 모듈별로 그룹핑
  static groupByModule(topics) {
    const groups = new Map(); // moduleName → { info, topics[] }

    for (const t of topics) {
      const mod = TopicDiscovery.getModule(t.name);
      if (!groups.has(mod.name)) {
        groups.set(mod.name, { info: mod, topics: [] });
      }
      groups.get(mod.name).topics.push(t);
    }

    // 정렬: 알려진 모듈 먼저, 기타 마지막
    return Array.from(groups.values()).sort((a, b) => {
      if (a.info.name === '기타') return 1;
      if (b.info.name === '기타') return -1;
      return a.info.name.localeCompare(b.info.name);
    });
  }

  // 토픽 이름으로 모듈 정보 반환
  static getModule(topicName) {
    for (const m of TopicDiscovery.MODULE_MAP) {
      if (topicName === m.prefix || topicName.startsWith(m.prefix + '/')) {
        return m;
      }
    }
    // 알 수 없는 네임스페이스: 첫 세그먼트를 모듈명으로 사용
    const parts = topicName.split('/').filter(Boolean);
    if (parts.length > 1) {
      return { prefix: '/' + parts[0], name: '/' + parts[0], icon: '📦' };
    }
    return { prefix: '', name: '기타', icon: '📦' };
  }

  // 새 토픽 목록에서 감지된 모듈 목록 반환 (중복 제거)
  static detectModules(topics) {
    const seen = new Set();
    return topics
      .map(t => TopicDiscovery.getModule(t.name))
      .filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true; });
  }

  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
    return this;
  }
  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => { try { cb(data); } catch(e) { console.error(e); } });
  }
}
