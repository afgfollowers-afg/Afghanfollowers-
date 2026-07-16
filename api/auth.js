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
const { dbHeaders, API_BASE } = require('./_dbkey');
const { hashPass, genSalt } = require('./_passhash');
const { signToken, AUTH_CONFIGURED } = require('./_auth');

const SITE = 'https://afghanfollowers.online';
const DEFAULT_ADMIN_CREDS = { username: 'admin', password: hashPass('admin123', 'a1f9c3e7b2d84605'), salt: 'a1f9c3e7b2d84605' };

async function handleLogin(body) {
  const email = body.email ? String(body.email).trim().toLowerCase() : '';
  const phone = body.phone ? String(body.phone).trim() : '';
  const password = body.password;
  if ((!email && !phone) || !password) {
    return { ok: false, error: 'Missing email/phone or password' };
  }

  const dbResp = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
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
    await fetch(API_BASE + '/api/db', {
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

  const dbResp = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
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

  await fetch(API_BASE + '/api/db', {
    method: 'POST', headers: dbHeaders(),
    body: JSON.stringify({ smm_users: [newUser], smm_ts: Date.now() })
  });

  const token = signToken({ sub: newUser.id, role: 'user' });
  const safeUser = Object.assign({}, newUser);
  delete safeUser.password;
  delete safeUser.salt;
  return { ok: true, token, user: safeUser };
}

async function handleAdminLogin(body) {
  const username = String(body.username || '').trim();
  const password = body.password;
  if (!username || !password) return { ok: false, error: 'Missing username or password' };

  const dbResp = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
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
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let result;
    if (action === 'login') result = await handleLogin(body);
    else if (action === 'register') result = await handleRegister(body);
    else if (action === 'admin-login') result = await handleAdminLogin(body);
    else return res.status(200).json({ ok: false, error: 'Unknown action' });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
