'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const C = require('../crypto');
const L = require('../services/licenses');
const providers = require('../providers');
const { h, fail } = require('../http');
const { requireAuth, requireVerified } = require('../middleware');
const { limiter } = require('../ratelimit');

const r = express.Router();

r.get('/products', h(async (_req, res) => {
  const rows = db.get().prepare('SELECT * FROM products ORDER BY price_agorot').all();
  const p = providers.active();
  res.json({
    provider: p.name,
    sandbox: p.name === 'sandbox',
    available: p.isConfigured(),
    products: rows.map((x) => ({ code: x.code, name: x.name, priceAgorot: x.price_agorot, price: (x.price_agorot / 100).toFixed(2), currency: x.currency, entitlements: JSON.parse(x.entitlements) })),
  });
}));

r.post('/shop/checkout', requireAuth, requireVerified, limiter('checkout', 20, 3600_000, (req) => req.user.id), h(async (req, res) => {
  const product = db.get().prepare('SELECT * FROM products WHERE code=?').get(String(req.body?.product || ''));
  if (!product) fail(400, 'UNKNOWN_PRODUCT', 'Unknown product');
  const p = providers.active();
  if (!p.isConfigured()) fail(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured on this server');
  const order = {
    id: `LVX-ORD-${C.randomChars(10)}`, user_id: req.user.id, product_code: product.code,
    amount_agorot: product.price_agorot, currency: product.currency,
  };
  db.get().prepare(`INSERT INTO orders(id,user_id,product_code,amount_agorot,currency,status,provider,created_at)
    VALUES(?,?,?,?,?,'pending',?,?)`).run(order.id, order.user_id, order.product_code, order.amount_agorot, order.currency, p.name, db.now());
  const { checkoutUrl, providerRef } = await p.createCheckout(order, product, req.user);
  db.get().prepare('UPDATE orders SET provider_ref=? WHERE id=?').run(providerRef, order.id);
  db.audit(req.user.id, 'checkout_created', { orderId: order.id, product: product.code }, req.ip);
  res.json({ orderId: order.id, checkoutUrl, amount: (order.amount_agorot / 100).toFixed(2), currency: order.currency });
}));

r.get('/shop/orders/:id', requireAuth, h(async (req, res) => {
  const o = db.get().prepare('SELECT id,product_code,amount_agorot,currency,status,provider,created_at,paid_at FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!o) fail(404, 'ORDER_NOT_FOUND', 'Order not found');
  res.json({ order: o });
}));

// Sandbox "payment provider" confirmation. Exists only when PAYMENT_PROVIDER=sandbox
// (which config.js refuses in production). Charges nothing.
r.post('/payments/sandbox/complete', requireAuth, requireVerified, h(async (req, res) => {
  if (config.payments.provider !== 'sandbox' || config.production) fail(404, 'NOT_FOUND', 'Not found');
  const o = db.get().prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(String(req.body?.orderId || ''), req.user.id);
  if (!o) fail(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (o.provider !== 'sandbox') fail(400, 'WRONG_PROVIDER', 'Not a sandbox order');
  const result = await L.fulfillOrder(o.id, { providerRef: `sbx_${o.id}`, amountAgorot: o.amount_agorot, currency: o.currency });
  res.json({ ok: true, license: L.licenseView(result.license, { withCode: true }) });
}));

// Stripe webhook (raw body needed for signature verification).
r.post('/payments/webhook/stripe', express.raw({ type: '*/*', limit: '1mb' }), h(async (req, res) => {
  const p = providers.providers.stripe;
  if (!p.isConfigured()) fail(404, 'NOT_FOUND', 'Not found');
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let evt;
  try { evt = p.parseWebhook(raw, req.headers); } catch (e) { fail(400, 'BAD_SIGNATURE', e.message); }
  if (evt) await L.fulfillOrder(evt.orderId, evt);
  res.json({ received: true });
}));

module.exports = r;
