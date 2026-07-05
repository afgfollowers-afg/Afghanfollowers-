// Shared helper: every server-side function that talks to /api/db must send
// this key so db.js can tell first-party requests apart from the open internet.
// Set DB_SERVICE_KEY in the Vercel project's Environment Variables (same value
// must also be present in the DB_CLIENT_KEY constant near the top of
// admin.html, smm-panel.html and auth.html).
const DB_SERVICE_KEY = process.env.DB_SERVICE_KEY;

function dbHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra || {}, DB_SERVICE_KEY ? { 'x-db-key': DB_SERVICE_KEY } : {});
}

module.exports = { dbHeaders, DB_SERVICE_KEY };
