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
const { dbHeaders, DB_SERVICE_KEY, API_BASE, fetchInternal, logSystemError } = require('./_dbkey');
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

module.exports = async (req, res) => {
  // ?status=1 — a pure read: report whether today's email jobs (the daily
  // bulk campaign, the weekly re-engagement campaign) have actually sent
  // anything, without running ANY job. Every other query shape on this
  // endpoint (including a bare hit with no params at all) has real side
  // effects — it retries stuck order dispatches to the real provider and,
  // once a day, sends real customer emails — so "just check status" can
  // never safely reuse those paths; this is the one branch that only reads.
  if (req.query && (req.query.status === '1' || req.query.status === 'true')) {
    return runStatusCheck(req, res);
  }

  if (req.query && req.query.job === 'email-campaign') {
    return runEmailCampaignJob(req, res);
  }

  // ?job=auto-post — on-demand manual trigger for the daily promo/growth post,
  // outside the normal 3am cron. No schedule of its own (see vercel.json —
  // Hobby plan caps cron jobs at 2, already used by the daily sweep + weekly
  // email-campaign); this exists purely for manual testing/preview.
  // &dryrun=1 skips both Facebook and the real Telegram channel entirely and
  // only DMs the admin chat a labeled preview, so it never counts as (or
  // blocks) the real once-a-day post the 3am cron already handles.
  if (req.query && req.query.job === 'auto-post') {
    const isDryRun = req.query.dryrun === '1' || req.query.dryrun === 'true';
    const result = await runAutoPostJob({ dryRun: isDryRun }).catch(e => ({ ok: false, error: e.message }));
    return res.status(200).json(result);
  }

  // Order syncing, daily content, and auto-post are three independent jobs
  // piggybacked on this one daily cron invocation (see the file header for
  // why). Each runs in its own try/catch so a failure in one (e.g. a
  // provider API being down) can never silently prevent the others from
  // running — previously an uncaught error anywhere in the order-sync logic
  // below skipped content/auto-post entirely while still returning HTTP 200,
  // which is exactly the kind of failure that's invisible unless someone
  // reads the response body instead of just the status code.
  // ?force=1 — a deliberate manual click on "Retry Sync Now" in the admin
  // panel, as opposed to the automatic daily cron (or Vercel's own retries/
  // uptime pings hitting this unauthenticated endpoint, which is what the
  // RETRY_AGE_MS cooldown below guards against). A conscious one-off admin
  // click doesn't carry that same double-dispatch risk, so it can skip the
  // cooldown and check every never-sent order immediately — but only when
  // authenticated as the admin panel (same x-db-key every other admin-only
  // action here requires), otherwise anyone hitting this public, unauthed
  // URL with ?force=1 could reintroduce the exact double-dispatch race the
  // cooldown exists to prevent.
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true')
    && DB_SERVICE_KEY && req.headers['x-db-key'] === DB_SERVICE_KEY);

  let syncResult;
  try {
    syncResult = await runOrderSyncJob(force);
  } catch (e) {
    syncResult = { ok: false, error: e.message };
  }

  let contentResult = null;
  try { contentResult = await runDailyContentJob(); } catch (e) { contentResult = { ok: false, error: e.message }; }

  let autoPostResult = null;
  try { autoPostResult = await runAutoPostJob(); } catch (e) { autoPostResult = { ok: false, error: e.message }; }

  let bulkEmailResult = null;
  try { bulkEmailResult = await runBulkEmailCampaignJob(); } catch (e) { bulkEmailResult = { ok: false, error: e.message }; }

  return res.status(200).json(Object.assign({}, syncResult, { content: contentResult, autoPost: autoPostResult, bulkEmail: bulkEmailResult }));
};

// Exposed so api/place-order.js can dispatch a single order on demand
// (right after a customer places it, or an admin approves one) using the
// exact same claim-then-dispatch logic this file's own retry sweep uses —
// see dispatchOneOrder() above for why a shared implementation matters.
module.exports.dispatchOneOrder = dispatchOneOrder;

// Claim-then-dispatch for exactly one order, entirely server-side — the
// provider's URL/API key never leave this function (read from the DB
// snapshot passed in, or fetched fresh below), unlike the old
// place-order.js which took them straight from the client's request body.
// Used both by the batch retry loop below and, on demand, by
// api/place-order.js right after a customer places (or an admin approves)
// an order, so dispatch stays instant instead of waiting for the next cron.
//
// Re-checks against the LATEST server state immediately before dispatching
// (not just the snapshot the caller passed in) and writes a fresh
// dispatchAttemptedAt right away — this endpoint/job can be invoked more
// than once close together (Vercel retries, overlapping cron/manual runs,
// a customer's place-order call racing the daily retry sweep); without that
// re-check, two overlapping calls could both see the same "never sent"
// snapshot and both dispatch the same order to the provider before either
// wrote back — a genuine duplicate order to the same link.
//
// A handful of the core function's failure reasons are routine concurrency
// guards, not bugs (another call already claimed/finished this exact
// order) — logging those to the admin panel's System Alerts page would
// just be noise on every busy moment. Everything else (config missing,
// the provider itself rejecting the order, a thrown exception) is a real
// problem worth surfacing, so this thin wrapper is the one place that
// decides which is which, instead of scattering that judgment across every
// return statement inside the core function below.
const BENIGN_DISPATCH_ERRORS = ['Already dispatched or finished', 'Dispatch already in progress'];
async function dispatchOneOrder(order, dbSnapshot, opts) {
  const result = await dispatchOneOrderCore(order, dbSnapshot, opts);
  if (!result.ok && BENIGN_DISPATCH_ERRORS.indexOf(result.error) === -1) {
    logSystemError('dispatch', 'Order #' + order.id + ' failed to dispatch: ' + result.error, {
      orderId: order.id, service: order.svcName || order.svc || order.service, error: result.error
    });
  }
  return result;
}
async function dispatchOneOrderCore(order, dbSnapshot, opts) {
  opts = opts || {};
  const providers = (dbSnapshot && dbSnapshot.providers) || [];
  const svcList = (dbSnapshot && dbSnapshot.svcList) || [];
  const finishedStatuses = ['completed', 'canceled', 'cancelled', 'refunded', 'pending_approval'];
  const RETRY_AGE_MS = 30 * 60 * 1000; // 30 minutes

  if (order.provOrderId || finishedStatuses.includes(order.status)) {
    return { ok: false, error: 'Already dispatched or finished' };
  }

  // Prefer the stable IDs captured directly on the order at creation time
  // (smm-panel.html's placeOrder()/claimFreeLikes()) — immune to the
  // service catalog's free-text name drifting after a re-import or edit,
  // which is exactly what silently and permanently stuck real orders here
  // before: the name-only lookup below stopped matching anything the
  // moment a service got renamed. Only orders placed before this field
  // existed fall back to the name-based lookup.
  let provNumericId, provId;
  if (order.svcId && order.provId) {
    provNumericId = order.svcId;
    provId = order.provId;
  } else {
    const svcRow = svcList.find(s => s[2] === order.svcName || s[2] === order.svc || s[3] === order.svcName);
    if (!svcRow) return { ok: false, error: 'Service not found in catalog' };
    provNumericId = svcRow[1]; // provider's numeric service id
    provId = svcRow[5];
  }
  const prov = providers.find(p => String(p.id) === String(provId)) || providers[0];
  if (!prov || !prov.url || !prov.key) return { ok: false, error: 'Provider config not found' };

  let claimed;
  try {
    const freshResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const freshDb = await freshResp.json();
    const freshOrder = (freshDb.smm_orders || []).find(x => String(x.id) === String(order.id));
    if (!freshOrder) return { ok: false, error: 'Order not found' };
    if (freshOrder.provOrderId || finishedStatuses.includes(freshOrder.status)) {
      return { ok: false, error: 'Already dispatched or finished' };
    }
    if (!opts.force && freshOrder.dispatchAttemptedAt && (Date.now() - freshOrder.dispatchAttemptedAt) <= RETRY_AGE_MS) {
      // Another call claimed (or already dispatched) this since our caller's
      // snapshot was taken — back off rather than race it.
      return { ok: false, error: 'Dispatch already in progress' };
    }
    claimed = Object.assign({}, freshOrder, { dispatchAttemptedAt: Date.now() });
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_orders: [claimed], smm_ts: Date.now() })
    });
  } catch (e) {
    return { ok: false, error: 'Claim check failed: ' + e.message };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('key', prov.key);
    formData.append('action', 'add');
    formData.append('service', provNumericId);
    formData.append('link', claimed.link);
    formData.append('quantity', claimed.qty);

    const r = await fetch(prov.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });
    const text = await r.text();
    let result;
    try { result = JSON.parse(text); } catch (e) {
      return { ok: false, error: 'Bad response', rawText: text.slice(0, 200) };
    }
    if (result.order) {
      claimed.provOrderId = result.order;
      claimed.status = 'processing';
      // Write back immediately via a merge-safe single-order update (not a
      // full-array overwrite) so this can never clobber an order placed or
      // edited elsewhere while this call was running.
      await fetchInternal(API_BASE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_orders: [claimed], smm_ts: Date.now() })
      });
      return { ok: true, provOrderId: result.order };
    }
    return { ok: false, error: result.error || 'No order id returned', rawResponse: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Read-only status report for the two actual EMAIL jobs this file runs
// (the daily bulk campaign and the weekly re-engagement campaign) — see the
// ?status=1 branch in module.exports above for why this never triggers
// either job itself. Gated behind the same shared key every other
// admin-only read/write in this project requires (see place-order.js,
// notify-telegram.js, db.js) — nothing sensitive is returned (just dates
// and counts, no addresses or content), but keeping one consistent gate
// everywhere is simpler to reason about than deciding case by case which
// "harmless" endpoint gets to skip it.
async function runStatusCheck(req, res) {
  if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const today = todayKey();

    // Bulk campaign: smm_last_bulk_campaign_date is the job's own
    // once-a-day guard (see runBulkEmailCampaignJob below) — it only gets
    // set to today's date on a day the job actually ran (found a recipient
    // list, had a configured "from" address, etc.), not just on any hit to
    // this file. smm_bulk_campaign_sent maps email -> ISO timestamp of the
    // last time each recipient was sent to, across all days.
    const sentLog = db.smm_bulk_campaign_sent || {};
    const sentTimestamps = Object.keys(sentLog).map(function (k) { return sentLog[k]; });
    const bulkSentToday = sentTimestamps.filter(function (ts) { return typeof ts === 'string' && ts.slice(0, 10) === today; }).length;
    const listData = db.smm_bulk_campaign_list;
    const hasRecipientList = !!(listData && Array.isArray(listData.all) && listData.all.length);
    const statuses = (listData && listData.statuses) || {};
    const remainingInCycle = hasRecipientList
      ? listData.all.filter(function (r) { return statuses[r.status] && !sentLog[r.email]; }).length
      : 0;
    // Mirrors runBulkEmailCampaignJob's own reset countdown so this status
    // check can show "restarts in N day(s)" without waiting for the next
    // cron run to report it.
    const CYCLE_RESET_MS = 7 * 24 * 60 * 60 * 1000;
    const cycleAt = db.smm_bulk_campaign_cycle_at || 0;
    let cycleResetInDays = null;
    if (hasRecipientList && remainingInCycle === 0) {
      cycleResetInDays = cycleAt ? Math.max(0, Math.ceil((CYCLE_RESET_MS - (Date.now() - cycleAt)) / 86400000)) : 7;
    }

    // Weekly re-engagement campaign has no single "did it run" flag —
    // runEmailCampaignJob only appends to each recipient's own emailLog, so
    // "sent today" here means "count of users with an emailLog entry dated
    // today", not a job-level marker. The cron for this one only fires
    // Mondays (see vercel.json) — 0 on any other day is expected, not a
    // failure.
    const cfg = db.smm_email_auto_cfg || {};
    const users = db.smm_users || [];
    const reengagementSentToday = users.filter(function (u) {
      var log = u.emailLog || [];
      return log.some(function (ts) { return typeof ts === 'string' && ts.slice(0, 10) === today; });
    }).length;

    return res.status(200).json({
      ok: true,
      today: today,
      bulkEmailCampaign: {
        active: hasRecipientList,
        lastRunDate: db.smm_last_bulk_campaign_date || null,
        ranToday: db.smm_last_bulk_campaign_date === today,
        sentToday: bulkSentToday,
        totalEverSent: sentTimestamps.length,
        dailyLimit: (db.smm_email_auto_cfg && db.smm_email_auto_cfg.dailyLimit) || 200,
        remainingInCycle: remainingInCycle,
        cycleResetInDays: cycleResetInDays
      },
      weeklyReengagementEmail: {
        active: !!cfg.active,
        sentToday: reengagementSentToday,
        note: 'Runs Mondays only via /api/sync-orders?job=email-campaign — sentToday being 0 on other days is expected, not a failure.'
      },
      resendConfigured: !!RESEND_API_KEY
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}

async function runOrderSyncJob(force) {
  // 1. Get current data
  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const orders = db.smm_orders || [];
  const providers = db.smm_providers || [];
  const svcList = db.smm_svc || []; // compact array format: [id, svcId, fullDesc, category, provName, provId, cost, price, min, max, active]

  // 1b. Retry orders that were never actually sent to the provider (no provOrderId yet).
  // 'pending_approval' (free-likes referral claims awaiting admin review) is excluded
  // here too — those must never reach the provider until an admin approves them.
  //
  // dispatchAttemptedAt is set the moment a customer order or an admin's
  // Free Likes approval fires its own /api/place-order call, *before*
  // provOrderId comes back. This retry sweep also catches place-order.js
  // calls that failed outright (network error, provider down) before they
  // could write anything back. Only orders stuck for a while (or with no
  // attempt recorded at all — e.g. legacy orders) are retried here; a fresh
  // attempt is left alone for RETRY_AGE_MS so this sweep can never race an
  // in-flight on-demand dispatch and send the same order twice.
  const RETRY_AGE_MS = 30 * 60 * 1000; // 30 minutes
  const finishedStatuses = ['completed', 'canceled', 'cancelled', 'refunded', 'pending_approval'];
  const neverSent = orders.filter(o => {
    if (o.provOrderId || finishedStatuses.includes(o.status)) return false;
    if (force || !o.dispatchAttemptedAt) return true;
    return (Date.now() - o.dispatchAttemptedAt) > RETRY_AGE_MS;
  });
  let retried = 0;
  const retryDebug = [];

  for (const o of neverSent) {
    const result = await dispatchOneOrder(o, { providers, svcList }, { force });
    if (result.ok) {
      retried++;
      retryDebug.push({ orderId: o.id, ok: true, newProvOrderId: result.provOrderId });
    } else {
      retryDebug.push(Object.assign({ orderId: o.id }, result));
    }
  }

  // Persist stuck-order diagnostics so the admin panel can surface them —
  // previously retryDebug only existed in this HTTP response, invisible
  // unless someone happened to hit this endpoint directly and read the raw
  // JSON (which is how these got noticed at all). Replaced wholesale each
  // run so a resolved/succeeded order automatically drops off the list.
  // (Successful dispatches are already written back per-order above, not
  // batched here, so this write only ever touches the diagnostics field.)
  const stuckOrders = retryDebug.filter(d => d.error);
  if (retryDebug.length > 0) {
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_stuck_orders: stuckOrders, smm_ts: Date.now() })
    });
  }

  // 2. Find orders that still need checking (sent to a provider, not finished)
  const finished = ['completed', 'canceled', 'cancelled', 'refunded'];
  const pending = orders.filter(o => o.provOrderId && !finished.includes(o.status));

  if (!pending.length) {
    return { ok: true, checked: 0, updated: 0, retried, retryDebug, message: 'No pending orders' };
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
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_orders_sync: orders, smm_ts: Date.now() })
    });
  }

  return { ok: true, checked: pending.length, updated, retried, retryDebug, debugInfo };
}

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
    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
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
      await fetchInternal(API_BASE + '/api/db', {
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
// Evenly split across all 5 platforms the panel actually sells — this used
// to be all-Instagram/TikTok (10/10 posts), which is why every blog post
// and Facebook/Telegram broadcast ended up on the same two platforms.
const GROWTH_TOPICS = [
  { platform: 'instagram', topic: 'افزایش فالوور واقعی اینستاگرام با استفاده از ریلز' },
  { platform: 'tiktok', topic: 'چگونه یک ویدیوی تیک‌تاک وایرال شود' },
  { platform: 'telegram', topic: 'راه‌های افزایش ممبر واقعی کانال تلگرام' },
  { platform: 'youtube', topic: 'ترفندهای افزایش ساب‌اسکرایبر واقعی یوتیوب' },
  { platform: 'facebook', topic: 'چگونه لایک و فالوور صفحه فیسبوک را افزایش دهیم' },
  { platform: 'instagram', topic: 'بهترین زمان پست گذاشتن در اینستاگرام برای مخاطب افغان و ایرانی' },
  { platform: 'tiktok', topic: 'انتخاب هشتگ درست برای افزایش فالوور تیک‌تاک' },
  { platform: 'telegram', topic: 'چگونه بازدید پست‌های کانال تلگرام را بالا ببریم' },
  { platform: 'youtube', topic: 'نکات افزایش ویو ویدیوهای یوتیوب' },
  { platform: 'facebook', topic: 'افزایش تعامل و کامنت واقعی روی پست‌های فیسبوک' }
];

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  return Math.floor((now - start) / 86400000);
}

async function generateAiBlogPost(topic, platform) {
  const resp = await fetchInternal(API_BASE + '/api/ai-chat', {
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
    // Title must be the very first thing in the text — Facebook can collapse
    // long posts behind "See More", and a generic "📝 مقاله جدید" label ahead
    // of the real title reads as if that filler text IS the headline. The
    // excerpt is the least essential part, so it moves right before the link.
    const fbText = post.emoji + ' ' + post.title + '\n\n' + (post.excerpt || '') + '\n\n🔗 ' + url;
    try {
      await fetch(`https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Explicit `link` (not just a URL buried in the message text) is what
        // makes Facebook reliably attach a link-preview card with the site's
        // og:image — text-only URL detection is inconsistent.
        body: JSON.stringify({ message: fbText, link: url, access_token: process.env.FB_PAGE_TOKEN })
      });
    } catch (e) { /* best-effort — a broadcast failure must not break the cron */ }
  }
}

async function runDailyContentJob() {
  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();

  // This endpoint has no auth and is hit by more than just the daily cron
  // (Vercel retries, uptime pings, manual visits while testing) — without
  // this guard every single hit generated 3 fresh AI blog posts and
  // re-broadcast them to Facebook/Telegram, which is what looked like
  // "a post after every order" since order-sync runs in the same request.
  const today = todayKey();
  if (db.smm_last_daily_content_date === today) {
    return { ok: true, added: 0, reason: 'Already ran today (' + today + ')' };
  }

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

  await fetchInternal(API_BASE + '/api/db', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ smm_blog: combined, smm_last_daily_content_date: today, smm_ts: Date.now() })
  });

  for (const p of newPosts) {
    await broadcastNewPost(p, tgCfg);
  }

  return { ok: true, added: newPosts.length, total: combined.length };
}

const AUTOPOST_ADMIN_CHAT_ID = '7993801735';

async function runAutoPostJob(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  // Reuse the Telegram bot already configured in Admin → Settings → Integrations
  // (same smm_tg_bot record used for blog broadcasts) instead of requiring the
  // token/channel to be duplicated as separate Vercel env vars.
  let tgCfg = {};
  const today = todayKey();
  try {
    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    tgCfg = db.smm_tg_bot || {};
    // Same reasoning as runDailyContentJob's guard — this endpoint gets hit
    // more than once a day (retries, manual visits, etc.), and without this
    // check each hit fired off a brand new promo post to Facebook/Telegram.
    // Dry runs never write smm_last_autopost_date (see runAutoPostJobInner),
    // so they must also never be blocked by it — a preview should always be
    // available on demand regardless of whether today's real post went out.
    if (!dryRun && db.smm_last_autopost_date === today) {
      return { ok: true, skipped: true, reason: 'Already ran today (' + today + ')' };
    }
  } catch (e) { /* fall through with empty tgCfg — job still runs, just skips Telegram */ }

  try {
    return await runAutoPostJobInner(tgCfg, today, dryRun);
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

// One entry per platform so the daily promo post rotates evenly across all
// 5 — this used to skew heavily toward Instagram/TikTok (4 of 6 entries)
// with Facebook never mentioned at all despite being a broadcast target.
const AUTOPOST_FOCUS = [
  'فالوور و لایک واقعی اینستاگرام',
  'لایک و ویو واقعی تیک‌تاک',
  'ممبر و بازدید واقعی کانال تلگرام',
  'ساب‌اسکرایب و ویو واقعی یوتیوب',
  'لایک و فالوور واقعی صفحه فیسبوک'
];

// Rotating post ANGLE — combined with AUTOPOST_FOCUS so consecutive days
// differ in how the post is written, not just which platform it mentions.
// Previously every day used the exact same prompt structure with only
// ${focus} swapped in, which reads as "the same template reworded" even
// though the topic technically rotated.
const AUTOPOST_ANGLES = [
  'روی فوریت و پیشنهاد زمان‌دار امروز تمرکز کن',
  'با یک سوال جذاب برای مخاطب شروع کن',
  'به یک ادعای اجتماعی اشاره کن (مثلاً تعداد مشتریان راضی یا سفارش‌های موفق)',
  'روی سرعت واقعی تحویل و کیفیت سرویس تمرکز کن',
  'با یک نکته یا ترفند کوچک درباره رشد واقعی در شبکه‌های اجتماعی شروع کن'
];

// Rotating urgency/time-limited appeal — folded naturally into the post
// text, not tacked on as a separate generic line every day.
// Pure urgency/CTA wording only — no "تخفیف"/"پیشنهاد ویژه" or any other
// phrasing implying an active discount or special price, since no such
// mechanism actually exists. High energy, but never a false claim.
const AUTOPOST_URGENCY = [
  'همین امروز شروع کن — چرا صبر کنی؟ 🔥',
  'وقت محدوده — الان اقدام کن ⏰',
  'دیرتر نره، همین حالا سفارش بده ⚡',
  'رشد پیجت رو امروز شروع کن، نه فردا 🎯',
  'فرصت امروز رو از دست نده — همین الان بخر 💥'
];

// Curated pool of real Afghan/Farsi SMM + gaming hashtags — the model picks
// from this fixed list instead of inventing generic ones each time, so
// hashtags actually match what an Afghan/Persian-speaking audience uses.
const AUTOPOST_HASHTAG_POOL = [
  '#فالوور_اینستاگرام', '#افزایش_فالوور', '#پیج_اینستاگرام', '#تبلیغات_اینستاگرام',
  '#فالوور_واقعی', '#لایک_اینستاگرام', '#رشد_پیج', '#سوشال_مدیا_مارکتینگ',
  '#تیک_تاک_افغانستان', '#فالوور_تیک_تاک', '#ویو_تیک_تاک',
  '#کانال_تلگرام', '#ممبر_تلگرام', '#تلگرام_افغانستان',
  '#یوتیوب_افغانستان', '#ساب_اسکرایب_یوتیوب',
  '#افغان_فالوورز', '#افغانستان', '#گیم_افغانستان', '#بازی_موبایل', '#پابجی_موبایل'
];

async function runAutoPostJobInner(tgCfg, today, dryRun) {
  const results = { facebook: null, telegram: null };
  const doy = dayOfYear();
  const focus = AUTOPOST_FOCUS[doy % AUTOPOST_FOCUS.length];
  const angle = AUTOPOST_ANGLES[doy % AUTOPOST_ANGLES.length];
  const urgency = AUTOPOST_URGENCY[doy % AUTOPOST_URGENCY.length];
  // Picks a rotating 4-tag slice of the pool so the whole set cycles through
  // over several days instead of the model choosing (or repeating) freely.
  const hashtagStart = (doy * 4) % AUTOPOST_HASHTAG_POOL.length;
  const hashtags = [0, 1, 2, 3].map(i => AUTOPOST_HASHTAG_POOL[(hashtagStart + i) % AUTOPOST_HASHTAG_POOL.length]);

  const promoPrompt = `یک پست تبلیغاتی کوتاه، پرانرژی و با شخصیت به زبان فارسی/دری برای AfghanFollowers (afghanfollowers.online) بنویس — پنل فروش فالوور، لایک و ویو واقعی برای اینستاگرام، تیک‌تاک، یوتیوب، تلگرام و فیسبوک، مخصوصاً برای مخاطب افغان و ایرانی.

امروز تمرکز پست را روی این موضوع بگذار: ${focus}
زاویه نوشتن امروز: ${angle}
این پیام فوریت/پیشنهاد را به‌طور طبیعی داخل متن بگنجان (نه به شکل جمله جدا و بریده): ${urgency}

قوانین:
- حداکثر ۶ خط
- لحن دوستانه، پرانرژی و با شخصیت — انگار داری با یک دوست حرف می‌زنی، نه یک آگهی رسمی و خشک
- با ایموجی‌های مناسب (نه بیش از حد)
- درباره سرویس دیگری غیر از AfghanFollowers چیزی ننویس
- در پایان دقیقاً همین هشتگ‌ها را بیار: ${hashtags.join(' ')}
- بعد از هشتگ‌ها آدرس سایت afghanfollowers.online را بنویس
- تمام متن باید کاملاً فارسی/دری باشد — هیچ کلمه‌ی انگلیسی، ترکی یا هر زبان دیگری داخل جمله‌ها استفاده نکن؛ تنها استثنا خود کلمه "AfghanFollowers"، آدرس سایت و هشتگ‌های داده‌شده است
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

  // Dry run: preview only — no Facebook publish, no real Telegram channel
  // post, no smm_last_autopost_date write (so it can never block or count as
  // today's real run). Only DMs the admin chat, clearly labeled.
  if (dryRun) {
    if (tgCfg.token) {
      await fetch(`https://api.telegram.org/bot${tgCfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgCfg.chatId || AUTOPOST_ADMIN_CHAT_ID,
          text: `🧪 DRY RUN — پیش‌نمایش پست خودکار (${focus})\n`
            + `هیچ‌چیز منتشر نشد (نه فیسبوک، نه کانال تلگرام).\n\n`
            + `متن پست:\n${postText}`
        })
      }).catch(() => {});
    }
    return { ok: true, dryRun: true, focus, post: postText };
  }

  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
    const fbResp = await fetch(`https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Explicit `link` — the AI-generated text only mentions the bare
      // domain (no https://) so Facebook won't auto-detect it as a URL to
      // scrape for a preview card; without this param the post had no image.
      body: JSON.stringify({ message: postText, link: SITE + '/', access_token: process.env.FB_PAGE_TOKEN })
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

  if (today) {
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_last_autopost_date: today, smm_ts: Date.now() })
    }).catch(() => {});
  }

  return { ok: true, focus, results };
}

// ── Daily bulk email campaign ──
// The admin panel's Bulk Campaign tab used to be entirely client-side: the
// admin had to keep their browser tab open and manually click "Send" every
// single day, re-uploading the same CSV each time since the list only ever
// lived in that page's memory. Requested explicitly: make it run on its own
// every day, sending up to the configured daily limit, with a fresh
// AI-generated message instead of the same static text every time.
//
// Reuses the branded-template wrapping admin.html's generateEmailAI() does
// client-side (see wrapEmailTemplate() there) — duplicated here in minimal
// form since this runs server-side with no access to that JS.
function wrapBulkEmailHtml(innerHtml, siteName) {
  return '<div dir="rtl" style="font-family:Tahoma,\'Segoe UI\',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8f9fa;text-align:right">'
    + '<div style="background:linear-gradient(135deg,#7c5cfc,#00d2a0);padding:18px 20px;border-radius:12px 12px 0 0;text-align:center">'
    + '<span style="color:#fff;font-size:22px;font-weight:800">🌟 ' + siteName + '</span></div>'
    + '<div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 4px 20px rgba(0,0,0,.08);line-height:1.9">'
    + innerHtml
    + '<div style="text-align:center;margin:20px 0 0">'
    + '<a href="{{panel_link}}" style="background:linear-gradient(135deg,#7c5cfc,#5b21b6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">🚀 ورود به پنل</a>'
    + '</div>'
    + '<p style="font-size:12px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:14px;margin:20px 0 0">© ' + siteName + ' · تمامی حقوق محفوظ است</p>'
    + '</div></div>';
}

const BULK_EMAIL_TOPICS = [
  'دعوت به استفاده از سرویس‌های افزایش فالوور و لایک اینستاگرام',
  'معرفی سرویس‌های تیک‌تاک (فالوور، لایک، ویو)',
  'یادآوری برنامه لایک رایگان و نحوه دریافت آن',
  'معرفی سرویس‌های افزایش ممبر و بازدید تلگرام',
  'معرفی سرویس‌های یوتیوب (ساب‌اسکرایب و ویو)',
  'یادآوری تحویل سریع و پشتیبانی ۲۴ ساعته'
];

async function runBulkEmailCampaignJob() {
  const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  const db = await dbResp.json();
  const listData = db.smm_bulk_campaign_list;
  const cfg = db.smm_email_auto_cfg || {};
  const today = todayKey();

  if (!listData || !Array.isArray(listData.all) || !listData.all.length) {
    return { ok: true, skipped: true, reason: 'No bulk campaign recipient list uploaded yet' };
  }
  // Same guard pattern as the other daily jobs in this file — this endpoint
  // gets hit more than once a day (retries, manual /api/sync-orders visits),
  // so without this a second hit the same day would send a whole extra
  // batch to the next 200 people instead of waiting for tomorrow.
  if (db.smm_last_bulk_campaign_date === today) {
    return { ok: true, skipped: true, reason: 'Already ran today (' + today + ')' };
  }
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY missing in Vercel env vars' };
  }
  if (!cfg.from) {
    return { ok: false, error: 'From Email not configured in Admin -> Email Automation' };
  }

  let sentLog = db.smm_bulk_campaign_sent || {};
  const statuses = listData.statuses || {};
  let recipients = listData.all.filter(r => statuses[r.status] && !sentLog[r.email]);

  // A one-time send stops producing anything the moment the list runs out —
  // exactly what left this sending 0 new emails/day after its first pass
  // (794 sent, list exhausted, nothing left to ever send again), even
  // though the admin can comfortably send ~190/day and wants it to keep
  // going. Once every recipient has been emailed this cycle, wait a full
  // week from whenever that exhaustion was FIRST noticed (not from every
  // subsequent hit), then start the same list over from the top.
  const CYCLE_RESET_MS = 7 * 24 * 60 * 60 * 1000;
  let cycleWasReset = false;
  if (!recipients.length) {
    const cycleAt = db.smm_bulk_campaign_cycle_at || 0;
    const now = Date.now();
    if (!cycleAt) {
      // First time this list has ever been fully exhausted — start the
      // one-week countdown from now rather than resetting immediately, so
      // a list that finishes sending today doesn't also get double-emailed
      // today.
      await fetchInternal(API_BASE + '/api/db', {
        method: 'POST', headers: dbHeaders(),
        body: JSON.stringify({ smm_bulk_campaign_cycle_at: now, smm_ts: Date.now() })
      });
      return { ok: true, sent: 0, reason: 'Every recipient has been emailed — the list will restart in 7 days' };
    }
    if (now - cycleAt < CYCLE_RESET_MS) {
      const daysLeft = Math.ceil((CYCLE_RESET_MS - (now - cycleAt)) / 86400000);
      return { ok: true, sent: 0, reason: 'Every recipient has been emailed — the list restarts in ' + daysLeft + ' day(s)' };
    }
    // A full week has passed since the list was last exhausted — start it
    // over from the top for everyone still on an eligible status. The
    // final write below only ever MERGES smm_bulk_campaign_sent (see
    // db.js — two independent writers, the admin's manual "Send Now" and
    // this cron, must never erase each other's progress), so sending {}
    // there would silently leave all 794 old entries in place server-side
    // and this reset would never actually take effect. The explicit
    // smm_bulk_campaign_sent_clear flag is the one thing that truly wipes
    // it; do that now, then let the merge below apply just today's batch
    // on top of the now-genuinely-empty log.
    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST', headers: dbHeaders(),
      body: JSON.stringify({ smm_bulk_campaign_sent_clear: true, smm_ts: Date.now() })
    });
    sentLog = {};
    recipients = listData.all.filter(r => statuses[r.status]);
    cycleWasReset = true;
  }

  const limit = cfg.dailyLimit > 0 ? cfg.dailyLimit : 200;
  const batch = recipients.slice(0, limit);
  const siteName = cfg.fromName || 'Afghan Followers';

  // One fresh AI-written message per day, personalized per recipient below
  // — regenerating per-recipient would be slow and mostly redundant.
  const topic = BULK_EMAIL_TOPICS[dayOfYear() % BULK_EMAIL_TOPICS.length];
  let subject = null, innerHtml = null;
  try {
    const aiResp = await fetchInternal(API_BASE + '/api/ai-chat', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ mode: 'generate_email', topic, lang: 'fa' })
    });
    const aiData = await aiResp.json();
    if (aiData.ok) { subject = aiData.subject; innerHtml = aiData.html; }
  } catch (e) { /* falls through to the saved static template below */ }
  if (!subject || !innerHtml) {
    subject = cfg.subject || ('🌟 به‌روزرسانی امروز از ' + siteName);
    innerHtml = '<p>سرویس‌های ما را همین امروز بررسی کنید!</p>';
  }
  const fullHtml = wrapBulkEmailHtml(innerHtml, siteName);
  const panelLink = SITE + '/smm-panel.html';

  // Best-effort daily preview copy — lets the admin see exactly what this
  // job is actually sending each day (the AI-generated content varies by
  // day, so there was previously no way to know without waiting for a
  // customer to forward one) without needing to be one of the real
  // recipients. Uses the same content real recipients get (with the
  // {{name}}/{{email}} placeholders filled generically, not left raw) but
  // must never block or fail the real batch below if it errors.
  if (cfg.dailyPreviewEmail) {
    try {
      const previewHtml = fullHtml
        .replace(/\{\{name\}\}/g, 'دوست عزیز')
        .replace(/\{\{email\}\}/g, cfg.dailyPreviewEmail)
        .replace(/\{\{site_name\}\}/g, siteName)
        .replace(/\{\{panel_link\}\}/g, panelLink);
      const previewPayload = {
        from: cfg.fromName ? cfg.fromName + ' <' + cfg.from + '>' : cfg.from,
        to: [cfg.dailyPreviewEmail],
        subject: '[Preview] ' + subject + ' (' + recipients.length + ' recipient(s) today)',
        html: previewHtml
      };
      if (cfg.replyTo) previewPayload.reply_to = cfg.replyTo;
      await sendViaResend(previewPayload);
    } catch (e) { /* best-effort — must not block the real send below */ }
  }

  let sent = 0, failed = 0;
  for (const r of batch) {
    const personalSubject = subject.replace(/\{\{name\}\}/g, r.name || 'دوست عزیز');
    const personalHtml = fullHtml
      .replace(/\{\{name\}\}/g, r.name || 'دوست عزیز')
      .replace(/\{\{email\}\}/g, r.email)
      .replace(/\{\{site_name\}\}/g, siteName)
      .replace(/\{\{panel_link\}\}/g, panelLink);
    const payload = {
      from: cfg.fromName ? cfg.fromName + ' <' + cfg.from + '>' : cfg.from,
      to: [r.email],
      subject: personalSubject,
      html: personalHtml
    };
    if (cfg.replyTo) payload.reply_to = cfg.replyTo;
    const result = await sendViaResend(payload);
    if (result.ok) { sentLog[r.email] = new Date().toISOString(); sent++; }
    else failed++;
  }

  const writeBody = { smm_bulk_campaign_sent: sentLog, smm_last_bulk_campaign_date: today, smm_ts: Date.now() };
  // Clear the exhaustion marker on a cycle we just restarted, so the NEXT
  // time this list runs out, it starts its own fresh 7-day countdown
  // instead of reusing this one's (already-elapsed) timestamp.
  if (cycleWasReset) writeBody.smm_bulk_campaign_cycle_at = 0;
  await fetchInternal(API_BASE + '/api/db', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify(writeBody)
  });

  return { ok: true, sent, failed, remaining: recipients.length - batch.length, cycleRestarted: cycleWasReset, topic, subject };
}
