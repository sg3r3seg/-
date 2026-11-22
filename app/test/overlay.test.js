'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { OverlayServer, ROUTES } = require('../src/main/overlay-server');

test('overlay server: key required, origin checked, routes verified', async () => {
  const s = new OverlayServer();
  const port = await s.start({ port: 0, key: 'k'.repeat(24) });
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/alerts?key=wrong`);
    assert.equal(bad.status, 403);
    const v = await s.verify();
    assert.equal(v.length, ROUTES.length);
    assert.ok(v.every((x) => x.ok), JSON.stringify(v));
    // foreign website origin is refused
    await assert.rejects(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${'k'.repeat(24)}&route=alerts`, { headers: { Origin: 'https://evil.example' } });
      ws.on('open', resolve); ws.on('error', reject);
    }));
    // correct key receives broadcasts + sticky state
    s.broadcast('timer', 'state', { a: 1 }, { sticky: true });
    const got = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${'k'.repeat(24)}&route=timer`);
      ws.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'hello') { resolve(j); ws.close(); } });
      ws.on('error', reject);
    });
    assert.deepEqual(got.state.payload, { a: 1 });
    assert.equal((await fetch(`http://127.0.0.1:${port}/../../etc/passwd?key=${'k'.repeat(24)}`)).status, 404);
  } finally { await s.stop(); }
});
