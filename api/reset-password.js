// Vercel Serverless Function — Verifies a password-reset token and updates the password

const SITE = 'https://afghanfollowers.online';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body.token;
    const newPassword = body.newPassword;
    if (!token || !newPassword || newPassword.length < 8) {
      return res.status(200).json({ ok: false, error: 'Invalid request.' });
    }

    const dbResp = await fetch(SITE + '/api/db');
    const db = await dbResp.json();
    const resets = db.smm_resets || [];
    const entry = resets.find(r => r.token === token);

    if (!entry) return res.status(200).json({ ok: false, error: 'Invalid or already-used reset link.' });
    if (entry.expires < Date.now()) return res.status(200).json({ ok: false, error: 'Reset link has expired.' });

    const users = db.smm_users || [];
    const user = users.find(u => (u.email || '').toLowerCase() === entry.email);
    if (!user) return res.status(200).json({ ok: false, error: 'Account not found.' });

    // btoa equivalent in Node (matches the client's btoa(password) scheme)
    const newHash = Buffer.from(newPassword, 'utf8').toString('base64');
    user.password = newHash;

    const remainingResets = resets.filter(r => r.token !== token && r.expires > Date.now());

    const pushResp = await fetch(SITE + '/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smm_users: users, smm_resets: remainingResets, smm_ts: Date.now() })
    });
    const pushResult = await pushResp.json();

    // Verify by reading back immediately
    const verifyResp = await fetch(SITE + '/api/db');
    const verifyDb = await verifyResp.json();
    const verifyUser = (verifyDb.smm_users || []).find(u => (u.email || '').toLowerCase() === entry.email);

    return res.status(200).json({
      ok: true,
      debug: {
        userIdFound: user.id,
        newHashComputed: newHash,
        pushResult: pushResult,
        verifyHashAfterPush: verifyUser ? verifyUser.password : 'USER NOT FOUND ON VERIFY'
      }
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
