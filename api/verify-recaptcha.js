// Vercel Serverless Function — Verifies a Google reCAPTCHA v2 token server-side.
// The secret key must never be exposed to the browser, so it's read only
// from an environment variable (set RECAPTCHA_SECRET_KEY in Vercel), never
// from the client-editable smm_auth_settings.
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body.token;

    if (!RECAPTCHA_SECRET_KEY) {
      // Not configured server-side — don't block registration over an admin
      // setup gap; the site key check on the client already gates whether
      // the widget shows at all.
      return res.status(200).json({ ok: true, skipped: true });
    }
    if (!token) return res.status(200).json({ ok: false, error: 'Missing reCAPTCHA token.' });

    const params = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token });
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await resp.json();
    return res.status(200).json({ ok: !!data.success, errorCodes: data['error-codes'] || [] });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
