'use strict';
const path = require('node:path');
const fs = require('node:fs');

// Load server/.env if present (simple KEY=VALUE parser, no external deps).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const int = (k, d) => parseInt(env(k, String(d)), 10);

const root = path.join(__dirname, '..');

const config = {
  root,
  port: int('PORT', 8787),
  host: env('HOST', '127.0.0.1'),
  // Public base URL of the website/API (used in email links). Must be HTTPS in production.
  publicUrl: env('PUBLIC_URL', 'http://127.0.0.1:8787').replace(/\/$/, ''),
  production: env('NODE_ENV', 'development') === 'production',
  dataDir: env('DATA_DIR', path.join(root, 'data')),
  keysDir: env('KEYS_DIR', path.join(root, 'keys')),
  releasesDir: env('RELEASES_DIR', path.join(root, 'releases')),
  trustProxy: env('TRUST_PROXY', '0') === '1',

  accessTokenTtlSec: int('ACCESS_TOKEN_TTL_SEC', 15 * 60),
  refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),
  // Offline policy: how long a signed license lease stays valid without reaching the server.
  leaseTtlHours: int('LEASE_TTL_HOURS', 48),
  activationCodeTtlDays: int('ACTIVATION_CODE_TTL_DAYS', 30),
  activationMaxFailures: int('ACTIVATION_MAX_FAILURES', 5),
  activationFailureWindowMin: int('ACTIVATION_FAILURE_WINDOW_MIN', 15),
  maxDevicesPerLicense: int('MAX_DEVICES_PER_LICENSE', 1),
  transferLimitPerYear: int('TRANSFER_LIMIT_PER_YEAR', 3),

  payments: {
    provider: env('PAYMENT_PROVIDER', 'sandbox'), // 'sandbox' | 'stripe'
    stripeSecretKey: env('STRIPE_SECRET_KEY', ''),
    stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
  },

  smtp: {
    host: env('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    secure: env('SMTP_SECURE', '0') === '1',
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('MAIL_FROM', 'LiveX <no-reply@localhost>'),
  },

  adminToken: env('ADMIN_TOKEN', ''),

  // Official OAuth apps for connecting creators' platform accounts. Client secrets
  // live only here (server side); the desktop app never sees them.
  oauth: Object.fromEntries(['google', 'twitch', 'kick', 'tiktok', 'discord'].map((p) => {
    const P = p.toUpperCase();
    return [p, {
      clientId: env(`OAUTH_${P}_CLIENT_ID`, ''),
      clientSecret: env(`OAUTH_${P}_CLIENT_SECRET`, ''),
      // Endpoint overrides exist for automated tests only and are ignored in production.
      authorizeUrl: env(`OAUTH_${P}_AUTHORIZE_URL`, ''),
      tokenUrl: env(`OAUTH_${P}_TOKEN_URL`, ''),
      profileUrl: env(`OAUTH_${P}_PROFILE_URL`, ''),
      revokeUrl: env(`OAUTH_${P}_REVOKE_URL`, ''),
    }];
  })),

  ai: {
    elevenLabsKey: env('ELEVENLABS_API_KEY', ''),
    elevenLabsModel: env('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
  },
};

if (config.production) {
  if (!config.publicUrl.startsWith('https://')) {
    throw new Error('PUBLIC_URL must be https:// in production');
  }
  if (config.payments.provider === 'sandbox') {
    throw new Error('PAYMENT_PROVIDER=sandbox is not allowed in production');
  }
}

module.exports = config;
