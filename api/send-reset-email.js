// Vercel Serverless Function — Sends transactional emails via Resend.io.
// Handles two use-cases in one function to stay under Vercel's Hobby-plan
// cap of 12 serverless functions per deployment:
//   1. Password reset (public — called by logged-out visitors from
//      auth.html): body { email } → looks up the user, issues a reset
//      token, emails a reset link.
//   2. Generic authenticated send (called from the admin panel's Email
//      Automation tab re-engagement/bulk-announcement tools): body { to, html, subject,
//      from, fromName, replyTo } → requires the shared x-db-key header so
//      this can't be used as an open email relay by anyone who finds the URL.
// Env vars needed: RESEND_API_KEY, RESEND_FROM_EMAIL (and everything db.js needs)

const crypto = require('crypto');
const SITE = 'https://afghanfollowers.online';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const { dbHeaders, DB_SERVICE_KEY, API_BASE } = require('./_dbkey');

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
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: true }); // don't leak validation info

    if (!RESEND_API_KEY) {
      return res.status(200).json({ ok: false, error: 'Email service not configured (RESEND_API_KEY missing).' });
    }

    // Look up the user
    const dbResp = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
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

      await fetch(API_BASE + '/api/db', {
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
