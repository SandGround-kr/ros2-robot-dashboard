/**
 * roslib-shim.js
 * roslibjs(CDN) 없이 동작하는 ROSLIB 호환 구현체.
 * ROSLIB.Ros / Topic / Service / ServiceRequest / Message / Param 을 구현.
 */
(function (global) {
  'use strict';

  // ── 공용 ID 생성 ────────────────────────────────────────────
  let _seq = 0;
  function uid(prefix) { return prefix + '_' + (++_seq); }

  // ── Ros ─────────────────────────────────────────────────────
  class Ros {
    constructor({ url }) {
      this.url = url;
      this.isConnected = false;
      this._listeners = {};         // event → cb[]
      this._ws = null;
      this._serviceCallbacks = {};  // callId → {resolve, reject}
      this._topicHandlers = {};     // topic  → cb[]
      this._retryTimer = null;
      this._connect();
    }

    _connect() {
      try {
        this._ws = new WebSocket(this.url);
      } catch(e) {
        this._emit('error', e);
        this._scheduleRetry();
        return;
      }

      this._ws.onopen = () => {
        this.isConnected = true;
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
        this._emit('connection');
      };

      this._ws.onmessage = (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }

        if (data.op === 'publish') {
          const cbs = this._topicHandlers[data.topic];
          if (cbs) cbs.forEach(cb => { try { cb(data.msg); } catch(err) { console.error(err); } });
          return;
        }
        if (data.op === 'service_response') {
          const cb = this._serviceCallbacks[data.id];
          if (cb) {
            delete this._serviceCallbacks[data.id];
            if (data.result !== false) cb.resolve(data.values);
            else cb.reject(new Error(data.values?.error || 'service failed'));
          }
          return;
        }
      };

      this._ws.onerror = (e) => {
        this.isConnected = false;
        this._emit('error', e);
      };

      this._ws.onclose = () => {
        this.isConnected = false;
        this._emit('close');
        this._scheduleRetry();
      };
    }

    _scheduleRetry() {
      if (this._retryTimer) return;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this._connect();
      }, 3000);
    }

    send(obj) {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(obj));
      }
    }

    on(event, cb) {
      (this._listeners[event] = this._listeners[event] || []).push(cb);
    }

    _emit(event, data) {
      (this._listeners[event] || []).forEach(cb => { try { cb(data); } catch(e) { console.error(e); } });
    }

    _addTopicHandler(topic, cb) {
      (this._topicHandlers[topic] = this._topicHandlers[topic] || []).push(cb);
    }

    _removeTopicHandler(topic, cb) {
      const arr = this._topicHandlers[topic];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }

    _callService(service, args) {
      return new Promise((resolve, reject) => {
        const id = uid('svc');
        this._serviceCallbacks[id] = { resolve, reject };
        this.send({ op: 'call_service', id, service, args: args || {} });
        // 타임아웃 5초
        setTimeout(() => {
          if (this._serviceCallbacks[id]) {
            delete this._serviceCallbacks[id];
            reject(new Error('service timeout: ' + service));
          }
        }, 5000);
      });
    }

    close() {
      if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
      if (this._ws) { try { this._ws.close(); } catch(e) {} }
    }
  }

  // ── Topic ────────────────────────────────────────────────────
  class Topic {
    constructor({ ros, name, messageType, throttle_rate, queue_length }) {
      this.ros = ros;
      this.name = name;
      this.messageType = messageType;
      this._subId = uid('sub');
      this._cb = null;
    }

    subscribe(cb) {
      this._cb = cb;
      this.ros._addTopicHandler(this.name, cb);
      this.ros.send({
        op: 'subscribe',
        id: this._subId,
        topic: this.name,
        type: this.messageType,
      });
    }

    unsubscribe() {
      if (this._cb) {
        this.ros._removeTopicHandler(this.name, this._cb);
        this._cb = null;
      }
      this.ros.send({ op: 'unsubscribe', id: this._subId, topic: this.name });
    }

    publish(message) {
      const msg = (message instanceof Message) ? message : message;
      this.ros.send({ op: 'publish', topic: this.name, msg });
    }
  }

  // ── Service ──────────────────────────────────────────────────
  class Service {
    constructor({ ros, name, serviceType }) {
      this.ros = ros;
      this.name = name;
    }

    callService(request, successCb, failCb) {
      const args = (request instanceof ServiceRequest) ? request._data : request;
      this.ros._callService(this.name, args)
        .then(successCb)
        .catch(failCb || (e => console.warn('[ROSLIB] service error:', e.message)));
    }
  }

  // ── ServiceRequest ───────────────────────────────────────────
  class ServiceRequest {
    constructor(data) {
      this._data = data || {};
      // roslibjs 호환: 속성을 직접 복사
      Object.assign(this, data || {});
    }
  }

  // ── Message ──────────────────────────────────────────────────
  class Message {
    constructor(data) {
      Object.assign(this, data || {});
    }
  }

  // ── Param ────────────────────────────────────────────────────
  class Param {
    constructor({ ros, name }) {
      this.ros = ros;
      this.name = name;
    }

    get(cb) {
      this.ros._callService('/rosapi/get_param', { name: this.name })
        .then(res => {
          let val = res.value;
          try { val = JSON.parse(val); } catch(e) {}
          cb(val);
        })
        .catch(() => cb(null));
    }

    set(value, cb) {
      this.ros._callService('/rosapi/set_param', { name: this.name, value: JSON.stringify(value) })
        .then(() => cb && cb())
        .catch(() => cb && cb());
    }
  }

  // ── 전역 노출 ─────────────────────────────────────────────────
  global.ROSLIB = { Ros, Topic, Service, ServiceRequest, Message, Param };

})(window);
