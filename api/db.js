// Vercel Serverless Function — Real persistent cross-device sync via JSONBin.io
// Uses TWO bins (JSONBin free plan caps each record at 100KB):
//  - Main bin (JSONBIN_BIN_ID): smm_users, smm_orders, smm_tickets
//  - Services bin (JSONBIN_SVC_BIN_ID): smm_svc, GZIP-COMPRESSED to fit the size limit
//
// Env vars needed: JSONBIN_BIN_ID, JSONBIN_SVC_BIN_ID, JSONBIN_API_KEY

const zlib = require('zlib');
const { DB_SERVICE_KEY } = require('./_dbkey');
const { getAuth, diagnoseAuth, AUTH_CONFIGURED, SECRET_FINGERPRINT } = require('./_auth');

// Transaction types that credit or debit a wallet by admin/server decision
// rather than the customer's own in-the-moment action — never allowed to
// appear as a *new* entry in a customer-role smm_users push (see
// sanitizeCustomerUserWrites below). A customer submitting their own manual
// deposit gets 'deposit_pending' (no balance change until an admin
// approves); PayPal's own auto-credit goes through paypal-verify.js with an
// admin-equivalent server token, not a customer token. 'refund' is NOT
// listed here — smm-panel.html's cancelOrder() lets a customer cancel
// their own order and refund themselves as a normal self-service action,
// pre-dating this gate; smm_orders writes aren't validated by this gate at
// all yet, so a forged order cost feeding a forged refund is a real,
// separate gap this doesn't close — noted, not fixed here.
const PRIVILEGED_TX_TYPES = ['admin_credit', 'admin_debit', 'bonus'];

// Restricts an smm_users push from a plain customer token (or no/invalid
// token at all) to only what that customer could legitimately have caused
// themselves: their own record, and only balance changes justified by a
// transaction type they're allowed to self-create, computed against the
// CURRENT server-side balance — never whatever the client claims. Every
// other user in the incoming array is dropped outright; balance, role,
// status, and the transaction ledger are always server-authoritative here,
// no matter what the client sent for them. This is what actually closes
// the gap the rest of this file's history documents repeatedly: a customer
// forging their own balance, another user's balance, or a self-granted
// bonus/admin_credit by POSTing a crafted smm_users array directly.
function sanitizeCustomerUserWrites(incoming, currentUsers, subId) {
  if (subId === undefined || subId === null) return [];
  const currentMap = {};
  (currentUsers || []).forEach(function (u) { if (u && u.id !== undefined) currentMap[u.id] = u; });

  const out = [];
  (incoming || []).forEach(function (item) {
    if (!item || String(item.id) !== String(subId)) return;
    const existing = currentMap[item.id];
    const serverBalance = existing ? (parseFloat(existing.balance) || 0) : 0;
    const existingTxIds = {};
    (existing && existing.transactions || []).forEach(function (t) { if (t && t.id !== undefined) existingTxIds[t.id] = true; });

    // Only genuinely NEW transaction ids matter — anything matching an id
    // that already exists server-side is ignored here entirely (the
    // server's own copy always wins via mergeUsersById's union below), so a
    // customer token can never edit an existing transaction's status,
    // amount, or type in place, only add brand new ones.
    const incomingTx = Array.isArray(item.transactions) ? item.transactions : [];
    const candidateNewTx = incomingTx.filter(function (t) { return t && t.id !== undefined && !existingTxIds[t.id]; });

    let runningBalance = serverBalance;
    const acceptedTx = [];
    candidateNewTx.forEach(function (t) {
      if (PRIVILEGED_TX_TYPES.indexOf(t.type) !== -1 || (t.type === 'deposit' && t.status === 'approved')) {
        return; // only an admin token or a trusted server-to-server caller may create these
      }
      if (t.type === 'deposit_pending') {
        acceptedTx.push(t); // must not itself change balance — credited only on admin approval
        return;
      }
      if (t.type === 'withdrawal' || t.type === 'spend') {
        const amt = parseFloat(t.amount) || 0;
        if (amt > 0 && amt <= runningBalance) {
          runningBalance = parseFloat((runningBalance - amt).toFixed(2));
          acceptedTx.push(t);
        }
        return;
      }
      if (t.type === 'refund') {
        // cancelOrder() in smm-panel.html — a customer cancelling their own
        // order and refunding themselves. No upper bound checked against
        // an actual order here (see the note above PRIVILEGED_TX_TYPES).
        const amt = parseFloat(t.amount) || 0;
        if (amt > 0) {
          runningBalance = parseFloat((runningBalance + amt).toFixed(2));
          acceptedTx.push(t);
        }
        return;
      }
      // Unrecognized type from a customer token — dropped, fail safe.
    });

    out.push(Object.assign({}, item, {
      transactions: acceptedTx,
      balance: runningBalance,
      role: existing ? existing.role : 'user',
      status: existing ? existing.status : 'active'
    }));
  });
  return out;
}

const BIN_ID = process.env.JSONBIN_BIN_ID;
const SVC_BIN_ID = process.env.JSONBIN_SVC_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const BASE = 'https://api.jsonbin.io/v3/b/';
const SITE_ORIGIN = 'https://afghanfollowers.online';

async function readBin(binId) {
  // See api/paypal-verify.js's readRecord() for why: a write JSONBin's own
  // PUT confirmed can still be invisible to a GET moments later, and it
  // happened consistently across repeated real-world attempts rather than
  // as an occasional fluke — pointing at a caching layer in front of
  // JSONBin's read endpoint rather than an application-level race. Bust it
  // explicitly on every read here too, since this is what both the
  // pre-write re-check and every other caller's baseline read go through.
  const r = await fetch(BASE + binId + '/latest?_=' + Date.now(), {
    headers: { 'X-Master-Key': API_KEY, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
  });
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
    // Admin-set manual overrides (Admin -> User Invites -> edit) win over the
    // real deduped count, for correcting a user's progress without touching
    // the underlying IP log.
    const visitOverrides = main.record.smm_ref_visit_overrides || {};
    Object.keys(visitOverrides).forEach(function (k) { visitCounts[k] = visitOverrides[k]; });
    const record = Object.assign({}, main.record);
    delete record.smm_ref_visits;

    // smm_pm carries admin-configured payment-method secrets (PayPal client
    // secret, Binance/Stripe API secrets). This endpoint is reachable by any
    // logged-in customer (and any public page holding the shared client
    // key), so those secrets must never leave the server — strip them here
    // rather than trusting every caller of this data to ignore them.
    if (Array.isArray(record.smm_pm)) {
      record.smm_pm = record.smm_pm.map(function (m) {
        const c = Object.assign({}, m);
        // Replace each secret with a boolean "is it set" flag rather than
        // just deleting it silently — the admin panel needs to tell "this
        // secret is configured server-side, just not shown here" apart
        // from "genuinely never configured", otherwise a fresh browser/
        // device with no local copy of the secret looks identical to one
        // where PayPal was never set up, and re-saving from that blank
        // state would overwrite the real secret with nothing.
        ['clientSecret', 'secretKey', 'apiKey', 'secKey'].forEach(function (k) {
          c['_has_' + k] = !!c[k];
          delete c[k];
        });
        return c;
      });
    }

    // smm_providers[].key is the real API key for the panel's SMM supplier
    // account — used server-side (dispatchOneOrder in sync-orders.js) to
    // actually place orders with the provider. It was previously shipped to
    // every browser via this same GET, and smm-panel.html's own order-
    // placement code read it straight out of that cached response to call
    // /api/place-order directly — meaning any visitor could extract a live
    // supplier credential and abuse it outside this site entirely. Strip it
    // here, same as smm_pm's secrets above; order dispatch no longer needs
    // the client to see it (see dispatchOneOrder()/place-order.js).
    if (Array.isArray(record.smm_providers)) {
      record.smm_providers = record.smm_providers.map(function (p) {
        const c = Object.assign({}, p);
        delete c.key;
        return c;
      });
    }

    // Surfaced so the admin panel can show a clear "auth not active" warning
    // instead of the alternative — a customer/admin silently getting the
    // pre-auth, unprotected write path with no visible sign why a balance
    // update might not be sticking (see admin.html's authStatus banner).
    const out = Object.assign({}, record, { smm_svc: svc, smm_ref_visit_counts: visitCounts, authConfigured: AUTH_CONFIGURED });
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

        // Admin-configurable via Admin -> Settings -> General -> "Link Visits
        // Required" (g-fl-visits), falls back to 50 if never configured.
        const VISIT_GOAL = parseInt((current.smm_general || {})['g-fl-visits'], 10) || 50;
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

      // smm_users needs one thing mergeById's plain "incoming replaces
      // current" can't give it: transactions is itself a growing ledger
      // written from many independent places (a customer's own deposit/
      // withdrawal, a signup bonus, an admin's balance adjustment, an order
      // refund...), and admin.html has ~10 call sites that push the WHOLE
      // smm_users array as a side effect of one unrelated action, using
      // whatever is in that browser's local cache at that moment. Any of
      // those pushes racing a few seconds ahead of the admin's own 30s poll
      // picking up a customer's brand new transaction would — under a plain
      // per-user replace — silently erase that transaction (e.g. a just-
      // granted signup bonus, or a deposit the customer submitted seconds
      // earlier) the moment the stale copy overwrote the user object. Union
      // transactions by their own id instead, so neither side can ever drop
      // an entry the other doesn't know about yet; every other field still
      // takes the incoming value, same as before.
      //
      // That union alone still left one gap: it protects the transaction
      // RECORD, but not the numeric `balance` field, which reconcileBalance
      // is for. An admin browser's cache can sit stale for minutes (it only
      // refreshes on its own 30s poll, or when a page happens to re-render)
      // — a customer's PayPal payment landing in that window, then ANY
      // unrelated admin click (order status, ticket reply, free-likes
      // approval — any of those ~10 call sites) pushes that admin's whole,
      // now-stale smm_users array straight back, including this customer's
      // OLD balance. The transaction itself survives (unioned above), but
      // the balance the admin's browser never knew about is silently
      // discarded — money "vanishes" the next time this user's balance is
      // read, even though its own transaction is still sitting right there
      // in the ledger. Reconcile by adding back the effect of any
      // transaction the incoming push doesn't know about yet, instead of
      // trusting its balance figure outright. Only used for the fully-
      // trusted admin-role merge (see call site below) — the customer-role
      // path already computes balance freshly against this same read on
      // every request via sanitizeCustomerUserWrites, so re-applying this
      // here would double-count.
      function txBalanceDelta(t) {
        if (!t || !t.type) return 0;
        if (t.type === 'deposit') {
          // A PayPal deposit's `amount` is the gross amount paid — what
          // actually landed on the balance is `credit` (amount minus fees,
          // see api/paypal-verify.js). Other deposit-crediting paths don't
          // split the two, so fall back to `amount` if `credit` is absent.
          if (t.status !== 'approved') return 0;
          var c = t.credit !== undefined ? parseFloat(t.credit) : parseFloat(t.amount);
          return c > 0 ? c : 0;
        }
        var amt = parseFloat(t.amount) || 0;
        if (amt <= 0) return 0;
        if (t.type === 'bonus' || t.type === 'refund' || t.type === 'admin_credit') return amt;
        if (t.type === 'withdrawal' || t.type === 'spend' || t.type === 'admin_debit') return -amt;
        return 0; // deposit_pending and anything unrecognized never affect balance
      }
      function mergeUsersById(currentArr, incomingArr, reconcileBalance) {
        var map = {};
        (currentArr || []).forEach(function (item) { if (item && item.id !== undefined) map[item.id] = item; });
        (incomingArr || []).forEach(function (item) {
          if (!item || item.id === undefined) return;
          var existing = map[item.id];
          if (existing && Array.isArray(existing.transactions) && Array.isArray(item.transactions)) {
            var incomingTxIds = {};
            item.transactions.forEach(function (t) { if (t && t.id !== undefined) incomingTxIds[t.id] = true; });
            var missedDelta = 0;
            if (reconcileBalance) {
              existing.transactions.forEach(function (t) {
                if (t && t.id !== undefined && !incomingTxIds[t.id]) missedDelta += txBalanceDelta(t);
              });
            }
            var txMap = {};
            existing.transactions.forEach(function (t) { if (t && t.id !== undefined) txMap[t.id] = t; });
            item.transactions.forEach(function (t) { if (t && t.id !== undefined) txMap[t.id] = t; });
            item = Object.assign({}, item, {
              transactions: Object.keys(txMap).map(function (k) { return txMap[k]; })
                .sort(function (a, b) { return (b.id || 0) - (a.id || 0); })
            });
            if (missedDelta !== 0) {
              item.balance = parseFloat(((parseFloat(item.balance) || 0) + missedDelta).toFixed(2));
            }
          }
          map[item.id] = item;
        });
        return Object.keys(map).map(function (k) { return map[k]; });
      }

      // Set below whenever an smm_users write went through the restricted
      // customer path (or was silently dropped for having no valid
      // identity at all) instead of the full admin merge — reported back
      // in the response so a caller that expected admin-level access (an
      // admin.html write, run with a stale pre-token session) can tell its
      // "success" toast was a lie instead of finding out only when the
      // change reappears missing after the next fresh pull.
      let smmUsersRestricted = false;
      let smmUsersAuth = null; // computed once, reused by the re-check right before the write
      // Factored out so it can run twice against two different baselines:
      // once now (against the record read at the top of this request), and
      // once again immediately before the final write if something else
      // wrote in between (see below) — reconcileBalance's per-transaction
      // recovery only works if it's comparing against a baseline that's as
      // fresh as possible.
      let smmUsersAuthDiagnostic = null;
      function computeMergedUsers(baselineUsers) {
        if (!AUTH_CONFIGURED) {
          return { merged: mergeUsersById(baselineUsers, body.smm_users, true), restricted: false };
        }
        smmUsersAuth = smmUsersAuth || getAuth(req);
        if (smmUsersAuth && smmUsersAuth.role === 'admin') {
          return { merged: mergeUsersById(baselineUsers, body.smm_users, true), restricted: false };
        }
        // The secret-fingerprint check already ruled out a mismatched
        // AUTH_JWT_SECRET between processes — capture exactly why THIS
        // token still failed (missing header, bad signature, expired,
        // wrong role) so a server-to-server caller can report it directly
        // instead of the mystery repeating with no way to narrow further.
        smmUsersAuthDiagnostic = smmUsersAuthDiagnostic || diagnoseAuth(req);
        const allowed = sanitizeCustomerUserWrites(body.smm_users, baselineUsers, smmUsersAuth && smmUsersAuth.sub);
        // "restricted" is the signal the client uses to force a re-login
        // (see forceCustomerReauth()/forceAdminReauth()) — it must mean
        // "there was no valid identity to write as at all" (no token,
        // expired, bad signature — see diagnoseAuth() above), NOT merely
        // "this wasn't an admin token". A customer with a perfectly valid,
        // unexpired role:'user' token writing their own record through the
        // narrower self-service rules in sanitizeCustomerUserWrites is
        // completely normal, expected traffic — every such write used to
        // set this true unconditionally, which meant saveCurrentUser()'s
        // own restricted-check forced every logged-in customer back to the
        // login page on essentially their next profile/wallet update.
        return { merged: allowed.length ? mergeUsersById(baselineUsers, allowed) : baselineUsers, restricted: !smmUsersAuth };
      }
      if (body.smm_users && Array.isArray(body.smm_users)) {
        const usersResult = computeMergedUsers(current.smm_users);
        current.smm_users = usersResult.merged;
        smmUsersRestricted = usersResult.restricted;
      }
      if (body.smm_users_delete_id !== undefined) {
        current.smm_users = (current.smm_users || []).filter(function (u) {
          return String(u.id) !== String(body.smm_users_delete_id);
        });
      }
      if (body.smm_orders && Array.isArray(body.smm_orders)) {
        current.smm_orders = mergeById(current.smm_orders, body.smm_orders);
      }
      if (body.smm_orders_delete_id !== undefined) {
        current.smm_orders = (current.smm_orders || []).filter(function (o) {
          return String(o.id) !== String(body.smm_orders_delete_id);
        });
      }
      if (body.smm_tickets && Array.isArray(body.smm_tickets)) {
        current.smm_tickets = mergeById(current.smm_tickets, body.smm_tickets);
      }
      // Payment methods: admin is the single source of truth for everything
      // EXCEPT secrets (clientSecret, secretKey, apiKey, secKey). Those are
      // stripped out of every GET response (see above), so a browser/device
      // that never had the real secret locally — a second device, or the
      // same one after a storage clear — always pushes this array back with
      // those fields blank. A blind overwrite here would let that blank
      // permanently erase the real, previously-configured secret the moment
      // that browser saved ANY unrelated setting. Instead, only replace a
      // secret field when the incoming value is genuinely non-empty;
      // otherwise keep whatever the server already has for that method id.
      if (body.smm_pm && Array.isArray(body.smm_pm)) {
        const prevPm = Array.isArray(current.smm_pm) ? current.smm_pm : [];
        const SECRET_FIELDS = ['clientSecret', 'secretKey', 'apiKey', 'secKey'];
        current.smm_pm = body.smm_pm.map(function (incoming) {
          const prev = prevPm.find(function (p) { return String(p.id) === String(incoming.id); });
          if (!prev) return incoming;
          const merged = Object.assign({}, incoming);
          SECRET_FIELDS.forEach(function (k) {
            if (!merged[k] && prev[k]) merged[k] = prev[k];
          });
          return merged;
        });
      }
      // Same reasoning as smm_pm above: .key is stripped from every GET
      // response, so a browser that never had the real provider API key
      // locally would otherwise wipe it out the moment it saved any
      // unrelated provider change (markup %, name, adding/removing a
      // different provider) — which would silently break order dispatch
      // for every customer, not just one payment method.
      if (body.smm_providers && Array.isArray(body.smm_providers)) {
        const prevProviders = Array.isArray(current.smm_providers) ? current.smm_providers : [];
        current.smm_providers = body.smm_providers.map(function (incoming) {
          const prev = prevProviders.find(function (p) { return String(p.id) === String(incoming.id); });
          if (prev && !incoming.key && prev.key) {
            return Object.assign({}, incoming, { key: prev.key });
          }
          return incoming;
        });
      }
      if (body.smm_bonuses && Array.isArray(body.smm_bonuses)) {
        current.smm_bonuses = body.smm_bonuses;
      }
      if (body.smm_coupons && Array.isArray(body.smm_coupons)) {
        current.smm_coupons = body.smm_coupons;
      }
      if (body.smm_categories && Array.isArray(body.smm_categories)) {
        current.smm_categories = body.smm_categories;
      }
      if (body.smm_modules && typeof body.smm_modules === 'object') {
        current.smm_modules = body.smm_modules;
      }
      if (body.smm_paypal_processed && Array.isArray(body.smm_paypal_processed)) {
        // Verified-order ledger written by api/paypal-verify.js so a
        // captured PayPal order can never be credited twice.
        current.smm_paypal_processed = body.smm_paypal_processed;
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
        // NOT a single-writer field — the track_ref_visit branch above also
        // pushes new pending entries here independently of the admin panel.
        // A plain overwrite let the admin's browser silently erase a
        // just-arrived pending entry any time it called pushToServer() with
        // a locally stale copy (e.g. right after approving/rejecting a
        // ticket, which has nothing to do with this queue) — the admin
        // panel would then never show "Needs Approval" for a reward that
        // genuinely qualified. Merge by ref instead: the admin's copy wins
        // for refs it knows about (status changes), but any ref that exists
        // only on the server (a brand new pending entry) survives.
        const existingQueue = current.smm_ref_visit_queue || [];
        const mergedQueue = {};
        existingQueue.forEach(function (q) { if (q && q.ref) mergedQueue[q.ref] = q; });
        body.smm_ref_visit_queue.forEach(function (q) { if (q && q.ref) mergedQueue[q.ref] = q; });
        current.smm_ref_visit_queue = Object.keys(mergedQueue).map(function (k) { return mergedQueue[k]; });
      }
      if (body.smm_ref_visit_overrides && typeof body.smm_ref_visit_overrides === 'object') {
        // Admin-set manual visit counts per referral code, applied on top of
        // the real (deduped) visit log below — lets the admin correct a
        // user's displayed/counted progress without touching the raw IP
        // log. Admin is the sole writer, so a plain overwrite is safe.
        current.smm_ref_visit_overrides = body.smm_ref_visit_overrides;
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
      if (body.smm_stuck_orders && Array.isArray(body.smm_stuck_orders)) {
        // Orders the sync-orders retry job couldn't dispatch (bad catalog
        // match, provider out of funds, etc.) — sole writer is that cron,
        // replaced wholesale each run so resolved orders drop off.
        current.smm_stuck_orders = body.smm_stuck_orders;
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
      if (typeof body.smm_last_bulk_campaign_date === 'string') {
        // Same guard, for the daily bulk-email cron (sole writer).
        current.smm_last_bulk_campaign_date = body.smm_last_bulk_campaign_date;
      }
      if (body.smm_bulk_campaign_list && typeof body.smm_bulk_campaign_list === 'object') {
        // The CSV the admin uploaded (recipients + status filter) — sole
        // writer is the admin panel, plain overwrite is fine.
        current.smm_bulk_campaign_list = body.smm_bulk_campaign_list;
      }
      if (body.smm_bulk_campaign_sent_clear === true) {
        // Explicit admin "reset the sent log" action — the one case that
        // must actually clear rather than merge, checked before the merge
        // branch below so a reset always wins even if both were somehow
        // sent together.
        current.smm_bulk_campaign_sent = {};
      } else if (body.smm_bulk_campaign_sent && typeof body.smm_bulk_campaign_sent === 'object') {
        // Two writers: the admin's manual "Send Now" and the daily cron —
        // merge instead of overwrite so neither can erase the other's
        // progress if they happen to run close together.
        current.smm_bulk_campaign_sent = Object.assign({}, current.smm_bulk_campaign_sent || {}, body.smm_bulk_campaign_sent);
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
      // JSONBin has no compare-and-swap — two concurrent requests here each
      // independently read-then-write the WHOLE record, so whichever
      // finishes last simply overwrites the other's changes outright,
      // regardless of any per-field merge logic above (that logic only
      // helps once a request's own baseline already reflects the other
      // write; it can't if both requests read before either one wrote).
      // This is exactly how a PayPal credit that lands correctly can still
      // vanish moments later: this request's own read happened before that
      // credit's write, so from this request's perspective the credit
      // never existed to merge against or reconcile. A real fix needs
      // proper optimistic concurrency (version-checked writes with retry);
      // as a narrow, practical mitigation for the highest-stakes field,
      // re-read and redo the smm_users merge one more time immediately
      // before writing — shrinking the race window from "however long
      // this whole request took" (PayPal's own API round-trip alone can
      // run several seconds) down to the handful of milliseconds between
      // this re-read and the write below.
      if (body.smm_users && Array.isArray(body.smm_users)) {
        const recheck = await readBin(BIN_ID);
        if (recheck.ok && recheck.record && recheck.record.smm_ts !== main.record.smm_ts) {
          const revisedResult = computeMergedUsers(recheck.record.smm_users || []);
          current.smm_users = revisedResult.merged;
          smmUsersRestricted = revisedResult.restricted;
        }
      }
      current.smm_ts = Date.now();

      const w2 = await writeBin(BIN_ID, current);
      if (!w2.ok) return res.status(200).json({ diag: 'PUT_MAIN_FAILED', jsonbinStatus: w2.status, jsonbinBodyRaw: w2.raw });

      return res.status(200).json({
        ok: true,
        users: (current.smm_users || []).length,
        orders: (current.smm_orders || []).length,
        ts: current.smm_ts,
        smm_users_restricted: smmUsersRestricted,
        // Included whenever a write was restricted so a server-to-server
        // caller (paypal-verify.js) can directly compare "the secret I
        // signed this token with" against "the secret db.js verified it
        // against" in the very same round trip, instead of guessing —
        // see _auth.js's SECRET_FINGERPRINT for why this is safe to expose.
        authSecretFingerprint: smmUsersRestricted ? SECRET_FINGERPRINT : undefined,
        authDiagnostic: smmUsersAuthDiagnostic || undefined
      });
    } catch (e) {
      return res.status(200).json({ diag: 'POST_EXCEPTION', error: e.message });
    }
  }

  return res.status(405).json({});
};
