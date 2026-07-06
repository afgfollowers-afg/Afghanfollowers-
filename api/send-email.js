// Vercel Serverless Function — Sends a single email via Resend.io on behalf of
// the Email Automation tools (email-automation.html). Runs server-side so the
// Resend secret key never touches the browser, and so the send isn't blocked
// by Resend's API having no browser CORS headers (client-side fetch() calls to
// api.resend.com fail with "Failed to fetch" no matter how correct the key is).
// Env vars needed: RESEND_API_KEY (and everything db.js already needs)
const { DB_SERVICE_KEY } = require('./_dbkey');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!RESEND_API_KEY) {
    return res.status(200).json({ ok: false, error: 'Email service not configured. Set RESEND_API_KEY in Vercel → Settings → Environment Variables.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const to = (body.to || '').trim();
    const html = body.html || '';
    if (!to || !html) return res.status(200).json({ ok: false, error: 'Missing to/html' });

    const fromName = (body.fromName || '').trim();
    const fromEmail = (body.from || '').trim() || DEFAULT_FROM;
    const payload = {
      from: fromName ? fromName + ' <' + fromEmail + '>' : fromEmail,
      to: [to],
      subject: body.subject || '',
      html: html
    };
    if (body.replyTo) payload.reply_to = body.replyTo;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || !data.id) {
      return res.status(200).json({ ok: false, error: data.message || data.error || JSON.stringify(data) });
    }
    return res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
