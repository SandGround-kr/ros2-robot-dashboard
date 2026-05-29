/**
 * TopicHandler — 토픽 구독/발행 추상화 + 메시지 버퍼링 + hz 계산
 */
class TopicHandler {
  constructor(client, bufferSize = 50) {
    this.client = client;
    this.bufferSize = bufferSize;
    this._subs = new Map(); // topicName → { subId, messages[], hz, lastTs, callbacks[] }
  }

  subscribe(topicName, messageType, onMessage) {
    let entry = this._subs.get(topicName);
    if (!entry) {
      entry = { subId: null, messages: [], hz: 0, lastTs: null, callbacks: [] };
      this._subs.set(topicName, entry);

      entry.subId = this.client.subscribe(topicName, messageType, (msg) => {
        const now = Date.now();
        if (entry.lastTs) {
          entry.hz = Math.round(1000 / (now - entry.lastTs));
        }
        entry.lastTs = now;
        entry.messages.push({ ts: now, data: msg });
        if (entry.messages.length > this.bufferSize) entry.messages.shift();
        entry.callbacks.forEach((cb) => cb(msg, entry));
      });
    }
    entry.callbacks.push(onMessage);
  }

  unsubscribe(topicName) {
    const entry = this._subs.get(topicName);
    if (!entry) return;
    this.client.unsubscribe(entry.subId);
    this._subs.delete(topicName);
  }

  publish(topicName, messageType, message) {
    this.client.publish(topicName, messageType, message);
  }

  getMessages(topicName) {
    return this._subs.get(topicName)?.messages || [];
  }

  getHz(topicName) {
    return this._subs.get(topicName)?.hz || 0;
  }

  destroy() {
    for (const [name] of this._subs) {
      this.unsubscribe(name);
    }
  }
}
