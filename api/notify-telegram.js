// Vercel Serverless Function — Sends a Telegram notification to the admin.
// Reads the bot token/chat id from the shared server DB (set once in the
// admin panel), so any page (customer or admin) can trigger a notification
// without needing to know the bot token itself.

const SITE = 'https://afghanfollowers.online';
const { dbHeaders } = require('./_dbkey');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = body.message;
    if (!message) return res.status(200).json({ ok: false, error: 'No message provided' });

    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const cfg = db.smm_tg_bot || {};

    // Callers (e.g. the "broadcast to public channel" feature) can target a
    // different chat than the admin notification chat by passing chatId —
    // still requires the same server-configured bot token either way.
    const targetChatId = body.chatId || cfg.chatId;

    if (!cfg.token || !targetChatId) {
      return res.status(200).json({ ok: false, error: 'Telegram bot not configured on server' });
    }

    const tgResp = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: targetChatId, text: message, parse_mode: 'HTML', disable_web_page_preview: false })
    });
    const tgResult = await tgResp.json();

    if (!tgResult.ok) {
      return res.status(200).json({ ok: false, error: 'Telegram API error: ' + JSON.stringify(tgResult) });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
