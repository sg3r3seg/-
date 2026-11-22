'use strict';
class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra;
  }
}
const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };

// Wrap async handlers so thrown ApiErrors become JSON responses.
const h = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

// Minimal input validation helpers.
const str = (v, { min = 0, max = 500, name = 'field', pattern } = {}) => {
  if (typeof v !== 'string') fail(400, 'VALIDATION', `${name} is required`);
  const s = v.trim();
  if (s.length < min || s.length > max) fail(400, 'VALIDATION', `${name} must be ${min}-${max} characters`);
  if (pattern && !pattern.test(s)) fail(400, 'VALIDATION', `${name} is invalid`);
  return s;
};
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const email = (v) => str(v, { min: 5, max: 254, name: 'email', pattern: EMAIL }).toLowerCase();
const password = (v) => {
  if (typeof v !== 'string' || v.length < 8 || v.length > 200) fail(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) fail(400, 'WEAK_PASSWORD', 'Password must contain letters and numbers');
  return v;
};

module.exports = { ApiError, fail, h, str, email, password };
