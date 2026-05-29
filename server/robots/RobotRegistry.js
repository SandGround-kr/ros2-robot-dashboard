const EventEmitter = require('events');

class RobotRegistry extends EventEmitter {
  constructor() {
    super();
    this.robots = new Map(); // robotId → RobotRecord
  }

  // RobotRecord: { id, name, host, port, status, lastSeen, nodeCount }
  add(robot) {
    const record = {
      id: robot.id,
      name: robot.name,
      host: robot.host,
      port: robot.port,
      status: 'unknown',
      lastSeen: null,
      nodeCount: 0,
    };
    this.robots.set(robot.id, record);
    this.emit('robot_added', record);
    return record;
  }

  remove(id) {
    const record = this.robots.get(id);
    if (!record) return false;
    this.robots.delete(id);
    this.emit('robot_removed', { id });
    return true;
  }

  updateStatus(id, status, extra = {}) {
    const record = this.robots.get(id);
    if (!record) return;
    Object.assign(record, { status, ...extra });
    if (status === 'online') record.lastSeen = new Date().toISOString();
    this.emit('robot_status', { id, status, ...record });
  }

  getAll() {
    return Array.from(this.robots.values());
  }

  get(id) {
    return this.robots.get(id);
  }
}

module.exports = new RobotRegistry(); // 싱글톤
