'use strict';
const express = require('express');
const path = require('node:path');
const config = require('./config');
const { ApiError } = require('./http');
const pkg = require('../package.json');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    });
    if (config.publicUrl.startsWith('https://')) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  // Stripe webhook must receive the raw body -> mounted before JSON parsing.
  app.use('/api/payments/webhook', require('./routes/shop'));
  app.use('/api/tts', express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/dev/mailbox', (req, res) => {
    const mailer = require('./mailer');
    const ip = req.socket.remoteAddress || '';
    if (!mailer.devMailboxActive() || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
    res.json({ messages: mailer.readOutbox().reverse().slice(0, 200).map((m) => ({ to: m.to, subject: m.subject, text: m.text, tag: m.tag, at: m.at })) });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'livex', version: pkg.version, time: Date.now() }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/account', require('./routes/account'));
  app.use('/api', require('./routes/shop'));
  app.use('/api/app', require('./routes/app'));
  app.use('/api/tts', require('./routes/tts'));
  app.use('/api/updates', require('./routes/updates'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/oauth', require('./routes/oauth'));
  const winners = require('./routes/winners');
  app.use('/api/rooms', winners.rooms);
  app.use('/api/winner', winners.winner);
  app.get('/w/:code', winners.page);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' }));

  app.use(express.static(path.join(__dirname, '..', 'web'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ApiError || (err.status && err.code)) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.extra || {}) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_JSON', message: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_LARGE', message: 'Request too large' });
    if (err.status === 404) return res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Internal server error' });
  });
  return app;
}
module.exports = { createApp };
