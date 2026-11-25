'use strict';
const express = require('express');
const path = require('node:path');
const config = require('../config');
const W = require('../services/winners');
const { h, str } = require('../http');
const { requireAuth, requireVerified, requireApp } = require('../middleware');
const { limiter } = require('../ratelimit');

// Creator side (desktop app session).
const rooms = express.Router();
rooms.use(requireAuth, requireVerified, requireApp);
rooms.post('/', limiter('room-create', 30, 3600_000, (req) => req.user.id), h(async (req, res) => res.json(W.create(req.user, req.token.dev, req.body || {}))));
rooms.get('/', h(async (req, res) => res.json(W.list(req.user))));
rooms.get('/:roomId/messages', limiter('room-poll', 1200, 600_000, (req) => req.user.id), h(async (req, res) => res.json(W.hostMessages(req.user, req.params.roomId, req.query.after))));
rooms.post('/:roomId/messages', limiter('room-send', 60, 60_000, (req) => req.user.id), h(async (req, res) => res.json(W.hostSend(req.user, req.params.roomId, str(req.body?.text, { min: 1, max: 1000, name: 'text' })))));
rooms.post('/:roomId/close', h(async (req, res) => res.json(W.hostClose(req.user, req.params.roomId, req.body?.reason))));

// Winner side (public page, the cookie proves the platform sign-in).
const cookieName = (code) => `lvxw_${String(code).replace(/[^A-Za-z0-9_-]/g, '')}`;
const readCookie = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};
const token = (req) => readCookie(req, cookieName(req.params.code));
const winner = express.Router();
winner.get('/:code', limiter('winner-info', 120, 60_000), h(async (req, res) => res.json(W.publicInfo(req.params.code, token(req)))));
winner.post('/:code/verify', limiter('winner-verify', 20, 600_000), h(async (req, res) => res.json(W.startVerify(req.params.code))));
winner.get('/:code/messages', limiter('winner-poll', 600, 600_000), h(async (req, res) => res.json(W.winnerMessages(req.params.code, token(req), req.query.after))));
winner.post('/:code/messages', limiter('winner-send', 30, 60_000), h(async (req, res) => res.json(W.winnerSend(req.params.code, token(req), str(req.body?.text, { min: 1, max: 1000, name: 'text' })))));

// Shared OAuth callback hands winner checks here: set the room cookie and go back to the page.
async function identityRedirect(platform, query, res) {
  const out = await W.identityCallback(platform, query);
  if (!out.code) return res.redirect(303, '/');
  if (out.ok) {
    res.append('Set-Cookie', `${cookieName(out.code)}=${encodeURIComponent(out.session)}; Path=/api/winner/${out.code}; Max-Age=${7 * 24 * 3600}; HttpOnly; SameSite=Lax${config.publicUrl.startsWith('https://') ? '; Secure' : ''}`);
    return res.redirect(303, `/w/${out.code}?ok=1`);
  }
  return res.redirect(303, `/w/${out.code}?e=${encodeURIComponent(out.error)}`);
}

const page = (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'web', 'winner.html'));
module.exports = { rooms, winner, identityRedirect, page };
