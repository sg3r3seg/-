'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id       TEXT UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  email_verified_at INTEGER,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  purpose     TEXT NOT NULL,           -- verify | reset | transfer
  token_hash  TEXT NOT NULL UNIQUE,
  meta        TEXT,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  client      TEXT NOT NULL,           -- app | web
  device_uid  TEXT,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  code          TEXT PRIMARY KEY,      -- PRO | TTS | BUNDLE
  name          TEXT NOT NULL,
  price_agorot  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'ILS',
  entitlements  TEXT NOT NULL          -- JSON array
);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  product_code  TEXT NOT NULL REFERENCES products(code),
  amount_agorot INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,         -- pending | paid | failed | refunded
  provider      TEXT NOT NULL,
  provider_ref  TEXT UNIQUE,
  created_at    INTEGER NOT NULL,
  paid_at       INTEGER
);

CREATE TABLE IF NOT EXISTS licenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id     TEXT NOT NULL UNIQUE,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  order_id       TEXT NOT NULL UNIQUE REFERENCES orders(id),
  product_code   TEXT NOT NULL,
  entitlements   TEXT NOT NULL,
  personal_code  TEXT NOT NULL UNIQUE,
  holder_name    TEXT NOT NULL,
  status         TEXT NOT NULL,        -- pending_activation | active | revoked
  max_devices    INTEGER NOT NULL,
  purchased_at   INTEGER NOT NULL,
  activated_at   INTEGER,
  revoked_at     INTEGER,
  revoke_reason  TEXT
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id     INTEGER NOT NULL REFERENCES licenses(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  code_hash      TEXT NOT NULL UNIQUE,
  code_enc       TEXT NOT NULL,
  status         TEXT NOT NULL,        -- issued | used | revoked
  expires_at     INTEGER NOT NULL,
  used_at        INTEGER,
  used_device_uid TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id      TEXT NOT NULL UNIQUE,
  device_uid     TEXT NOT NULL,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  license_id     INTEGER NOT NULL REFERENCES licenses(id),
  name           TEXT NOT NULL,
  os             TEXT NOT NULL,
  status         TEXT NOT NULL,        -- active | deactivated
  activated_at   INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  deactivated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_license ON devices(license_id, status);

CREATE TABLE IF NOT EXISTS transfers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  license_id   INTEGER NOT NULL,
  device_id    INTEGER NOT NULL,
  status       TEXT NOT NULL,          -- pending | completed | expired
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS activation_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  ip         TEXT,
  success    INTEGER NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_consents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  voice_owner_name TEXT NOT NULL,
  statement        TEXT NOT NULL,
  provider_voice_id TEXT,
  ip               TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
`;

// Prices are authoritative on the server. Agorot = 1/100 ILS.
const PRODUCTS = [
  { code: 'PRO', name: 'LiveX PRO', price: 1990, entitlements: ['pro'] },
  { code: 'TTS', name: 'LiveX TTS', price: 2990, entitlements: ['tts'] },
  { code: 'BUNDLE', name: 'LiveX COMPLETE BUNDLE', price: 3990, entitlements: ['pro', 'tts'] },
];

let db;
function open(file) {
  if (db) return db;
  const dbFile = file || process.env.DB_FILE || path.join(config.dataDir, 'livex.db');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  const up = db.prepare(`INSERT INTO products(code,name,price_agorot,currency,entitlements)
    VALUES(?,?,?,'ILS',?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,
    price_agorot=excluded.price_agorot, entitlements=excluded.entitlements`);
  for (const p of PRODUCTS) up.run(p.code, p.name, p.price, JSON.stringify(p.entitlements));
  return db;
}

function get() {
  return db || open();
}

// Serialized write transaction. node:sqlite is synchronous, so a JS-level
// BEGIN IMMEDIATE..COMMIT block cannot interleave with other requests.
function tx(fn) {
  const d = get();
  d.exec('BEGIN IMMEDIATE');
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

function close() {
  if (db) db.close();
  db = undefined;
}

const now = () => Date.now();

function audit(userId, action, detail, ip) {
  get().prepare('INSERT INTO audit_log(user_id,action,detail,ip,created_at) VALUES(?,?,?,?,?)')
    .run(userId ?? null, action, detail ? JSON.stringify(detail) : null, ip ?? null, now());
}

module.exports = { open, get, tx, close, now, audit, PRODUCTS };
