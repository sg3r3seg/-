'use strict';
const config = require('./config');

class ApiError extends Error {
  constructor(code, message, status, data) { super(message); this.code = code; this.status = status; this.data = data; }
}

// HTTP client for the LiveX server. Network failures and non-2xx responses
// ALWAYS reject — callers never treat a failed call as success.
async function request(method, path, { body, token, deviceUid, timeoutMs = 12000, raw = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(config.apiBase + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: raw ? '*/*' : 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(deviceUid ? { 'X-LiveX-Device': deviceUid } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
    });
  } catch (e) {
    throw new ApiError('NETWORK', e.name === 'AbortError' ? 'LiveX server did not respond in time' : 'Cannot reach the LiveX server', 0);
  } finally { clearTimeout(timer); }
  if (raw && res.ok) return Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new ApiError(json?.error || `HTTP_${res.status}`, json?.message || `Server error ${res.status}`, res.status, json);
  if (json === null) throw new ApiError('BAD_RESPONSE', 'Invalid response from server', res.status);
  return json;
}
module.exports = { request, ApiError };
