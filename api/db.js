// Vercel Serverless Function — Real persistent cross-device sync via JSONBin.io
// Uses TWO bins (JSONBin free plan caps each record at 100KB):
//  - Main bin (JSONBIN_BIN_ID): smm_users, smm_orders, smm_tickets
//  - Services bin (JSONBIN_SVC_BIN_ID): smm_svc, GZIP-COMPRESSED to fit the size limit
//
// Env vars needed: JSONBIN_BIN_ID, JSONBIN_SVC_BIN_ID, JSONBIN_API_KEY

const zlib = require('zlib');
const { DB_SERVICE_KEY } = require('./_dbkey');

const BIN_ID = process.env.JSONBIN_BIN_ID;
const SVC_BIN_ID = process.env.JSONBIN_SVC_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const BASE = 'https://api.jsonbin.io/v3/b/';
const SITE_ORIGIN = 'https://afghanfollowers.online';

async function readBin(binId) {
  const r = await fetch(BASE + binId + '/latest', { headers: { 'X-Master-Key': API_KEY } });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { return { ok: false, status: r.status, raw: text.slice(0, 300) }; }
  if (!r.ok || !j.record) return { ok: false, status: r.status, raw: JSON.stringify(j).slice(0, 300) };
  return { ok: true, record: j.record };
}

async function writeBin(binId, record) {
  const r = await fetch(BASE + binId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': API_KEY },
    body: JSON.stringify(record)
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, raw: text.slice(0, 300) };
  return { ok: true };
}

function gzipToBase64(obj) {
  const json = JSON.stringify(obj);
  const gz = zlib.gzipSync(Buffer.from(json, 'utf8'));
  return gz.toString('base64');
}

function base64ToObj(b64) {
  const buf = Buffer.from(b64, 'base64');
  const json = zlib.gunzipSync(buf).toString('utf8');
  return JSON.parse(json);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-db-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Require the shared service key (once configured) so this endpoint isn't
  // wide open to the entire internet. Server-side callers send it via
  // _dbkey.js; first-party pages send it via the DB_CLIENT_KEY constant
  // injected near the top of admin.html/smm-panel.html/auth.html.
  if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!BIN_ID || !API_KEY) {
    return res.status(500).json({ error: 'Database not configured. Set JSONBIN_BIN_ID and JSONBIN_API_KEY.' });
  }

  if (req.method === 'GET') {
    const main = await readBin(BIN_ID);
    if (!main.ok) return res.status(200).json({ diag: 'GET_MAIN_FAILED', jsonbinStatus: main.status, jsonbinBodyRaw: main.raw });

    let svc = [];
    if (SVC_BIN_ID) {
      const svcResult = await readBin(SVC_BIN_ID);
      if (svcResult.ok) {
        try {
          if (svcResult.record.svc_gz) {
            svc = base64ToObj(svcResult.record.svc_gz);
          } else if (svcResult.record.smm_svc) {
            svc = svcResult.record.smm_svc; // legacy uncompressed fallback
          }
        } catch (e) { svc = []; }
      }
    }
    // smm_ref_visits holds every visitor's raw IP address per referral
    // code — every logged-in customer (and any public page holding the
    // shared client key) hits this GET, so the full per-visit log must
    // never go out verbatim. Reduce it to a per-code count, which is all
    // the "X / 50 visits" progress UI actually needs.
    const visitCounts = {};
    const rawVisits = main.record.smm_ref_visits || {};
    Object.keys(rawVisits).forEach(function (k) { visitCounts[k] = (rawVisits[k] || []).length; });
    const record = Object.assign({}, main.record);
    delete record.smm_ref_visits;

    const out = Object.assign({}, record, { smm_svc: svc, smm_ref_visit_counts: visitCounts });
    return res.status(200).json(out);
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Referral visit tracking for the "invite 100 → 50 confirmed visits"
      // Free Likes path. Kept as its own early-return branch (own bin
      // read/write) since it's a high-frequency, narrow write that has
      // nothing to do with the general smm_users/smm_orders merge below.
      if (body.action === 'track_ref_visit' && body.ref) {
        const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '')
          .split(',')[0].trim() || 'unknown';
        const ref = String(body.ref).trim().toUpperCase().slice(0, 20);
        const vid = String(body.vid || '').trim().slice(0, 64);
        if (!ref || !vid) return res.status(200).json({ ok: false, error: 'missing ref/vid' });

        const main = await readBin(BIN_ID);
        if (!main.ok) return res.status(200).json({ diag: 'POST_READ_MAIN_FAILED', jsonbinStatus: main.status });
        const current = main.record;
        current.smm_ref_visits = current.smm_ref_visits || {};
        const log = current.smm_ref_visits[ref] || [];

        const VISIT_GOAL = 50;
        // Already hit the goal — stop growing this ref's log forever once
        // it has served its purpose (also caps storage growth per code).
        if (log.length >= VISIT_GOAL) {
          return res.status(200).json({ ok: true, counted: false, reason: 'goal_already_reached', total: log.length });
        }

        // Strict dedup: either the same IP or the same browser (vid) having
        // already been recorded for this ref code disqualifies the visit —
        // matches the "no two credited visits may share an IP or browser"
        // requirement (accepting some false negatives from shared/carrier
        // IPs as the safer tradeoff against inflated fake visit counts).
        const isDup = log.some(v => v.ip === ip || v.vid === vid);
        if (isDup) {
          return res.status(200).json({ ok: true, counted: false, reason: 'duplicate', total: log.length });
        }

        log.push({ ip, vid, ts: Date.now() });
        current.smm_ref_visits[ref] = log;

        let qualified = false;
        if (log.length >= VISIT_GOAL) {
          current.smm_ref_visit_queue = current.smm_ref_visit_queue || [];
          const already = current.smm_ref_visit_queue.some(q => q.ref === ref);
          if (!already) {
            current.smm_ref_visit_queue.push({ ref, count: log.length, ts: Date.now(), status: 'pending' });
            qualified = true;
          }
        }
        current.smm_ts = Date.now();

        const w = await writeBin(BIN_ID, current);
        if (!w.ok) return res.status(200).json({ diag: 'PUT_MAIN_FAILED', jsonbinStatus: w.status });

        if (qualified) {
          // Best-effort admin ping — must never fail the visit-tracking response.
          try {
            const cfg = current.smm_tg_bot || {};
            if (cfg.token && cfg.chatId) {
              await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: cfg.chatId,
                  parse_mode: 'HTML',
                  text: `🎁 <b>Free Likes — Visit Milestone Reached</b>\nReferral code <b>${ref}</b> just hit ${VISIT_GOAL} unique, verified visits.\nReview it in Admin → Orders and approve if legitimate.`
                })
              });
            }
          } catch (e) { /* best-effort, ignore */ }
        }

        return res.status(200).json({ ok: true, counted: true, total: log.length, qualified });
      }

      if (body.smm_svc && Array.isArray(body.smm_svc)) {
        if (!SVC_BIN_ID) {
          return res.status(200).json({ diag: 'NO_SVC_BIN_CONFIGURED', error: 'Set JSONBIN_SVC_BIN_ID env var.' });
        }
        const gz = gzipToBase64(body.smm_svc);
        const w = await writeBin(SVC_BIN_ID, { svc_gz: gz });
        if (!w.ok) return res.status(200).json({ diag: 'PUT_SVC_FAILED', jsonbinStatus: w.status, jsonbinBodyRaw: w.raw, compressedSizeKB: Math.round(gz.length / 1024) });
        const onlyServices = !body.smm_users && !body.smm_orders && !body.smm_tickets;
        if (onlyServices) {
          return res.status(200).json({ ok: true, services: body.smm_svc.length, compressedSizeKB: Math.round(gz.length / 1024) });
        }
      }

      const main = await readBin(BIN_ID);
      if (!main.ok) return res.status(200).json({ diag: 'POST_READ_MAIN_FAILED', jsonbinStatus: main.status, jsonbinBodyRaw: main.raw });
      const current = main.record;

      // Merge by unique id — this prevents one browser's push from wiping out
      // records another browser already saved (the old "keep longer array"
      // approach caused real data loss whenever two browsers each had
      // similar-sized but different data).
      function mergeById(currentArr, incomingArr) {
        var map = {};
        (currentArr || []).forEach(function (item) { if (item && item.id !== undefined) map[item.id] = item; });
        (incomingArr || []).forEach(function (item) { if (item && item.id !== undefined) map[item.id] = item; });
        return Object.keys(map).map(function (k) { return map[k]; });
      }

      if (body.smm_users && Array.isArray(body.smm_users)) {
        current.smm_users = mergeById(current.smm_users, body.smm_users);
      }
      if (body.smm_users_delete_id !== undefined) {
        current.smm_users = (current.smm_users || []).filter(function (u) {
          return String(u.id) !== String(body.smm_users_delete_id);
        });
      }
      if (body.smm_orders && Array.isArray(body.smm_orders)) {
        current.smm_orders = mergeById(current.smm_orders, body.smm_orders);
      }
      if (body.smm_tickets && Array.isArray(body.smm_tickets)) {
        current.smm_tickets = mergeById(current.smm_tickets, body.smm_tickets);
      }
      // Payment methods: admin is the single source of truth, always overwrite
      if (body.smm_pm && Array.isArray(body.smm_pm)) {
        current.smm_pm = body.smm_pm;
      }
      if (body.smm_providers && Array.isArray(body.smm_providers)) {
        current.smm_providers = body.smm_providers;
      }
      if (body.smm_admin_creds && typeof body.smm_admin_creds === 'object') {
        current.smm_admin_creds = body.smm_admin_creds;
      }
      if (body.smm_general && typeof body.smm_general === 'object') {
        current.smm_general = body.smm_general;
      }
      if (body.smm_resets && Array.isArray(body.smm_resets)) {
        current.smm_resets = body.smm_resets;
      }
      if (body.smm_ref_visit_queue && Array.isArray(body.smm_ref_visit_queue)) {
        // Admin is the sole writer of status changes (approve/reject) on this
        // queue, so a plain overwrite (like smm_providers/smm_pm below) is
        // safe — no per-item id to merge by anyway.
        current.smm_ref_visit_queue = body.smm_ref_visit_queue;
      }
      if (body.smm_tg_bot && typeof body.smm_tg_bot === 'object') {
        current.smm_tg_bot = body.smm_tg_bot;
      }
      if (body.smm_auth_settings && typeof body.smm_auth_settings === 'object') {
        current.smm_auth_settings = body.smm_auth_settings;
      }
      if (body.smm_announcements && Array.isArray(body.smm_announcements)) {
        current.smm_announcements = body.smm_announcements;
      }
      if (body.smm_blog && Array.isArray(body.smm_blog)) {
        current.smm_blog = body.smm_blog;
      }
      if (body.smm_orders_sync && Array.isArray(body.smm_orders_sync)) {
        // Used by the sync-orders cron job to write back updated order statuses
        current.smm_orders = body.smm_orders_sync;
      }
      if (typeof body.smm_last_daily_content_date === 'string') {
        // Idempotency guard so repeat hits on /api/sync-orders (retries,
        // manual visits, uptime pings — the endpoint has no auth) don't
        // regenerate and re-broadcast blog content multiple times a day.
        current.smm_last_daily_content_date = body.smm_last_daily_content_date;
      }
      if (typeof body.smm_last_autopost_date === 'string') {
        // Same guard, for the daily Facebook/Telegram promo post.
        current.smm_last_autopost_date = body.smm_last_autopost_date;
      }
      if (body.smm_email_auto_cfg && typeof body.smm_email_auto_cfg === 'object') {
        // Re-engagement email settings (template, thresholds, daily limit) —
        // pushed from the admin panel's Email Automation tab so the weekly
        // server-side cron (sync-orders.js?job=email-campaign) can read them without needing
        // that admin's browser tab to stay open.
        current.smm_email_auto_cfg = body.smm_email_auto_cfg;
      }
      if (body.smm_users_email_log && Array.isArray(body.smm_users_email_log)) {
        // Used by the weekly email-campaign cron job to write back which
        // users were emailed and when, without touching other user fields.
        const logById = {};
        body.smm_users_email_log.forEach(u => { logById[u.id] = u.emailLog; });
        current.smm_users = (current.smm_users || []).map(u =>
          logById[u.id] ? Object.assign({}, u, { emailLog: logById[u.id] }) : u
        );
      }
      current.smm_ts = Date.now();

      const w2 = await writeBin(BIN_ID, current);
      if (!w2.ok) return res.status(200).json({ diag: 'PUT_MAIN_FAILED', jsonbinStatus: w2.status, jsonbinBodyRaw: w2.raw });

      return res.status(200).json({
        ok: true,
        users: (current.smm_users || []).length,
        orders: (current.smm_orders || []).length,
        ts: current.smm_ts
      });
    } catch (e) {
      return res.status(200).json({ diag: 'POST_EXCEPTION', error: e.message });
    }
  }

  return res.status(405).json({});
};
