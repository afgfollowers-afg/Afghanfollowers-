// Vercel Serverless Function — Auto-sync order status from providers
// Runs on a schedule (see vercel.json "crons"). For every order that was
// sent to a provider and isn't finished yet, asks the provider for its
// current status/remains and updates our database automatically.
//
// Also doubles as the weekly re-engagement email cron
// (?job=email-campaign, see runEmailCampaignJob below) — folded into this
// same file rather than a new one to stay under Vercel's Hobby-plan cap of
// 12 serverless functions per deployment.

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
      return res.status(200).json({ ok: true, checked: 0, updated: 0, retried, retryDebug, message: 'No pending orders' });
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

    return res.status(200).json({ ok: true, checked: pending.length, updated, retried, retryDebug, debugInfo });
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
// reliably every week regardless of whether anyone has email-automation.html
// open in a browser — a client-side setInterval() only ever ran while that
// exact tab stayed open continuously, which is not realistic over a week.
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
      return res.status(200).json({ ok: true, skipped: true, reason: 'Automation is disabled (toggle it on in email-automation.html)' });
    }
    if (!RESEND_API_KEY) {
      return res.status(200).json({ ok: false, error: 'RESEND_API_KEY missing in Vercel env vars' });
    }
    if (!cfg.from) {
      return res.status(200).json({ ok: false, error: 'From Email not configured in email-automation.html' });
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
