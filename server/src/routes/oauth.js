'use strict';
const express = require('express');
const O = require('../services/oauth');
const W = require('../services/winners');
const { identityRedirect } = require('./winners');
const { h, str } = require('../http');
const { requireAuth, requireVerified, requireApp } = require('../middleware');
const { limiter } = require('../ratelimit');

const r = express.Router();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Public: the provider redirects the user's browser here after consent.
r.get('/callback/:platform', limiter('oauth-cb', 60, 60_000), h(async (req, res) => {
  // Giveaway-winner identity checks share the registered redirect URI.
  if (W.ownsState(req.query.state)) return identityRedirect(String(req.params.platform), req.query, res);
  const out = await O.callback(String(req.params.platform), req.query);
  const ok = out.ok;
  const msgs = {
    ACCESS_DENIED: ['ההתחברות בוטלה.', 'Sign-in was cancelled.'],
    FLOW_EXPIRED: ['פג הזמן להתחברות. נסו שוב מ-LiveX.', 'This sign-in expired. Try again from LiveX.'],
    FLOW_USED: ['הקישור הזה כבר נוצל. אפשר לחזור ל-LiveX.', 'This link was already used. You can return to LiveX.'],
    INVALID_STATE: ['בקשת התחברות לא תקינה. התחילו מחדש מ-LiveX.', 'Invalid sign-in request. Start again from LiveX.'],
  };
  const [he, en] = ok ? [`החשבון ${esc(out.profile.name)} חובר ל-LiveX.`, `${esc(out.profile.name)} is now connected to LiveX.`] : (msgs[out.error] || ['ההתחברות נכשלה. נסו שוב מ-LiveX.', 'Sign-in failed. Try again from LiveX.']);
  res.status(ok ? 200 : 400).type('html').send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LiveX</title><link rel="stylesheet" href="/css/site.css"></head>
<body><main class="wrap"><div class="card auth" style="text-align:center">
<div class="brand" style="justify-content:center"><span class="logo">X</span>LIVEX</div>
<h2 style="margin-top:18px">${ok ? '✓' : '✕'} ${he}</h2><p class="muted" dir="ltr">${en}</p>
<p>${ok ? 'אפשר לסגור את החלון ולחזור ל-LiveX.' : ''}</p><p class="muted" dir="ltr">${ok ? 'You can close this window and return to LiveX.' : ''}</p>
</div></main></body></html>`);
}));

r.use(requireAuth, requireVerified, requireApp);
r.get('/providers', h(async (_req, res) => res.json({ providers: O.providers() })));
r.post('/:platform/start', limiter('oauth-start', 20, 600_000, (req) => req.user.id), h(async (req, res) => res.json(O.start(req.user, req.token.dev, String(req.params.platform)))));
r.get('/flows/:flowId', limiter('oauth-poll', 400, 600_000, (req) => req.user.id), h(async (req, res) => res.json(O.poll(req.user, req.token.dev, req.params.flowId))));
r.post('/flows/:flowId/cancel', h(async (req, res) => res.json(O.cancel(req.user, req.token.dev, req.params.flowId))));
r.post('/:platform/refresh', limiter('oauth-refresh', 60, 600_000, (req) => req.user.id), h(async (req, res) => res.json(await O.refresh(String(req.params.platform), str(req.body?.refreshToken, { min: 8, max: 4000, name: 'refreshToken' })))));
r.post('/:platform/revoke', h(async (req, res) => res.json(await O.revoke(String(req.params.platform), String(req.body?.token || '').slice(0, 4000)))));
module.exports = r;
