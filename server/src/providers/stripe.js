'use strict';
const crypto = require('node:crypto');
const config = require('../config');

// Stripe Checkout via the REST API (no SDK). Active when STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are configured. Fulfillment happens on the signed
// `checkout.session.completed` webhook only.
async function api(path, form) {
  const body = new URLSearchParams(form);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.payments.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error ${res.status}`);
  return json;
}

function verifySignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = parseInt(parts.t, 10);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

module.exports = {
  name: 'stripe',
  isConfigured: () => !!(config.payments.stripeSecretKey && config.payments.stripeWebhookSecret),
  async createCheckout(order, product, user) {
    const s = await api('checkout/sessions', {
      mode: 'payment',
      'line_items[0][price_data][currency]': 'ils',
      'line_items[0][price_data][unit_amount]': String(order.amount_agorot),
      'line_items[0][price_data][product_data][name]': product.name,
      'line_items[0][quantity]': '1',
      customer_email: user.email,
      client_reference_id: order.id,
      'metadata[order_id]': order.id,
      success_url: `${config.publicUrl}/account.html?paid=${encodeURIComponent(order.id)}`,
      cancel_url: `${config.publicUrl}/index.html#pricing`,
    });
    return { checkoutUrl: s.url, providerRef: s.id };
  },
  // Returns {orderId, providerRef, amountAgorot, currency} for a paid event or null.
  parseWebhook(rawBody, headers) {
    if (!verifySignature(rawBody, headers['stripe-signature'], config.payments.stripeWebhookSecret)) {
      const e = new Error('Invalid signature'); e.status = 400; throw e;
    }
    const evt = JSON.parse(rawBody);
    if (evt.type !== 'checkout.session.completed') return null;
    const s = evt.data.object;
    if (s.payment_status !== 'paid') return null;
    return { orderId: s.metadata?.order_id || s.client_reference_id, providerRef: s.id, amountAgorot: s.amount_total, currency: s.currency };
  },
  verifySignature,
};
