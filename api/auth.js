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
const crypto = require('crypto');
const { dbHeaders, API_BASE, fetchInternal, logSystemError } = require('./_dbkey');
const { hashPass, genSalt } = require('./_passhash');
const { signToken, verifyToken, AUTH_CONFIGURED } = require('./_auth');
const { rateLimit } = require('./_ratelimit');

const SITE = 'https://afghanfollowers.online';

// Per-IP attempt caps for each action.
const RATE_LIMITS = {
  login: [10, 5 * 60 * 1000],
  register: [5, 15 * 60 * 1000],
  google: [10, 5 * 60 * 1000],
  'admin-login': [5, 15 * 60 * 1000],
  // Tighter than admin-login: this is the one path that mints a trusted
  // device, so brute-forcing ADMIN_DEVICE_ENROLL_CODE must stay expensive.
  'admin-device-enroll': [3, 30 * 60 * 1000],
  'profile-check': [30, 5 * 60 * 1000]
};

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

// Best-effort append to the admin-login audit trail (smm_admin_login_log in the
// DB, capped server-side). There was previously NO record anywhere of who
// logged into the admin panel or when — so a compromised admin password was
// completely invisible. This makes every admin-login attempt (success AND
// failure) visible, viewable via db.js's ?diag=admin-audit. Never throws.
async function logAdminLoginAttempt(entry) {
  try {
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_admin_login_push: entry, smm_ts: Date.now() })
    });
  } catch (e) { /* best-effort */ }
}

// Bootstrap recovery for an smm_admin_creds that was never set or got
// cleared. api/db.js seeds that key as {}, the panel's own change-password
// form (admin.html) only runs once you are ALREADY logged in as admin, and
// db.js gates writes to smm_admin_creds behind an admin token — so an empty
// key means there is no route back into the panel from the UI at all.
//
// This deliberately restores the admin/admin123 default that #105 removed,
// at the repo owner's explicit instruction after the tradeoff was spelled
// out. KNOW WHAT THIS MEANS: the moment smm_admin_creds is empty, anyone who
// reads this file — it is the panel's default and is published here in
// plaintext — can log into the admin panel of a deployment that holds
// customer wallet balances and PayPal history. Treat the default as public.
//
// ADMIN_BOOTSTRAP_USER / ADMIN_BOOTSTRAP_PASSWORD still override the default
// if they are set in Vercel, so the credential can be changed later without
// another code change. Out of the box, with neither set, this seeds exactly
// admin / admin123.
//
// Change the password in the panel (Settings -> Security) as soon as you are
// back in; that writes a real salted credential and this fallback goes dormant
// until smm_admin_creds is emptied again.
const BOOTSTRAP_USER = process.env.ADMIN_BOOTSTRAP_USER || 'admin';
const BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin123';

async function seedAdminCreds() {
  // Stored salted+stretched via _passhash.js, NOT as the literal string
  // 'admin123' — handleAdminLogin() below verifies with
  // hashPass(password, creds.salt) and rejects any record without a salt, so
  // a plaintext password field would seed a credential that can never log in.
  // That exact bug is what 873d9bc had to fix last time this default existed.
  const salt = genSalt();
  const creds = { username: BOOTSTRAP_USER, password: hashPass(BOOTSTRAP_PASSWORD, salt), salt };
  // db.js stamps smm_admin_creds_changed_at / _change_log on this write, so
  // the bootstrap shows up in ?diag=admin-audit like any other credential
  // change rather than happening silently.
  const resp = await fetchInternal(API_BASE + '/api/db', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ smm_admin_creds: creds, smm_ts: Date.now() })
  });
  if (!resp.ok) {
    // Don't authenticate against a credential the store never accepted —
    // otherwise the next request finds the key still empty and re-seeds with
    // a fresh salt, and the admin appears to log in against nothing.
    await logSystemError('auth:admin-bootstrap',
      'Failed to persist bootstrapped admin credentials.', { status: resp.status });
    return null;
  }
  return creds;
}

// The username/password half of admin authentication, shared by the login and
// device-enrolment paths so both enforce exactly the same credential rules and
// the same smm_admin_creds bootstrap. Returns the matched creds on success;
// callers own the audit logging so each can record its own reason string.
async function verifyAdminPassword(body) {
  const username = String(body.username || '').trim();
  const password = body.password;
  if (!username || !password) {
    return { ok: false, reason: 'missing-credentials', error: 'Missing username or password' };
  }

  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  // An empty smm_admin_creds self-heals into the default admin credential
  // (see seedAdminCreds above) rather than blocking login. This reverses
  // #105 by the owner's decision — the default password is public, which is
  // survivable only because the device gate in handleAdminLogin() means the
  // password alone no longer gets anyone into the panel.
  let creds = db.smm_admin_creds;
  if (!creds || !creds.username || !creds.password) {
    creds = await seedAdminCreds();
    if (!creds) {
      return { ok: false, reason: 'creds-not-configured', error: 'Admin credentials are not configured.' };
    }
  }

  if (username !== creds.username || !creds.salt || hashPass(password, creds.salt) !== creds.password) {
    return { ok: false, reason: 'invalid-credentials', error: 'Invalid credentials' };
  }
  return { ok: true, creds: creds };
}

// ---------------------------------------------------------------------------
// Admin device lock — the admin panel opens only on browsers that have been
// explicitly enrolled, so a correct password on an unknown device is not
// enough to get in.
//
// Deliberately STATELESS: an enrolled device holds a long-lived HMAC-signed
// token (same _auth.js secret as every other token here) instead of the server
// keeping a device allowlist in the JSONBin store. Two reasons:
//   1. That store is the panel's single point of failure — when its request
//      quota is exhausted it serves empty objects and silently drops writes,
//      which is exactly how smm_admin_creds came to read as "not configured".
//      An allowlist kept there would evaporate the same way and lock the admin
//      out of their own panel, or re-enroll attackers, depending on which way
//      the failure fell. A signature the server can recompute from
//      AUTH_JWT_SECRET cannot be lost by a datastore outage.
//   2. It costs zero extra reads/writes per login, on a store already at its
//      quota ceiling.
//
// Enrolling a device requires the admin password AND ADMIN_DEVICE_ENROLL_CODE,
// a value that exists only in Vercel's environment. That second factor is what
// makes the public admin/admin123 default survivable: knowing the password does
// not by itself get anyone in, and the enroll code is not in this repo.
//
// Revocation is deliberately coarse (there is one admin with a couple of
// devices, not a fleet): bump ADMIN_DEVICE_EPOCH in Vercel and every enrolled
// device is invalidated at once and must re-enroll. There is no per-device
// revoke list precisely because such a list would have to live in the store
// this design is avoiding.
//
// Lockout safety: enrollment depends only on Vercel env vars, which the owner
// always controls, so there is no state that can strand them outside the panel.
// Until ADMIN_DEVICE_ENROLL_CODE is set the gate stays open (see
// handleAdminLogin) so that shipping this file cannot itself lock anyone out.
const DEVICE_ENROLL_CODE = process.env.ADMIN_DEVICE_ENROLL_CODE || '';
const DEVICE_EPOCH = process.env.ADMIN_DEVICE_EPOCH || '1';
const DEVICE_TTL_SECONDS = 365 * 24 * 60 * 60; // re-enroll once a year

// Constant-time compare so the enroll code can't be recovered a character at a
// time from response timing. Length is compared first and non-secretly, since
// timingSafeEqual throws on a length mismatch.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// A device token is valid only if it is properly signed, unexpired, actually a
// device token (not an admin session token replayed into this slot), and
// stamped with the current epoch.
function deviceFromToken(deviceToken) {
  const payload = verifyToken(deviceToken);
  if (!payload || payload.typ !== 'device') return null;
  if (String(payload.epoch) !== String(DEVICE_EPOCH)) return null;
  return payload;
}

// Enrolls the browser that presents the right admin password AND enroll code.
// Returns a device token the client stores once and replays on every login.
async function handleAdminDeviceEnroll(body, ip, ua) {
  ip = ip || 'unknown';
  if (!DEVICE_ENROLL_CODE) {
    return { ok: false, error: 'Device enrollment is not configured. Set ADMIN_DEVICE_ENROLL_CODE in Vercel.' };
  }

  // Enrolling is a privileged act, so it demands the password too — the enroll
  // code alone must not mint a trusted device.
  const credCheck = await verifyAdminPassword(body);
  if (!credCheck.ok) {
    await logAdminLoginAttempt({ ok: false, reason: 'device-enroll-bad-credentials', username: String(body.username || '') || null, ip: ip, ua: ua || null });
    return { ok: false, error: credCheck.error };
  }
  if (!safeEqual(String(body.enrollCode || ''), DEVICE_ENROLL_CODE)) {
    await logAdminLoginAttempt({ ok: false, reason: 'device-enroll-bad-code', username: credCheck.creds.username, ip: ip, ua: ua || null });
    return { ok: false, error: 'Invalid enrollment code' };
  }

  const name = String(body.deviceName || '').trim().slice(0, 40) || 'Unnamed device';
  const did = crypto.randomBytes(16).toString('hex');
  const deviceToken = signToken({ typ: 'device', did: did, name: name, epoch: DEVICE_EPOCH }, DEVICE_TTL_SECONDS);
  await logAdminLoginAttempt({ ok: true, reason: 'device-enrolled', username: credCheck.creds.username, ip: ip, ua: ua || null, device: name, did: did });
  return { ok: true, deviceToken, deviceName: name, did: did };
}

async function handleAdminLogin(body, ip, ua) {
  ip = ip || 'unknown';
  const deviceToken = body.deviceToken;

  const credCheck = await verifyAdminPassword(body);
  if (!credCheck.ok) {
    await logAdminLoginAttempt({ ok: false, reason: credCheck.reason, username: String(body.username || '') || null, ip: ip, ua: ua || null });
    return { ok: false, error: credCheck.error };
  }
  const creds = credCheck.creds;

  // The device gate sits AFTER the password check on purpose: an unknown
  // browser holding a wrong password learns only "invalid credentials", so
  // this response can't be used to probe which passwords are valid.
  const device = deviceFromToken(deviceToken);
  if (!device) {
    // Fail OPEN while ADMIN_DEVICE_ENROLL_CODE is unset, because there is no
    // way to enroll a first device without it — enforcing the gate before it
    // can be configured would brick the panel for its only admin, with the
    // fix reachable only from that same panel. This is not a weakening: with
    // no enroll code set, the deployment is in exactly the state it was in
    // before device-lock existed. The gate arms itself the moment the env var
    // is present, with no redeploy of this file required.
    if (!DEVICE_ENROLL_CODE) {
      await logAdminLoginAttempt({ ok: true, reason: 'success-device-lock-inactive', username: creds.username, ip: ip, ua: ua || null });
      const openToken = signToken({ sub: creds.username, role: 'admin' });
      return { ok: true, token: openToken, username: creds.username, deviceLockInactive: true };
    }
    await logAdminLoginAttempt({ ok: false, reason: deviceToken ? 'device-not-recognised' : 'device-absent', username: creds.username, ip: ip, ua: ua || null });
    // needDevice tells admin.html to show the enrollment form instead of the
    // ordinary "wrong password" error — the password was in fact correct.
    return {
      ok: false, needDevice: true,
      enrollConfigured: true,
      error: 'This device is not authorised for the admin panel.'
    };
  }

  await logAdminLoginAttempt({ ok: true, reason: 'success', username: creds.username, ip: ip, ua: ua || null, device: device.name, did: device.did });
  // did travels in the session token so a later audit can tell which enrolled
  // device an admin action came from.
  const token = signToken({ sub: creds.username, role: 'admin', did: device.did });
  return { ok: true, token, username: creds.username, deviceName: device.name };
}

async function handleProfileCheck(body) {
  const platform = String(body.platform || '').toLowerCase();
  const username = String(body.username || '').trim().replace(/^@/, '');

  if (!username) return { ok: false, error: 'یوزرنیم وارد نشده' };

  // Platform-specific format validation
  const fmts = {
    instagram: /^[a-z0-9._]{1,30}$/i,
    tiktok: /^[a-z0-9._]{2,24}$/i,
    telegram: /^[a-z0-9_]{5,32}$/i,
    youtube: /^.{3,100}$/,
    facebook: /^[a-z0-9.]{5,60}$/i
  };
  const rx = fmts[platform];
  if (rx && !rx.test(username)) return { ok: false, error: 'فرمت یوزرنیم نادرست است' };

  // For Instagram, try to fetch public profile data
  if (platform === 'instagram') {
    try {
      const r = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'x-ig-app-id': '936619743392459',
          'x-asbd-id': '198387',
          'Referer': 'https://www.instagram.com/'
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
      });
      if (r.ok) {
        const data = await r.json();
        const u = data && data.data && data.data.user;
        if (u) {
          return {
            ok: true,
            username: u.username,
            fullName: u.full_name || null,
            avatar: u.profile_pic_url_hd || u.profile_pic_url || null,
            followers: u.edge_followed_by ? u.edge_followed_by.count : null,
            following: u.edge_follow ? u.edge_follow.count : null,
            posts: u.edge_owner_to_timeline_media ? u.edge_owner_to_timeline_media.count : null,
            verified: u.is_verified || false,
            private: u.is_private || false
          };
        }
      }
    } catch (e) {
      // Instagram blocked or network error — fall through to format-only response
    }
  }

  // All other platforms (or Instagram fallback): format validated, no extra data
  return { ok: true, username, platform, formatOnly: true };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query && req.query.action) || '';

  // profile-check is a lightweight public GET/POST — skip the auth-required gate
  if (action !== 'profile-check' && !AUTH_CONFIGURED) {
    return res.status(500).json({ ok: false, error: 'Auth not configured. Set AUTH_JWT_SECRET.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

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
    else if (action === 'admin-login') {
      const _ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
      const _ua = String(req.headers['user-agent'] || '').slice(0, 160);
      result = await handleAdminLogin(body, _ip, _ua);
    }
    else if (action === 'admin-device-enroll') {
      const _ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
      const _ua = String(req.headers['user-agent'] || '').slice(0, 160);
      result = await handleAdminDeviceEnroll(body, _ip, _ua);
    }
    else if (action === 'profile-check') result = await handleProfileCheck(body);
    else return res.status(200).json({ ok: false, error: 'Unknown action' });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
