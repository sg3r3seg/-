'use strict';
const config = require('./config');
const db = require('./db');
const { keys } = require('./crypto');
const { createApp } = require('./app');

keys(); // fail fast if key material is missing
db.open();
const server = createApp().listen(config.port, config.host, () => {
  console.log(`LiveX server listening on http://${config.host}:${config.port} (public URL ${config.publicUrl})`);
  console.log(`Payments provider: ${config.payments.provider}${config.smtp.host ? '' : ' | Email: dev outbox (SMTP not configured)'}`);
});
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
