// Vercel Serverless Function — Auto-sync order status from providers
// Runs on a schedule (see vercel.json "crons"). For every order that was
// sent to a provider and isn't finished yet, asks the provider for its
// current status/remains and updates our database automatically.
//
// Also doubles as other scheduled jobs, folded into this same file
// (rather than new ones) to stay under Vercel's Hobby-plan caps of 12
// serverless functions AND 2 cron jobs per deployment:
//   - ?job=email-campaign — weekly re-engagement emails (runEmailCampaignJob)
//   - the default daily run (this same 3am cron) ALSO generates fresh blog
//     content afterwards (runDailyContentJob), then posts a promo/gaming
//     update to Facebook + Telegram (runAutoPostJob) — there was no cron
//     slot left to give either of these their own schedule.

const SITE = 'https://afghanfollowers.online';
const { dbHeaders } = require('./_dbkey');
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

module.exports = async (req, res) => {
  if (req.query && req.query.job === 'email-campaign') {
    return runEmailCampaignJob(req, res);
  }
  try {
    // 1. Get current data
    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const orders = db.smm_orders || [];
    const providers = db.smm_providers || [];
    const svcList = db.smm_svc || []; // compact array format: [id, svcId, fullDesc, category, provName, provId, cost, price, min, max, active]

    // 1b. Retry orders that were never actually sent to the provider (no provOrderId yet)
    const finishedStatuses = ['completed', 'canceled', 'cancelled', 'refunded'];
    const neverSent = orders.filter(o => !o.provOrderId && !finishedStatuses.includes(o.status));
    let retried = 0;
    const retryDebug = [];

    for (const o of neverSent) {
      // Find the matching service by name to get its provider numeric service id
      const svcRow = svcList.find(s => s[2] === o.svcName || s[2] === o.svc || s[3] === o.svcName);
      if (!svcRow) { retryDebug.push({ orderId: o.id, error: 'Service not found in catalog' }); continue; }
      const provNumericId = svcRow[1]; // provider's numeric service id
      const provId = svcRow[5];
      const prov = providers.find(p => String(p.id) === String(provId)) || providers[0];
      if (!prov || !prov.url || !prov.key) { retryDebug.push({ orderId: o.id, error: 'Provider config not found' }); continue; }

      try {
        const formData = new URLSearchParams();
        formData.append('key', prov.key);
        formData.append('action', 'add');
        formData.append('service', provNumericId);
        formData.append('link', o.link);
        formData.append('quantity', o.qty);

        const r = await fetch(prov.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        });
        const text = await r.text();
        let result;
        try { result = JSON.parse(text); } catch (e) {
          retryDebug.push({ orderId: o.id, error: 'Bad response', rawText: text.slice(0, 200) });
          continue;
        }
        if (result.order) {
          o.provOrderId = result.order;
          o.status = 'processing';
          retried++;
          retryDebug.push({ orderId: o.id, ok: true, newProvOrderId: result.order });
        } else {
          retryDebug.push({ orderId: o.id, error: result.error || 'No order id returned', rawResponse: result });
        }
      } catch (e) {
        retryDebug.push({ orderId: o.id, error: e.message });
      }
    }

    if (retried > 0) {
      await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_orders_sync: orders, smm_ts: Date.now() })
      });
    }

    // 2. Find orders that still need checking (sent to a provider, not finished)
    const finished = ['completed', 'canceled', 'cancelled', 'refunded'];
    const pending = orders.filter(o => o.provOrderId && !finished.includes(o.status));

    if (!pending.length) {
      let contentResultEarly = null;
      try { contentResultEarly = await runDailyContentJob(); } catch (e) { contentResultEarly = { ok: false, error: e.message }; }
      let autoPostResultEarly = null;
      try { autoPostResultEarly = await runAutoPostJob(); } catch (e) { autoPostResultEarly = { ok: false, error: e.message }; }
      return res.status(200).json({ ok: true, checked: 0, updated: 0, retried, retryDebug, message: 'No pending orders', content: contentResultEarly, autoPost: autoPostResultEarly });
    }

    // 3. Group pending orders by provider (matched via provId stored on the order, if present,
    //    otherwise fall back to trying every provider — most panels have one provider anyway)
    const byProvider = {};
    pending.forEach(o => {
      const key = o.provId || 'default';
      if (!byProvider[key]) byProvider[key] = [];
      byProvider[key].push(o);
    });

    let updated = 0;
    const idToOrder = {};
    orders.forEach(o => { idToOrder[o.id] = o; });
    const debugInfo = [];

    for (const provId of Object.keys(byProvider)) {
      let prov = providers.find(p => String(p.id) === String(provId));
      if (!prov) prov = providers[0]; // fallback to the only/first configured provider
      if (!prov || !prov.url || !prov.key) continue;

      const group = byProvider[provId];

      // Check each order individually — this provider does not reliably
      // support bulk/comma-separated status requests.
      for (const o of group) {
        try {
          const formData = new URLSearchParams();
          formData.append('key', prov.key);
          formData.append('action', 'status');
          formData.append('order', String(o.provOrderId));

          const r = await fetch(prov.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
          });
          const text = await r.text();
          let info;
          try { info = JSON.parse(text); } catch (e) {
            debugInfo.push({ orderId: o.id, provOrderId: o.provOrderId, error: 'JSON parse failed', rawText: text.slice(0, 200) });
            continue;
          }

          debugInfo.push({ orderId: o.id, provOrderId: o.provOrderId, rawResponse: info });

          if (!info || info.error) continue;

          let changed = false;
          if (info.status) {
            const mapped = mapStatus(info.status);
            if (mapped && mapped !== o.status) { o.status = mapped; changed = true; }
          }
          if (info.remains !== undefined) {
            const remainNum = parseInt(info.remains);
            if (!isNaN(remainNum) && remainNum !== o.remain) { o.remain = remainNum; changed = true; }
          }
          if (info.start_count !== undefined) {
            const startNum = parseInt(info.start_count);
            if (!isNaN(startNum) && startNum !== o.startCount) { o.startCount = startNum; changed = true; }
          }
          if (changed) updated++;
        } catch (e) {
          debugInfo.push({ orderId: o.id, provOrderId: o.provOrderId, error: e.message });
          continue;
        }
      }
    }

    // 4. Write updated orders back if anything changed
    if (updated > 0) {
      await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_orders_sync: orders, smm_ts: Date.now() })
      });
    }

    // 5. Same daily invocation also refreshes blog content — failures here
    // must never break order syncing above, so they're caught separately.
    let contentResult = null;
    try { contentResult = await runDailyContentJob(); } catch (e) { contentResult = { ok: false, error: e.message }; }

    let autoPostResult = null;
    try { autoPostResult = await runAutoPostJob(); } catch (e) { autoPostResult = { ok: false, error: e.message }; }

    return res.status(200).json({ ok: true, checked: pending.length, updated, retried, retryDebug, debugInfo, content: contentResult, autoPost: autoPostResult });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};

function mapStatus(providerStatus) {
  const s = String(providerStatus).toLowerCase();
  if (s.includes('complet')) return 'completed';
  if (s.includes('partial')) return 'partial';
  if (s.includes('in progress')) return 'in_progress';
  if (s.includes('process')) return 'processing';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('refund')) return 'refunded';
  if (s.includes('pending')) return 'pending';
  return null;
}

// ── Weekly re-engagement email campaign (server-side) ──
// Runs entirely on the server via vercel.json's cron schedule, so it fires
// reliably every week regardless of whether anyone has the admin panel's
// Email Automation tab open in a browser — a client-side setInterval() only
// ever ran while that exact tab stayed open continuously, which is not
// realistic over a week.
const DEFAULT_SUBJECT = 'We miss you, {{name}}! 🌟 Come back and grow your social media';
const DEFAULT_BODY = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8f9fa">'
  + '<div style="background:linear-gradient(135deg,#7c5cfc,#00d2a0);padding:20px;border-radius:12px 12px 0 0;text-align:center">'
  + '<h1 style="color:#fff;margin:0;font-size:22px">🌟 {{site_name}}</h1></div>'
  + '<div style="background:#fff;padding:28px;border-radius:0 0 12px 12px">'
  + '<h2 style="color:#1a202c;margin-bottom:8px">Hi {{name}}, we miss you! 👋</h2>'
  + '<p style="color:#555;line-height:1.7">You haven\'t visited {{site_name}} for {{days}} days. Your account balance is ${{balance}} — ready to use!</p>'
  + '<div style="text-align:center;margin:20px 0"><a href="{{panel_link}}" style="background:linear-gradient(135deg,#7c5cfc,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700">🚀 Back to Panel</a></div>'
  + '</div></div>';

function fillVars(text, user, daysInactive, cfg) {
  const siteName = cfg.fromName || 'Afghan Followers';
  const panelLink = SITE + '/smm-panel.html';
  return text
    .replace(/\{\{name\}\}/g, user.fname || 'User')
    .replace(/\{\{email\}\}/g, user.email || '')
    .replace(/\{\{days\}\}/g, daysInactive || 0)
    .replace(/\{\{balance\}\}/g, (parseFloat(user.balance) || 0).toFixed(2))
    .replace(/\{\{panel_link\}\}/g, panelLink)
    .replace(/\{\{site_name\}\}/g, siteName);
}

function getInactiveUsers(users, cfg) {
  const thresholdMs = (cfg.days || 30) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const target = cfg.target || 'all';
  return users.filter(u => {
    if (!u.email || u.email.indexOf('@') < 0) return false;
    if (u.status === 'suspended') return false;
    const last = u.lastVisit ? new Date(u.lastVisit).getTime() : new Date(u.joined).getTime();
    if (now - last < thresholdMs) return false;
    if (target === 'no_orders' && (u.orders || 0) > 0) return false;
    if (target === 'has_orders' && (u.orders || 0) === 0) return false;
    if (target === 'low_balance' && (u.balance || 0) >= 5) return false;
    return true;
  });
}

function canSendTo(u, cfg) {
  const log = u.emailLog || [];
  if (log.length >= (cfg.maxEmails || 3)) return false;
  if (log.length > 0) {
    const lastMs = new Date(log[log.length - 1]).getTime();
    if (Date.now() - lastMs < (cfg.cooldownDays || 7) * 24 * 60 * 60 * 1000) return false;
  }
  return true;
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

async function runEmailCampaignJob(req, res) {
  try {
    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const users = db.smm_users || [];
    const cfg = db.smm_email_auto_cfg || {};

    if (!cfg.active) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Automation is disabled (toggle it on in Admin -> Settings -> Email Automation)' });
    }
    if (!RESEND_API_KEY) {
      return res.status(200).json({ ok: false, error: 'RESEND_API_KEY missing in Vercel env vars' });
    }
    if (!cfg.from) {
      return res.status(200).json({ ok: false, error: 'From Email not configured in Admin -> Settings -> Email Automation' });
    }

    const inactive = getInactiveUsers(users, cfg);
    const eligible = inactive.filter(u => canSendTo(u, cfg));
    const limit = cfg.dailyLimit || 0;
    const toSend = limit > 0 ? eligible.slice(0, limit) : eligible;

    const subjTpl = cfg.subject || DEFAULT_SUBJECT;
    const bodyTpl = cfg.bodyHtml || DEFAULT_BODY;

    let sent = 0, failed = 0;
    const updatedLogs = [];
    for (const u of toSend) {
      const last = u.lastVisit || u.joined;
      const days = Math.floor((Date.now() - new Date(last).getTime()) / (24 * 60 * 60 * 1000));
      const subject = fillVars(subjTpl, u, days, cfg);
      const html = fillVars(bodyTpl, u, days, cfg);
      const payload = {
        from: cfg.fromName ? cfg.fromName + ' <' + cfg.from + '>' : cfg.from,
        to: [u.email],
        subject: subject,
        html: html
      };
      if (cfg.replyTo) payload.reply_to = cfg.replyTo;

      const result = await sendViaResend(payload);
      if (result.ok) {
        sent++;
        const log = (u.emailLog || []).concat([new Date().toISOString()]);
        updatedLogs.push({ id: u.id, emailLog: log });
      } else {
        failed++;
      }
    }

    if (updatedLogs.length) {
      await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_users_email_log: updatedLogs, smm_ts: Date.now() })
      });
    }

    return res.status(200).json({ ok: true, inactive: inactive.length, eligible: eligible.length, sent, failed });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}

// ── Daily blog content refresh ──
// Generates 3 AI-written Instagram/TikTok growth-tip posts per day (rotating
// topics, standing in for "daily trending hashtags" — there is no free/
// reliable live Google Trends API reachable from here). New posts are
// prepended and the list is capped at BLOG_POST_CAP so JSONBin's ~100KB
// per-record limit is never at risk, while still keeping weeks of content
// live long enough for Google to actually index it.
const BLOG_POST_CAP = 60;
const GROWTH_TOPICS = [
  { platform: 'instagram', topic: 'افزایش فالوور واقعی اینستاگرام با استفاده از ریلز' },
  { platform: 'tiktok', topic: 'چگونه یک ویدیوی تیک‌تاک وایرال شود' },
  { platform: 'instagram', topic: 'بهترین زمان پست گذاشتن در اینستاگرام برای مخاطب افغان و ایرانی' },
  { platform: 'tiktok', topic: 'انتخاب هشتگ درست برای افزایش فالوور تیک‌تاک' },
  { platform: 'instagram', topic: 'چگونه پست اینستاگرام به اکسپلور برسد' },
  { platform: 'tiktok', topic: 'بهترین زمان پست تیک‌تاک برای بیشترین ویو' },
  { platform: 'instagram', topic: 'افزایش لایک و کامنت واقعی روی پست اینستاگرام' },
  { platform: 'tiktok', topic: 'نکات الگوریتم تیک‌تاک برای صفحات کوچک' },
  { platform: 'instagram', topic: 'نکات افزایش فالوور برای صفحه بیزینسی اینستاگرام' },
  { platform: 'tiktok', topic: 'ادیت حرفه‌ای ویدیو برای افزایش ویو تیک‌تاک' }
];

function dayOfYear() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  return Math.floor((now - start) / 86400000);
}

async function generateAiBlogPost(topic, platform) {
  const resp = await fetch(SITE + '/api/ai-chat', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ mode: 'generate_blog', topic: topic })
  });
  const data = await resp.json();
  if (!data.ok) return null;
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: data.title,
    slug: slugify(data.title),
    excerpt: data.excerpt,
    content: data.html,
    platform: platform || 'other',
    emoji: data.emoji || '📈',
    published: true,
    source: 'ai',
    createdAt: new Date().toISOString()
  };
}

function slugify(title) {
  return String(title).trim().toLowerCase()
    .replace(/[^؀-ۿa-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
}

async function broadcastNewPost(post, tgCfg) {
  const url = SITE + '/blog.html?post=' + post.slug;

  if (tgCfg.token && tgCfg.channelId) {
    const text = '📝 <b>مقاله جدید</b>'
      + '\n\n' + post.emoji + ' <b>' + post.title + '</b>\n' + (post.excerpt || '')
      + '\n\n🔗 ' + url;
    try {
      await fetch(`https://api.telegram.org/bot${tgCfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgCfg.channelId, text: text, parse_mode: 'HTML' })
      });
    } catch (e) { /* best-effort — a broadcast failure must not break the cron */ }
  }

  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
    const fbText = '📝 مقاله جدید\n\n' + post.emoji + ' ' + post.title + '\n' + (post.excerpt || '') + '\n\n🔗 ' + url;
    try {
      await fetch(`https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: fbText, access_token: process.env.FB_PAGE_TOKEN })
      });
    } catch (e) { /* best-effort — a broadcast failure must not break the cron */ }
  }
}

async function runDailyContentJob() {
  const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const existing = db.smm_blog || [];
  const tgCfg = db.smm_tg_bot || {};

  const doy = dayOfYear();
  const topics = [
    GROWTH_TOPICS[doy % GROWTH_TOPICS.length],
    GROWTH_TOPICS[(doy + 3) % GROWTH_TOPICS.length],
    GROWTH_TOPICS[(doy + 6) % GROWTH_TOPICS.length]
  ]; // three offset picks so consecutive days rarely repeat the same topic

  const newPosts = [];
  for (const t of topics) {
    const post = await generateAiBlogPost(t.topic, t.platform).catch(() => null);
    if (post) newPosts.push(post);
  }

  if (!newPosts.length) {
    return { ok: true, added: 0, reason: 'No posts generated (AI unavailable)' };
  }

  const combined = newPosts.concat(existing).slice(0, BLOG_POST_CAP);

  await fetch(SITE + '/api/db', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ smm_blog: combined, smm_ts: Date.now() })
  });

  for (const p of newPosts) {
    await broadcastNewPost(p, tgCfg);
  }

  return { ok: true, added: newPosts.length, total: combined.length };
}

const AUTOPOST_ADMIN_CHAT_ID = '7993801735';

async function runAutoPostJob() {
  // Reuse the Telegram bot already configured in Admin → Settings → Integrations
  // (same smm_tg_bot record used for blog broadcasts) instead of requiring the
  // token/channel to be duplicated as separate Vercel env vars.
  let tgCfg = {};
  try {
    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    tgCfg = db.smm_tg_bot || {};
  } catch (e) { /* fall through with empty tgCfg — job still runs, just skips Telegram */ }

  try {
    return await runAutoPostJobInner(tgCfg);
  } catch (err) {
    if (tgCfg.token) {
      await fetch(`https://api.telegram.org/bot${tgCfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgCfg.chatId || AUTOPOST_ADMIN_CHAT_ID, text: '❌ خطا در پست خودکار:\n' + err.message })
      }).catch(() => {});
    }
    throw err;
  }
}

const AUTOPOST_FOCUS = [
  'افزایش فالوور اینستاگرام',
  'لایک و ویو تیک‌تاک',
  'ممبر و بازدید کانال تلگرام',
  'ساب‌اسکرایب و ویو یوتیوب',
  'لایک و کامنت واقعی اینستاگرام',
  'فالوور واقعی تیک‌تاک'
];

async function runAutoPostJobInner(tgCfg) {
  const results = { facebook: null, telegram: null };
  const focus = AUTOPOST_FOCUS[dayOfYear() % AUTOPOST_FOCUS.length];

  const promoPrompt = `یک پست تبلیغاتی کوتاه و جذاب به زبان فارسی/دری برای AfghanFollowers (afghanfollowers.online) بنویس — پنل فروش فالوور، لایک و ویو واقعی برای اینستاگرام، تیک‌تاک، یوتیوب و تلگرام، مخصوصاً برای مخاطب افغان و ایرانی.

امروز تمرکز پست را روی این موضوع بگذار: ${focus}

قوانین:
- حداکثر ۶ خط
- با ایموجی‌های مناسب
- درباره سرویس دیگری غیر از AfghanFollowers چیزی ننویس
- در آخر آدرس سایت afghanfollowers.online و ۳-۴ هشتگ فارسی مرتبط
- تمام متن باید کاملاً فارسی/دری باشد — هیچ کلمه‌ی انگلیسی، ترکی یا هر زبان دیگری (جز خود "AfghanFollowers" و آدرس سایت) داخل جمله‌ها استفاده نکن
- فقط متن پست را بنویس، هیچ توضیح اضافه نده`;

  const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: promoPrompt }],
      temperature: 0.9,
      max_tokens: 500
    })
  });
  const groqData = await groqResp.json();
  const postText = groqData?.choices?.[0]?.message?.content?.trim();
  if (!postText) throw new Error('Groq هیچ متنی تولید نکرد: ' + JSON.stringify(groqData));

  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
    const fbResp = await fetch(`https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: postText, access_token: process.env.FB_PAGE_TOKEN })
    });
    const fbData = await fbResp.json();
    results.facebook = fbData.id ? '✅ موفق: ' + fbData.id : '❌ خطا: ' + JSON.stringify(fbData.error || fbData);
  } else {
    results.facebook = '⏭ تنظیم نشده';
  }

  const tgChannel = tgCfg.channelId || tgCfg.chatId;
  if (tgCfg.token && tgChannel) {
    const tgResp = await fetch(`https://api.telegram.org/bot${tgCfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChannel, text: postText })
    });
    const tgData = await tgResp.json();
    results.telegram = tgData.ok ? '✅ موفق' : '❌ خطا: ' + JSON.stringify(tgData);
  } else {
    results.telegram = '⏭ تنظیم نشده (بخش Telegram در Settings → Integrations پنل ادمین را کامل کنید)';
  }

  if (tgCfg.token) {
    await fetch(`https://api.telegram.org/bot${tgCfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgCfg.chatId || AUTOPOST_ADMIN_CHAT_ID,
        text: `📢 گزارش پست خودکار (${focus})\n\n`
          + `فیسبوک: ${results.facebook}\n`
          + `تلگرام: ${results.telegram}\n\n`
          + `متن پست:\n${postText}`
      })
    }).catch(() => {});
  }

  return { ok: true, focus, results };
}
