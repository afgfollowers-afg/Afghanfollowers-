// Shared helper: every server-side function that talks to /api/db must send
// this key so db.js can tell first-party requests apart from the open internet.
// Set DB_SERVICE_KEY in the Vercel project's Environment Variables (same value
// must also be present in the DB_CLIENT_KEY constant near the top of
// admin.html, smm-panel.html and auth.html).
const DB_SERVICE_KEY = process.env.DB_SERVICE_KEY;

// db.js's smm_users authorization gate (see _auth.js) restricts a plain
// customer token to their own record and a narrow set of self-service
// transaction types — but server-to-server callers here (paypal-verify.js
// crediting a verified payment, auth.js creating a user or upgrading a
// password, sync-orders.js) aren't acting on behalf of any one browser
// session and need the same full access an admin token has. Minting a
// short-lived admin-role token for every server-to-server call (rather than
// exempting "no token" from the gate entirely) means the gate has exactly
// one trust path to reason about instead of two.
let _signToken = null;
try { _signToken = require('./_auth').signToken; } catch (e) { /* _auth.js optional at require time */ }

function dbHeaders(extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  if (DB_SERVICE_KEY) headers['x-db-key'] = DB_SERVICE_KEY;
  if (_signToken) {
    try { headers['Authorization'] = 'Bearer ' + _signToken({ sub: 'service', role: 'admin' }, 60); } catch (e) { /* AUTH_JWT_SECRET not configured yet */ }
  }
  return headers;
}

// Base URL for server-to-server calls back into this same deployment's own
// API routes (e.g. paypal-verify.js -> /api/db). Deliberately NOT the
// public custom domain: if the custom domain has an apex<->www redirect
// configured (common Vercel setup — one is primary, the other 301/308s to
// it), a request across that redirect changes origin, and per the Fetch
// spec, sensitive headers — Authorization, Cookie — are stripped from a
// cross-origin redirected request while ordinary headers like x-db-key are
// not. That silently turned every admin-role service token into "no
// Authorization header received" by the time it reached db.js, even though
// dbHeaders() built it correctly and the two processes agreed on the same
// AUTH_JWT_SECRET (see diagnoseAuth() in _auth.js). VERCEL_URL is the
// deployment's own host, which the platform serves directly with no
// custom-domain redirect in front of it, so calls through it never cross
// an origin boundary and keep every header intact.
const API_BASE = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://afghanfollowers.online';

module.exports = { dbHeaders, DB_SERVICE_KEY, API_BASE };
