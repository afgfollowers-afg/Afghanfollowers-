// Lightweight in-memory rate limiter for Vercel serverless functions.
//
// No Redis/KV store exists anywhere in this project (no package.json
// dependency, and JSONBin — the only persistent store here — isn't suited
// to high-frequency counter writes/races). This limiter lives in each
// function instance's warm memory: it resets on cold start and isn't
// shared across concurrently-running instances, so it's a best-effort
// deterrent against scripted brute force, not an airtight guarantee.
// Still a real improvement over the previous state of zero throttling —
// Vercel keeps a function instance warm across the burst of requests an
// actual brute-force/credential-stuffing attempt would generate.
const buckets = new Map(); // "action:ip" -> { count, resetAt }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Sweeps expired buckets out on a cadence tied to calls to rateLimit()
// rather than a real timer — a setInterval would keep a serverless
// instance alive forever and leak across invocations.
let lastSweep = Date.now();
function sweepIfDue() {
  const now = Date.now();
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  buckets.forEach(function (b, k) { if (now > b.resetAt) buckets.delete(k); });
}

// Returns true if this request is still within its limit (and counts it
// against the window), false if the caller should be rejected. `actionKey`
// keeps different endpoints/actions in separate buckets so a burst of
// register attempts doesn't also throttle login from the same IP.
function rateLimit(req, actionKey, maxAttempts, windowMs) {
  sweepIfDue();
  const key = actionKey + ':' + clientIp(req);
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= maxAttempts;
}

module.exports = { rateLimit, clientIp };
