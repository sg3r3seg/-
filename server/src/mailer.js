'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// Real SMTP delivery when SMTP_HOST is configured. Otherwise (development only)
// messages are written to data/outbox/*.json so the flow can be tested end to
// end. The server never reports an email as "sent" when it was only queued.
let transport;
function getTransport() {
  if (transport !== undefined) return transport;
  if (!config.smtp.host) { transport = null; return null; }
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

const outboxDir = () => path.join(config.dataDir, 'outbox');

async function send({ to, subject, text, html, tag }) {
  const t = getTransport();
  if (t) {
    await t.sendMail({ from: config.smtp.from, to, subject, text, html });
    return { delivered: true, via: 'smtp' };
  }
  if (config.production) throw new Error('SMTP is not configured');
  fs.mkdirSync(outboxDir(), { recursive: true });
  const file = path.join(outboxDir(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify({ to, subject, text, tag, at: new Date().toISOString() }, null, 2));
  console.log(`[mail:dev-outbox] ${tag || ''} -> ${to}: ${subject} (${path.basename(file)})`);
  return { delivered: false, via: 'dev-outbox', file };
}

function readOutbox() {
  if (!fs.existsSync(outboxDir())) return [];
  return fs.readdirSync(outboxDir()).sort().map((f) => JSON.parse(fs.readFileSync(path.join(outboxDir(), f), 'utf8')));
}

const wrap = (title, bodyHtml) => `<!doctype html><html><body style="margin:0;background:#05070d;font-family:Segoe UI,Arial,sans-serif;color:#e6f1ff">
<div style="max-width:560px;margin:0 auto;padding:32px">
<div style="font-size:28px;font-weight:800;letter-spacing:4px;color:#22e4d9">LIVEX</div>
<div style="font-size:11px;letter-spacing:3px;color:#7aa6c9;margin-bottom:24px">ONE PLATFORM. EVERY CREATOR.</div>
<div style="background:#0b1424;border:1px solid #16314d;border-radius:14px;padding:24px">
<h2 style="margin-top:0;color:#fff">${title}</h2>${bodyHtml}</div></div></body></html>`;

module.exports = { send, readOutbox, wrap };
