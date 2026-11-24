'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Minimal, allow-listed bridge. The renderer has no Node.js access.
const INVOKE = /^(app|social|winner|automations|session|settings|hotkeys|platforms|activity|overlay|alerts|tts|voice|commands|bot|sounds|macros|timer|goal|challenges|giveaway|wheel|schedule|community|analytics|highlights|remote|perf|diag|update|win):[a-zA-Z]+$/;
const EVENTS = new Set(['boot:progress', 'session:changed', 'platform:status', 'event', 'activity', 'log', 'tts:state', 'tts:speak', 'tts:stop', 'sound:play', 'timer:state', 'giveaway:state', 'goal:state', 'challenges:state', 'highlights:state', 'schedule:state', 'update:state', 'nav', 'social:changed', 'automations:state', 'winners:changed']);

contextBridge.exposeInMainWorld('livex', {
  invoke: (channel, ...args) => {
    if (!INVOKE.test(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!EVENTS.has(channel) || typeof cb !== 'function') return () => {};
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
