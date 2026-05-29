/**
 * RobotClient — 로봇 1대의 roslibjs 연결 전체 담당
 */
class RobotClient {
  constructor(robot) {
    this.robot = robot;
    this.ros = null;
    this.connected = false;
    this._subscribers = new Map(); // subscriberId → ROSLIB.Topic
    this._publishers = new Map();  // topicName → ROSLIB.Topic
    this._subIdCounter = 0;
    this._listeners = {}; // 'connect'|'close'|'error' → callbacks[]
    this._connect();
  }

  _connect() {
    this.ros = new ROSLIB.Ros({ url: `ws://${this.robot.host}:${this.robot.port}` });

    this.ros.on('connection', () => {
      this.connected = true;
      this._emit('connect');
      // 재연결 시 구독 복구
      this._resubscribeAll();
    });

    this.ros.on('close', () => {
      this.connected = false;
      this._emit('close');
    });

    this.ros.on('error', (err) => {
      this.connected = false;
      this._emit('error', err);
    });
  }

  // 토픽 구독. callback(message) 호출. subscriberId 반환.
  subscribe(topicName, messageType, callback) {
    const id = ++this._subIdCounter;
    const topic = new ROSLIB.Topic({ ros: this.ros, name: topicName, messageType });
    topic.subscribe(callback);
    this._subscribers.set(id, { topic, topicName, messageType, callback });
    return id;
  }

  // 구독 해제
  unsubscribe(subscriberId) {
    const entry = this._subscribers.get(subscriberId);
    if (!entry) return;
    entry.topic.unsubscribe();
    this._subscribers.delete(subscriberId);
  }

  // 토픽 발행
  publish(topicName, messageType, message) {
    let publisher = this._publishers.get(topicName);
    if (!publisher) {
      publisher = new ROSLIB.Topic({ ros: this.ros, name: topicName, messageType });
      this._publishers.set(topicName, publisher);
    }
    publisher.publish(new ROSLIB.Message(message));
  }

  // 서비스 호출. Promise<result> 반환.
  callService(serviceName, serviceType, request = {}) {
    return new Promise((resolve, reject) => {
      const client = new ROSLIB.Service({ ros: this.ros, name: serviceName, serviceType });
      const req = new ROSLIB.ServiceRequest(request);
      client.callService(req, resolve, reject);
    });
  }

  // 파라미터 조회
  getParam(paramName) {
    return new Promise((resolve, reject) => {
      const param = new ROSLIB.Param({ ros: this.ros, name: paramName });
      param.get(resolve);
    });
  }

  // 토픽 목록 조회
  getTopics() {
    return this.callService('/rosapi/topics', 'rosapi/Topics');
  }

  // 노드 목록 조회
  getNodes() {
    return this.callService('/rosapi/nodes', 'rosapi/Nodes');
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach((cb) => cb(data));
  }

  _resubscribeAll() {
    for (const [id, entry] of this._subscribers) {
      entry.topic = new ROSLIB.Topic({
        ros: this.ros,
        name: entry.topicName,
        messageType: entry.messageType,
      });
      entry.topic.subscribe(entry.callback);
    }
  }

  destroy() {
    for (const [id, entry] of this._subscribers) {
      entry.topic.unsubscribe();
    }
    this._subscribers.clear();
    this._publishers.clear();
    if (this.ros) this.ros.close();
  }
}
