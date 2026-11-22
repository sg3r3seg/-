'use strict';
const { EventEmitter } = require('node:events');
const hub = require('../hub');

// Base class for platform connectors. A connector reports `connected` only
// after the platform actually confirmed the connection (e.g. joined chat).
class Connector extends EventEmitter {
  constructor(id, label) {
    super();
    this.id = id; this.label = label;
    this.status = { platform: id, label, state: 'disconnected', detail: '', since: Date.now(), lastEventAt: null, viewers: null, live: null, canWrite: false, channel: null };
    this.retry = 0; this.retryTimer = null; this.wantConnected = false;
  }
  setStatus(patch) {
    Object.assign(this.status, patch, patch.state ? { since: Date.now() } : {});
    this.emit('status', { ...this.status });
  }
  publish(evt) {
    this.status.lastEventAt = Date.now();
    return hub.publish({ platform: this.id, ...evt });
  }
  log(level, msg) { hub.log(level, this.id, msg); }
  scheduleReconnect(fn) {
    if (!this.wantConnected) return;
    clearTimeout(this.retryTimer);
    const delay = Math.min(60_000, 2000 * 2 ** this.retry++);
    this.setStatus({ state: 'connecting', detail: `reconnecting in ${Math.round(delay / 1000)}s` });
    this.retryTimer = setTimeout(fn, delay);
  }
  async send() { throw Object.assign(new Error('This connection cannot send chat messages'), { code: 'READ_ONLY' }); }
  disconnect() {
    this.wantConnected = false; clearTimeout(this.retryTimer);
    this.setStatus({ state: 'disconnected', detail: '', viewers: null, live: null, canWrite: false });
  }
}
module.exports = { Connector };
