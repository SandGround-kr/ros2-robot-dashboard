/**
 * RobotManager — SSE 수신 + RobotClient 생명주기 관리
 */
class RobotManager {
  constructor(onUpdate) {
    this.clients = new Map();   // robotId → RobotClient
    this.robots = new Map();    // robotId → robot record (서버 상태)
    this.onUpdate = onUpdate;   // UI 갱신 콜백
    this._connectSSE();
  }

  _connectSSE() {
    const es = new EventSource('/api/events');

    es.addEventListener('init', (e) => {
      const robots = JSON.parse(e.data);
      robots.forEach((r) => this._addRobot(r));
      this.onUpdate(this.getRobots());
    });

    es.addEventListener('robot_status', (e) => {
      const data = JSON.parse(e.data);
      if (this.robots.has(data.id)) {
        Object.assign(this.robots.get(data.id), data);
        this.onUpdate(this.getRobots());
      }
    });

    es.addEventListener('robot_added', (e) => {
      const robot = JSON.parse(e.data);
      this._addRobot(robot);
      this.onUpdate(this.getRobots());
    });

    es.addEventListener('robot_removed', (e) => {
      const { id } = JSON.parse(e.data);
      this._removeRobot(id);
      this.onUpdate(this.getRobots());
    });

    es.onerror = () => {
      // SSE 재연결은 브라우저가 자동 처리
    };
  }

  _addRobot(robot) {
    this.robots.set(robot.id, robot);
    if (!this.clients.has(robot.id)) {
      const client = new RobotClient(robot);
      this.clients.set(robot.id, client);
    }
  }

  _removeRobot(id) {
    const client = this.clients.get(id);
    if (client) {
      client.destroy();
      this.clients.delete(id);
    }
    this.robots.delete(id);
  }

  getRobots() {
    return Array.from(this.robots.values());
  }

  getClient(robotId) {
    return this.clients.get(robotId);
  }

  // 로봇 동적 추가 API 호출
  async addRobot(robot) {
    const res = await fetch('/api/robots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(robot),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  // 로봇 제거 API 호출
  async removeRobot(id) {
    const res = await fetch(`/api/robots/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
  }
}
