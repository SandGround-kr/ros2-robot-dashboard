const WebSocket = require('ws');
const registry = require('./RobotRegistry');

const MAX_BACKOFF = 30000;

class RobotConnection {
  constructor(robot, intervalMs) {
    this.robot = robot;
    this.intervalMs = intervalMs;
    this.ws = null;
    this.destroyed = false;
    this.backoff = 1000;
    this._connect();
  }

  _url() {
    return `ws://${this.robot.host}:${this.robot.port}`;
  }

  _connect() {
    if (this.destroyed) return;
    registry.updateStatus(this.robot.id, 'connecting');

    try {
      this.ws = new WebSocket(this._url());
    } catch (e) {
      this._handleError();
      return;
    }

    this.ws.on('open', () => {
      this.backoff = 1000;
      registry.updateStatus(this.robot.id, 'online');
      this._startHealthCheck();
    });

    this.ws.on('close', () => {
      if (!this.destroyed) {
        registry.updateStatus(this.robot.id, 'offline');
        this._scheduleReconnect();
      }
    });

    this.ws.on('error', () => this._handleError());
  }

  _handleError() {
    if (this.destroyed) return;
    registry.updateStatus(this.robot.id, 'offline');
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.destroyed) return;
    setTimeout(() => this._connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  _startHealthCheck() {
    this._healthTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // rosapi/nodes 서비스 호출로 헬스체크 + 노드 수 갱신
        const msg = JSON.stringify({
          op: 'call_service',
          id: 'health_check',
          service: '/rosapi/nodes',
          args: {},
        });
        this.ws.send(msg);
      }
    }, this.intervalMs);

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id === 'health_check' && msg.values && msg.values.nodes) {
          registry.updateStatus(this.robot.id, 'online', {
            nodeCount: msg.values.nodes.length,
          });
        }
      } catch (_) {}
    });
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this._healthTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
  }
}

module.exports = RobotConnection;
