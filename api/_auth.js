// Shared helper: server-issued, server-verified session tokens.
//
// Previously "being logged in" meant nothing more than a browser having a
// plain JSON object in localStorage — the server never verified anyone's
// identity at all, only a single static key shared by every page (customer
// and admin alike). These tokens are the real replacement: signed with a
// server-only secret (AUTH_JWT_SECRET, set in Vercel's Environment
// Variables — never shipped to any client, unlike the old DB_CLIENT_KEY),
// so a client can prove who it is without the server having to trust
// whatever the client claims.
//
// Self-signed rather than a library: no package.json/npm dependency exists
// in this repo yet, and Node's built-in crypto is enough for a plain
// HMAC-SHA256, JWT-shaped token (header.payload.signature, base64url) —
// interoperable with real JWT tooling later if ever needed, without adding
// one now.
const crypto = require('crypto');

const SECRET = process.env.AUTH_JWT_SECRET || '';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

// payload should at minimum include { sub: userId, role: 'user'|'admin' }.
function signToken(payload, ttlSeconds) {
  if (!SECRET) throw new Error('AUTH_JWT_SECRET not configured');
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, { iat: now, exp: now + (ttlSeconds || DEFAULT_TTL_SECONDS) });
  const headerB64 = base64url(JSON.stringify(header));
  const bodyB64 = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(headerB64 + '.' + bodyB64).digest();
  return headerB64 + '.' + bodyB64 + '.' + base64url(sig);
}

// Returns the decoded payload if the token is validly signed and unexpired,
// otherwise null. Never throws — callers should treat null as "no identity",
// the same as an absent token, not as an error.
function verifyToken(token) {
  if (!SECRET || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  let expectedSigB64;
  try {
    const expectedSig = crypto.createHmac('sha256', SECRET).update(headerB64 + '.' + bodyB64).digest();
    expectedSigB64 = base64url(expectedSig);
  } catch (e) { return null; }
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSigB64);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(base64urlDecode(bodyB64)); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// Pulls a Bearer token out of a request's Authorization header and verifies
// it — the one place every protected endpoint should go through, so the
// header format/parsing stays consistent everywhere it's checked.
function getAuth(req) {
  const header = req.headers && req.headers.authorization;
  if (!header || header.indexOf('Bearer ') !== 0) return null;
  return verifyToken(header.slice(7));
}

// A short, non-reversible fingerprint of AUTH_JWT_SECRET — safe to expose
// in diagnostics (unlike the secret itself) since it can't be used to
// forge a token, only to compare "are two processes seeing the same
// secret value" — which every serverless function in this project reads
// from process.env independently at its own module-load time, so two
// functions could in principle disagree if one is running on a stale warm
// instance from before the value was last changed. Wired up to actually
// resolve api/paypal-verify.js's "write reports ok:true but the write
// gate silently routes it through the customer-restricted path" report.
const SECRET_FINGERPRINT = SECRET ? crypto.createHash('sha256').update(SECRET).digest('hex').slice(0, 8) : 'unset';

module.exports = { signToken, verifyToken, getAuth, AUTH_CONFIGURED: !!SECRET, SECRET_FINGERPRINT };
