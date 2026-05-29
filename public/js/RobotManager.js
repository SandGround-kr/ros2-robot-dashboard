/**
 * RobotManager — REST 즉시 로드 + SSE 실시간 상태 동기화
 */
class RobotManager {
  constructor(onUpdate) {
    this.clients = new Map();
    this.robots  = new Map();
    this.onUpdate = onUpdate;
    this._sseReady = false;

    // REST API로 즉시 로봇 목록 표시 (SSE 연결 전에도 렌더링)
    this._fetchInitial();
    this._connectSSE();
  }

  async _fetchInitial() {
    try {
      const res    = await fetch('/api/robots');
      const robots = await res.json();
      robots.forEach(r => this._addRobot(r));
      this.onUpdate(this.getRobots());
    } catch (e) {
      console.warn('[RobotManager] 초기 로봇 목록 조회 실패:', e.message);
    }
  }

  _connectSSE() {
    const es = new EventSource('/api/events');

    es.addEventListener('init', (e) => {
      // SSE init은 REST와 중복될 수 있으므로 상태만 병합
      try {
        const robots = JSON.parse(e.data);
        robots.forEach(r => {
          if (this.robots.has(r.id)) {
            Object.assign(this.robots.get(r.id), r);
          } else {
            this._addRobot(r);
          }
        });
        this._sseReady = true;
        this.onUpdate(this.getRobots());
      } catch (err) {
        console.error('[RobotManager] SSE init 처리 오류:', err);
      }
    });

    es.addEventListener('robot_status', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this.robots.has(data.id)) {
          Object.assign(this.robots.get(data.id), data);
          this.onUpdate(this.getRobots());
        }
      } catch (err) {
        console.error('[RobotManager] robot_status 처리 오류:', err);
      }
    });

    es.addEventListener('robot_added', (e) => {
      try {
        const robot = JSON.parse(e.data);
        this._addRobot(robot);
        this.onUpdate(this.getRobots());
      } catch (err) {
        console.error('[RobotManager] robot_added 처리 오류:', err);
      }
    });

    es.addEventListener('robot_removed', (e) => {
      try {
        const { id } = JSON.parse(e.data);
        this._removeRobot(id);
        this.onUpdate(this.getRobots());
      } catch (err) {
        console.error('[RobotManager] robot_removed 처리 오류:', err);
      }
    });

    es.onerror = () => { /* 브라우저가 자동 재연결 */ };
  }

  _addRobot(robot) {
    this.robots.set(robot.id, robot);
    if (!this.clients.has(robot.id)) {
      try {
        const client = new RobotClient(robot);
        this.clients.set(robot.id, client);
      } catch (e) {
        console.warn(`[RobotManager] RobotClient 생성 실패 (${robot.id}):`, e.message);
      }
    }
  }

  _removeRobot(id) {
    const client = this.clients.get(id);
    if (client) { client.destroy(); this.clients.delete(id); }
    this.robots.delete(id);
  }

  getRobots()        { return Array.from(this.robots.values()); }
  getClient(robotId) { return this.clients.get(robotId); }

  async addRobot(robot) {
    const res = await fetch('/api/robots', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(robot),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  async removeRobot(id) {
    const res = await fetch(`/api/robots/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
  }
}
