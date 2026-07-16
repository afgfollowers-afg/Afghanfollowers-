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
// API routes (e.g. paypal-verify.js -> /api/db). Always the known-good
// public custom domain — a prior attempt pointed this at process.env.
// VERCEL_URL (the deployment's own *.vercel.app host) instead, reasoning
// it would dodge a suspected redirect on the custom domain, but that broke
// login entirely (even plain GET reads that carry no Authorization at all),
// meaning that internal host isn't reachable from inside this project's own
// functions the way that fix assumed — most likely Vercel's Deployment
// Protection sits in front of the raw deployment URL. See fetchInternal()
// below for the actual fix to the redirect problem, which doesn't require
// leaving this domain at all.
const API_BASE = 'https://afghanfollowers.online';

// A same-process call to fetch(url, {redirect:'follow'}) (the default) that
// crosses an origin boundary — e.g. Vercel's own apex<->www canonical-
// domain redirect on the custom domain above, whichever direction it runs —
// silently drops the Authorization header per the Fetch spec (ordinary
// headers like x-db-key are unaffected). That's exactly what live
// diagnostics showed: diagnoseAuth() reporting "no-authorization-header-
// received" on every restricted PayPal write despite dbHeaders() building
// the header correctly and both processes agreeing on AUTH_JWT_SECRET (see
// SECRET_FINGERPRINT in _auth.js) — confirmed by reproducing the identical
// pattern locally against a throwaway HTTP server (Authorization stripped,
// x-db-key intact, only on a genuinely cross-origin redirect).
//
// redirect:'manual' hands back the raw 3xx response (status + a readable
// Location header) instead of following it automatically — verified locally
// that Node's fetch does NOT collapse this into browsers' unreadable
// "opaqueredirect" response the way cross-origin redirects do client-side.
// Since this call only ever targets our own first-party domain, it's safe
// to follow that Location manually with the original headers (including
// Authorization) still attached, which a plain fetch() with default
// redirect handling refuses to do for a cross-origin hop. Works identically
// whether or not a redirect actually happens, and — unlike the VERCEL_URL
// attempt — never leaves the public custom domain, so it can't run into
// Vercel's Deployment Protection wall around the internal deployment host.
async function fetchInternal(url, opts, hopsLeft) {
  opts = opts || {};
  hopsLeft = hopsLeft === undefined ? 5 : hopsLeft;
  const resp = await fetch(url, Object.assign({}, opts, { redirect: 'manual' }));
  if (resp.status >= 300 && resp.status < 400 && hopsLeft > 0) {
    const location = resp.headers.get('location');
    if (location) {
      const nextUrl = new URL(location, url).toString();
      return fetchInternal(nextUrl, opts, hopsLeft - 1);
    }
  }
  return resp;
}

module.exports = { dbHeaders, DB_SERVICE_KEY, API_BASE, fetchInternal };
