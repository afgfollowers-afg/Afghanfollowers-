// Vercel Serverless Function — Sends a password-reset email via Resend.io
// Env vars needed: RESEND_API_KEY (and everything db.js already needs)

const SITE = 'https://afghanfollowers.online';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

function randomToken() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: true }); // don't leak validation info

    if (!RESEND_API_KEY) {
      return res.status(200).json({ ok: false, error: 'Email service not configured (RESEND_API_KEY missing).' });
    }

    // Look up the user
    const dbResp = await fetch(SITE + '/api/db');
    const db = await dbResp.json();
    const users = db.smm_users || [];
    const user = users.find(u => (u.email || '').toLowerCase() === email);

    // Always respond success (don't reveal whether the email exists) — but only
    // actually send an email if we found a matching user.
    if (user) {
      const token = randomToken();
      const resets = (db.smm_resets || []).filter(r => r.expires > Date.now()); // drop expired
      resets.push({ token, email, expires: Date.now() + 60 * 60 * 1000 }); // 1 hour

      await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smm_resets: resets, smm_ts: Date.now() })
      });

      const resetLink = SITE + '/auth.html?reset=' + token;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Afghan Followers <' + FROM_EMAIL + '>',
          to: [email],
          subject: 'Reset your password',
          html: '<p>Hi ' + (user.fname || '') + ',</p>'
            + '<p>Click the link below to reset your password. This link expires in 1 hour.</p>'
            + '<p><a href="' + resetLink + '">' + resetLink + '</a></p>'
            + '<p>If you did not request this, you can ignore this email.</p>'
        })
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
