// Vercel Serverless Function — Sends transactional emails via Resend.io.
// Handles three use-cases in one function to stay under Vercel's Hobby-plan
// cap of 12 serverless functions per deployment:
//   1. Password reset (public — called by logged-out visitors from
//      auth.html): body { email } → looks up the user, issues a reset
//      token, emails a reset link.
//   2. Generic authenticated send (called from the admin panel's Email
//      Automation tab re-engagement/bulk-announcement tools): body { to, html, subject,
//      from, fromName, replyTo } → requires the shared x-db-key header so
//      this can't be used as an open email relay by anyone who finds the URL.
//   3. Password reset confirmation (public — called by auth.html after the
//      user clicks the link): body { token, newPassword } → verifies the
//      token and updates the password. Replaces /api/reset-password.
// Env vars needed: RESEND_API_KEY, RESEND_FROM_EMAIL (and everything db.js needs)

const crypto = require('crypto');
const SITE = 'https://afghanfollowers.online';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const { dbHeaders, DB_SERVICE_KEY, API_BASE, fetchInternal } = require('./_dbkey');
const { hashPass, genSalt } = require('./_passhash');
const { rateLimit } = require('./_ratelimit');

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendViaResend(payload) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (!resp.ok || !data.id) return { ok: false, error: data.message || data.error || JSON.stringify(data) };
  return { ok: true, id: data.id };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // ── Mode 3: password reset confirmation (token + new password) ──
    if (body.token && body.newPassword) {
      if (!rateLimit(req, 'reset-password', 20, 15 * 60 * 1000)) {
        return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
      }
      if (body.newPassword.length < 8) {
        return res.status(200).json({ ok: false, error: 'Invalid request.' });
      }
      const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
      const db = await dbResp.json();
      const resets = db.smm_resets || [];
      const entry = resets.find(r => r.token === body.token);
      if (!entry) return res.status(200).json({ ok: false, error: 'Invalid or already-used reset link.' });
      if (entry.expires < Date.now()) return res.status(200).json({ ok: false, error: 'Reset link has expired.' });
      const users = db.smm_users || [];
      const user = users.find(u => (u.email || '').toLowerCase() === entry.email);
      if (!user) return res.status(200).json({ ok: false, error: 'Account not found.' });
      const salt = genSalt();
      user.salt = salt;
      user.password = hashPass(body.newPassword, salt);
      const remainingResets = resets.filter(r => r.token !== body.token && r.expires > Date.now());
      const pushResp = await fetchInternal(API_BASE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_users: users, smm_resets: remainingResets, smm_ts: Date.now() })
      });
      if (!pushResp.ok) return res.status(200).json({ ok: false, error: 'Failed to save new password.' });
      return res.status(200).json({ ok: true });
    }

    // ── Mode 2: generic authenticated send (admin email tools) ──
    if (body.to && body.html) {
      if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!RESEND_API_KEY) {
        return res.status(200).json({ ok: false, error: 'Email service not configured. Set RESEND_API_KEY in Vercel → Settings → Environment Variables.' });
      }
      const fromName = (body.fromName || '').trim();
      const fromEmail = (body.from || '').trim() || FROM_EMAIL;
      const payload = {
        from: fromName ? fromName + ' <' + fromEmail + '>' : fromEmail,
        to: [String(body.to).trim()],
        subject: body.subject || '',
        html: body.html
      };
      if (body.replyTo) payload.reply_to = body.replyTo;
      const result = await sendViaResend(payload);
      return res.status(200).json(result);
    }

    // ── Mode 1: password reset (public) ──
    // Unauthenticated by design (anyone logged-out needs to trigger this),
    // so IP-based throttling is the only thing standing between this and
    // an email-bombing tool spamming arbitrary inboxes with reset links.
    if (!rateLimit(req, 'send-reset-email', 5, 15 * 60 * 1000)) {
      return res.status(200).json({ ok: true }); // same non-committal response as "user not found" — don't leak that a limit was hit either
    }
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: true }); // don't leak validation info

    if (!RESEND_API_KEY) {
      return res.status(200).json({ ok: false, error: 'Email service not configured (RESEND_API_KEY missing).' });
    }

    // Look up the user
    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const users = db.smm_users || [];
    const user = users.find(u => (u.email || '').toLowerCase() === email);

    // Always respond success (don't reveal whether the email exists) — but only
    // actually send an email if we found a matching user. The response must
    // be identical either way, so no debug/error info leaks account existence.
    if (!user) {
      return res.status(200).json({ ok: true });
    }

    {
      const token = randomToken();
      const resets = (db.smm_resets || []).filter(r => r.expires > Date.now()); // drop expired
      resets.push({ token, email, expires: Date.now() + 60 * 60 * 1000 }); // 1 hour

      await fetchInternal(API_BASE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_resets: resets, smm_ts: Date.now() })
      });

      const resetLink = SITE + '/auth.html?reset=' + token;
      const result = await sendViaResend({
        from: 'Afghan Followers <' + FROM_EMAIL + '>',
        to: [email],
        subject: 'Reset your password',
        html: '<p>Hi ' + (user.fname || '') + ',</p>'
          + '<p>Click the link below to reset your password. This link expires in 1 hour.</p>'
          + '<p><a href="' + resetLink + '">' + resetLink + '</a></p>'
          + '<p>If you did not request this, you can ignore this email.</p>'
      });
      if (!result.ok) {
        return res.status(200).json({ ok: false, error: 'Resend error: ' + result.error });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
