'use strict';
// Fixed-window in-memory rate limiter (per process). Put a shared limiter
// (e.g. at the reverse proxy) in front when running multiple instances.
const buckets = new Map();
function hit(key, limit, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= t) { b = { count: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.count += 1;
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - t) / 1000) };
}
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset <= t) buckets.delete(k);
}, 60_000).unref();

// RATE_LIMIT_MULTIPLIER exists for automated test runs only.
const MULT = Math.max(1, parseInt(process.env.RATE_LIMIT_MULTIPLIER || '1', 10) || 1);
function limiter(name, limit, windowMs, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    const r = hit(`${name}:${keyFn(req)}`, limit * MULT, windowMs);
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests. Try again later.', retryAfter: r.retryAfter });
    }
    next();
  };
}
function reset() { buckets.clear(); }
module.exports = { limiter, hit, reset };
