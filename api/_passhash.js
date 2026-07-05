// Server-side mirror of the client's hashPass()/genSalt() in admin.html,
// smm-panel.html and auth.html (salted + stretched SHA-256). Must stay in
// sync with those so a server-issued password (e.g. after a reset) verifies
// correctly against the client's login check.
const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPass(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < 3000; i++) h = sha256Hex(h + salt);
  return h;
}

module.exports = { hashPass, genSalt };
