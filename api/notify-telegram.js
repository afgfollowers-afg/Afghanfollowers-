// Vercel Serverless Function — Sends a Telegram notification to the admin,
// and (optionally) also cross-posts to the Facebook Page — reads the bot
// token/chat id from the shared server DB (set once in the admin panel) and
// the Facebook Page token from Vercel env vars, so any page (customer or
// admin) can trigger a broadcast without needing to know either secret.

const SITE = 'https://afghanfollowers.online';
const { dbHeaders } = require('./_dbkey');

// Vercel only gives a 2-letter ISO country code — spell out the ones most
// relevant to this site's audience so the notification reads naturally;
// anything else falls back to the raw code (still useful, just terser).
const COUNTRY_NAMES = {
  AF: 'افغانستان', IR: 'ایران', PK: 'پاکستان', TR: 'ترکیه', DE: 'آلمان',
  US: 'آمریکا', GB: 'انگلستان', AE: 'امارات', SA: 'عربستان', TJ: 'تاجیکستان',
  UZ: 'ازبکستان', IN: 'هند', CA: 'کانادا', AU: 'استرالیا', NL: 'هلند',
  SE: 'سوئد', FR: 'فرانسه', RU: 'روسیه', QA: 'قطر', KW: 'کویت'
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let message = body.message;
    if (!message) return res.status(200).json({ ok: false, error: 'No message provided' });

    // Vercel's edge network geolocates every request by IP and passes it
    // along as headers — free, no external API call, and reflects whoever's
    // browser actually triggered this request (visitor, customer, etc.).
    const country = req.headers['x-vercel-ip-country'];
    const city = req.headers['x-vercel-ip-city'];
    if (country) {
      const countryName = COUNTRY_NAMES[country] || country;
      const cityDecoded = city ? decodeURIComponent(city) : null;
      message += '\n🌍 ' + (cityDecoded ? cityDecoded + ', ' : '') + countryName;
    }

    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const cfg = db.smm_tg_bot || {};

    // Callers (e.g. the "broadcast to public channel" feature) can target a
    // different chat than the admin notification chat by passing chatId —
    // still requires the same server-configured bot token either way.
    const targetChatId = body.chatId || cfg.chatId;

    let result = { ok: false, error: 'Telegram bot not configured on server' };
    if (cfg.token && targetChatId) {
      const tgResp = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: message, parse_mode: 'HTML', disable_web_page_preview: false })
      });
      const tgResult = await tgResp.json();
      result = tgResult.ok ? { ok: true } : { ok: false, error: 'Telegram API error: ' + JSON.stringify(tgResult) };
    }

    // Optional: also post a plain-text version to the Facebook Page (Telegram's
    // HTML formatting doesn't apply there — callers pass a separate fbMessage).
    let facebook = null;
    if (body.fbMessage) {
      if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
        const fbResp = await fetch(`https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: body.fbMessage, access_token: process.env.FB_PAGE_TOKEN })
        });
        const fbData = await fbResp.json();
        facebook = fbData.id ? { ok: true, id: fbData.id } : { ok: false, error: fbData.error || fbData };
      } else {
        facebook = { ok: false, error: 'Facebook not configured on server' };
      }
    }

    return res.status(200).json(Object.assign({}, result, { facebook }));
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
