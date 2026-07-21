// Vercel Serverless Function — Real server-side login/register/admin-login.
//
// Folded into one file (dispatched by ?action=) rather than three separate
// endpoints, same as sync-orders.js's ?job= pattern — this repo has no
// framework/build step to route multiple paths to one function, and
// Vercel's Hobby plan caps deployments at 12 serverless functions; this
// codebase was already at 11 before these were added.
//
// Previously "being logged in" (customer or admin) meant nothing more than
// a browser holding a plain JSON object in localStorage, compared against a
// password hash entirely in client-side JavaScript — the server never
// verified anyone's identity. These three actions run that exact same
// password check (via _passhash.js, which mirrors the client's
// hashPass()/genSalt() byte-for-byte, so no existing account needs a forced
// reset) here on the server, and only then issue a signed session token
// (see _auth.js) that api/db.js and api/paypal-verify.js can trust.
const { dbHeaders, API_BASE, fetchInternal } = require('./_dbkey');
const { hashPass, genSalt } = require('./_passhash');
const { signToken, AUTH_CONFIGURED } = require('./_auth');
const { rateLimit } = require('./_ratelimit');

const SITE = 'https://afghanfollowers.online';

// Per-IP attempt caps for each action — none of this existed before, so
// login/register/admin-login could all be brute-forced with no throttling
// at all. admin-login gets the tightest window since a compromised admin
// account is the highest-impact outcome; register is capped mainly to stop
// mass fake-account creation rather than credential guessing.
const RATE_LIMITS = {
  login: [10, 5 * 60 * 1000],
  register: [5, 15 * 60 * 1000],
  google: [10, 5 * 60 * 1000],
  'admin-login': [5, 15 * 60 * 1000]
};
const DEFAULT_ADMIN_CREDS = { username: 'admin', password: hashPass('admin123', 'a1f9c3e7b2d84605'), salt: 'a1f9c3e7b2d84605' };

async function handleLogin(body) {
  const email = body.email ? String(body.email).trim().toLowerCase() : '';
  const phone = body.phone ? String(body.phone).trim() : '';
  const password = body.password;
  if ((!email && !phone) || !password) {
    return { ok: false, error: 'Missing email/phone or password' };
  }

  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const users = db.smm_users || [];
  const user = email
    ? users.find((u) => u.email && u.email.toLowerCase() === email)
    : users.find((u) => u.phone === phone);
  if (!user || !user.password) return { ok: false, error: 'Invalid credentials' };

  let ok = false;
  let upgrade = null;
  if (user.salt) {
    ok = hashPass(password, user.salt) === user.password;
  } else if (Buffer.from(String(password), 'utf8').toString('base64') === user.password) {
    // Legacy btoa()-encoded account — upgrade transparently on successful
    // login, same as the old client-side verifyPass() did.
    ok = true;
    const salt = genSalt();
    upgrade = { salt, password: hashPass(password, salt) };
  }
  if (!ok) return { ok: false, error: 'Invalid credentials' };
  if (user.status === 'suspended') return { ok: false, error: 'Account suspended' };

  if (upgrade) {
    const updatedUser = Object.assign({}, user, upgrade);
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST', headers: dbHeaders(),
      body: JSON.stringify({ smm_users: [updatedUser], smm_ts: Date.now() })
    });
  }

  const token = signToken({ sub: user.id, role: user.role || 'user' });
  const safeUser = Object.assign({}, user, upgrade || {});
  delete safeUser.password;
  delete safeUser.salt;
  return { ok: true, token, user: safeUser };
}

async function handleRegister(body) {
  const fname = String(body.fname || '').trim();
  const lname = String(body.lname || '').trim();
  const email = body.email ? String(body.email).trim().toLowerCase() : '';
  const phone = body.phone ? String(body.phone).trim() : '';
  const password = body.password;
  const inviteCode = String(body.inviteCode || '').trim().toUpperCase();
  const extra = (body.extra && typeof body.extra === 'object') ? body.extra : {};

  if (!fname || !lname) return { ok: false, error: 'First and last name are required' };
  if (!email && !phone) return { ok: false, error: 'Email or phone is required' };
  if (!password || String(password).length < 8) return { ok: false, error: 'Password must be at least 8 characters' };

  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const users = db.smm_users || [];
  if (email && users.some((u) => u.email && u.email.toLowerCase() === email)) {
    return { ok: false, error: 'Email already registered.' };
  }
  if (phone && users.some((u) => u.phone === phone)) {
    return { ok: false, error: 'Phone already registered.' };
  }

  const salt = genSalt();
  const newUser = {
    id: Date.now(), fname, lname, email, phone,
    password: hashPass(password, salt), salt, inviteCode,
    role: 'user', balance: 0, orders: 0,
    joined: new Date().toISOString(), status: 'active',
    wallet: [], transactions: [], extra
  };

  await fetchInternal(API_BASE + '/api/db', {
    method: 'POST', headers: dbHeaders(),
    body: JSON.stringify({ smm_users: [newUser], smm_ts: Date.now() })
  });

  const token = signToken({ sub: newUser.id, role: 'user' });
  const safeUser = Object.assign({}, newUser);
  delete safeUser.password;
  delete safeUser.salt;
  return { ok: true, token, user: safeUser };
}

// Google Sign-In used to be handled entirely client-side (auth.html decoded
// the ID token's payload itself with atob() — never checking its signature
// at all — and called createSess(user) with NO token argument, since there
// was nothing server-side to issue one from). Two separate problems:
// 1. createSess() with no token meant every Google-signed-in session had
//    token:undefined, which smm-panel.html's page-load check treats as no
//    identity at all and immediately bounces back to auth.html?reauth=1 —
//    "registration" appeared to succeed (a local user object got created)
//    but the user could never actually get past the login page.
// 2. Trusting the client-decoded payload meant anyone could POST a forged
//    base64 blob shaped like a Google credential with any email of their
//    choosing — no proof it ever came from Google at all.
// Fixed by verifying the credential really was issued by Google (and for
// this site's own configured Google Client ID) via Google's tokeninfo
// endpoint — which does real signature verification — before creating the
// account and issuing a real signed session token, the same as every other
// login path in this file.
async function handleGoogleLogin(body) {
  const credential = body.credential;
  if (!credential) return { ok: false, error: 'Missing Google credential' };

  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const cfg = db.smm_auth_settings || {};
  if (!cfg.googleClientId) return { ok: false, error: 'Google Sign-In is not configured' };

  let payload;
  try {
    const verifyResp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    payload = await verifyResp.json();
    if (!verifyResp.ok || payload.error) return { ok: false, error: 'Invalid Google credential' };
  } catch (e) {
    return { ok: false, error: 'Could not verify Google credential' };
  }
  if (payload.aud !== cfg.googleClientId) return { ok: false, error: 'Google credential was issued for a different app' };
  if (payload.email_verified !== 'true' && payload.email_verified !== true) return { ok: false, error: 'Google email not verified' };
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Google account has no email' };

  const users = db.smm_users || [];
  const existing = users.find((u) => u.email && u.email.toLowerCase() === email);
  const isNewUser = !existing;
  let user;

  if (existing) {
    if (existing.status === 'suspended') return { ok: false, error: 'Account suspended' };
    user = existing;
    if (!existing.googleId || !existing.avatar) {
      user = Object.assign({}, existing, { googleId: existing.googleId || payload.sub, avatar: existing.avatar || payload.picture || '' });
      await fetchInternal(API_BASE + '/api/db', {
        method: 'POST', headers: dbHeaders(),
        body: JSON.stringify({ smm_users: [user], smm_ts: Date.now() })
      });
    }
  } else {
    const nameParts = String(payload.name || '').trim().split(' ');
    user = {
      id: Date.now(), fname: nameParts[0] || 'User', lname: nameParts.slice(1).join(' '),
      email, phone: '', password: '', googleId: payload.sub,
      role: 'user', balance: 0, orders: 0,
      joined: new Date().toISOString(), status: 'active',
      wallet: [], transactions: [], avatar: payload.picture || ''
    };
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST', headers: dbHeaders(),
      body: JSON.stringify({ smm_users: [user], smm_ts: Date.now() })
    });
  }

  const token = signToken({ sub: user.id, role: user.role || 'user' });
  const safeUser = Object.assign({}, user);
  delete safeUser.password;
  delete safeUser.salt;
  return { ok: true, token, user: safeUser, isNewUser };
}

async function handleAdminLogin(body) {
  const username = String(body.username || '').trim();
  const password = body.password;
  if (!username || !password) return { ok: false, error: 'Missing username or password' };

  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const creds = (db.smm_admin_creds && db.smm_admin_creds.username && db.smm_admin_creds.password)
    ? db.smm_admin_creds
    : DEFAULT_ADMIN_CREDS;

  if (username !== creds.username || !creds.salt || hashPass(password, creds.salt) !== creds.password) {
    return { ok: false, error: 'Invalid credentials' };
  }

  const token = signToken({ sub: creds.username, role: 'admin' });
  return { ok: true, token, username: creds.username };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!AUTH_CONFIGURED) return res.status(500).json({ ok: false, error: 'Auth not configured. Set AUTH_JWT_SECRET.' });

  const action = (req.query && req.query.action) || '';
  const limit = RATE_LIMITS[action];
  if (limit && !rateLimit(req, 'auth:' + action, limit[0], limit[1])) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let result;
    if (action === 'login') result = await handleLogin(body);
    else if (action === 'register') result = await handleRegister(body);
    else if (action === 'google') result = await handleGoogleLogin(body);
    else if (action === 'admin-login') result = await handleAdminLogin(body);
    else return res.status(200).json({ ok: false, error: 'Unknown action' });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
