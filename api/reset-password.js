// Vercel Serverless Function — Verifies a password-reset token and updates the password

const SITE = 'https://afghanfollowers.online';
const { dbHeaders, API_BASE, fetchInternal } = require('./_dbkey');
const { hashPass, genSalt } = require('./_passhash');

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

    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const resets = db.smm_resets || [];
    const entry = resets.find(r => r.token === token);

    if (!entry) return res.status(200).json({ ok: false, error: 'Invalid or already-used reset link.' });
    if (entry.expires < Date.now()) return res.status(200).json({ ok: false, error: 'Reset link has expired.' });

    const users = db.smm_users || [];
    const user = users.find(u => (u.email || '').toLowerCase() === entry.email);
    if (!user) return res.status(200).json({ ok: false, error: 'Account not found.' });

    const salt = genSalt();
    user.salt = salt;
    user.password = hashPass(newPassword, salt);

    // A reset token is single-use: drop it (and any other expired ones) once consumed.
    const remainingResets = resets.filter(r => r.token !== token && r.expires > Date.now());

    const pushResp = await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_users: users, smm_resets: remainingResets, smm_ts: Date.now() })
    });
    if (!pushResp.ok) return res.status(200).json({ ok: false, error: 'Failed to save new password.' });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
