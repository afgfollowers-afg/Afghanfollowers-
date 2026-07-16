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
// API routes (e.g. paypal-verify.js -> /api/db).
//
// A prior version of this pointed at process.env.VERCEL_URL (the
// deployment's own *.vercel.app host) to sidestep a suspected apex<->www
// redirect on the custom domain stripping the Authorization header on
// cross-origin redirects. That broke login entirely — including plain GET
// reads that don't even carry Authorization — which means VERCEL_URL is not
// reachable from inside this project's own functions the way that fix
// assumed (most likely Vercel's Deployment Protection / Vercel
// Authentication wall sits in front of the raw deployment URL and rejects
// server-to-server requests that don't carry its own bypass token/cookie,
// unrelated to anything this codebase controls). Reverted to the known-good
// custom domain. The Authorization-stripped-on-redirect bug this was meant
// to fix (see diagnoseAuth() in _auth.js — smm_users_restricted with reason
// no-authorization-header-received) is still open; the next fix needs to
// confirm which of afghanfollowers.online / www.afghanfollowers.online is
// the actual non-redirecting target and point directly at that one, rather
// than guessing at an internal host this environment apparently blocks.
const API_BASE = 'https://afghanfollowers.online';

module.exports = { dbHeaders, DB_SERVICE_KEY, API_BASE };
