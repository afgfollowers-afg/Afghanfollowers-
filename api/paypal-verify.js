// Vercel Serverless Function — Server-side PayPal payment verification.
//
// The client-side PayPal SDK captures an order (talks directly to PayPal's
// servers), but a captured order ID reported back by the browser is NOT on
// its own proof that a real payment happened — it's attacker-controllable
// data unless independently re-checked. This endpoint re-verifies the order
// against PayPal's own REST API (OAuth client-credentials + Orders v2) using
// the admin-configured Client ID/Secret, and only credits the wallet after
// PayPal itself confirms the order is COMPLETED and the amount matches. The
// crediting decision never depends on trusting anything the client sent.

const { dbHeaders, DB_SERVICE_KEY, API_BASE } = require('./_dbkey');
const { getAuth, AUTH_CONFIGURED, SECRET_FINGERPRINT } = require('./_auth');

const SITE = 'https://afghanfollowers.online';
const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b/';
// Bumped on every deploy of this file specifically. Included in every
// response (success or failure) so it's directly visible on the
// customer's own screen without an extra step — after repeated fixes
// that tested correctly in isolation but showed no change in production
// behavior (including a diagnostic Telegram message that reportedly never
// arrived at all, which should be impossible if this code were actually
// running), this is the fastest way to confirm whether Vercel is truly
// serving the latest deploy of this specific function or something
// (a stale build, a caching layer) is still serving an old one.
const DEPLOY_MARKER = 'pv-2026-07-16-v9-retry-diag';

async function readRecord() {
  // The retry-until-verified loop below proved a write JSONBin's own PUT
  // confirmed can still be invisible to a GET moments later, consistently,
  // not as an occasional fluke — which stopped looking like an application-
  // level race and started looking like a caching layer sitting in front
  // of JSONBin's read endpoint (a CDN in front of `/latest` is a common
  // setup for exactly this kind of read-heavy endpoint). Bust it explicitly
  // instead of assuming a plain GET is always live.
  const r = await fetch(JSONBIN_BASE + BIN_ID + '/latest?_=' + Date.now(), {
    headers: { 'X-Master-Key': API_KEY, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
  });
  const j = await r.json();
  if (!r.ok || !j.record) throw new Error('Failed to read database');
  return j.record;
}

async function getPayPalToken(clientId, secret, apiBase) {
  const r = await fetch(apiBase + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('PayPal auth failed: ' + JSON.stringify(j));
  return j.access_token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-db-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Deploy-Marker', DEPLOY_MARKER);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (!BIN_ID || !API_KEY) {
    return res.status(200).json({ ok: false, error: 'Database not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.orderId || '').trim();
    // Which wallet gets credited must come from who the caller actually
    // proved they are, not a plain body.userId anyone holding the shared
    // client key could set to any account — previously that meant paying
    // with your own PayPal and crediting someone else's balance. Falls back
    // to trusting body.userId only until AUTH_JWT_SECRET is configured (see
    // _auth.js), same rollout-safety rule api/db.js's write gate follows.
    let userId = body.userId;
    if (AUTH_CONFIGURED) {
      const auth = getAuth(req);
      if (!auth || auth.sub === undefined || auth.sub === null) {
        return res.status(200).json({ ok: false, error: 'Unauthorized' });
      }
      userId = auth.sub;
    }
    if (!orderId || userId === undefined) {
      return res.status(200).json({ ok: false, error: 'Missing orderId or userId' });
    }

    const record = await readRecord();
    const pms = record.smm_pm || [];
    const pm = pms.find((m) => m.method === 'paypal');
    if (!pm || !pm.clientId || !pm.clientSecret) {
      return res.status(200).json({ ok: false, error: 'PayPal not fully configured (missing Client ID/Secret)' });
    }

    // Idempotency — a captured order ID must only ever be credited once,
    // even if the client retries the confirmation call.
    const processed = record.smm_paypal_processed || [];
    if (processed.indexOf(orderId) !== -1) {
      return res.status(200).json({ ok: false, error: 'This payment has already been processed' });
    }

    const apiBase = pm.env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const token = await getPayPalToken(pm.clientId, pm.clientSecret, apiBase);

    const orderResp = await fetch(apiBase + '/v2/checkout/orders/' + encodeURIComponent(orderId), {
      headers: { Authorization: 'Bearer ' + token }
    });
    const order = await orderResp.json();
    if (!orderResp.ok) {
      return res.status(200).json({ ok: false, error: 'PayPal order lookup failed: ' + JSON.stringify(order) });
    }
    if (order.status !== 'COMPLETED') {
      return res.status(200).json({ ok: false, error: 'Payment not completed yet (status: ' + order.status + ')' });
    }

    const unit = order.purchase_units && order.purchase_units[0];
    const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
    if (!capture || capture.status !== 'COMPLETED') {
      return res.status(200).json({ ok: false, error: 'Payment capture not completed' });
    }
    const paidAmount = parseFloat(capture.amount.value);
    if (!paidAmount || paidAmount <= 0) {
      return res.status(200).json({ ok: false, error: 'Invalid captured amount' });
    }

    const fee = parseFloat(pm.fee) || 0;
    const feeFixed = parseFloat(pm.feeFixed) || 0;
    const feeAmt = parseFloat((paidAmount * (fee / 100) + feeFixed).toFixed(2));
    const credit = parseFloat((paidAmount - feeAmt).toFixed(2));
    // A payment below the fixed fee (or under the admin's configured minimum)
    // would otherwise produce a negative credit here, which — added straight
    // onto the user's balance below — would silently REDUCE it after a
    // "successful" payment. Refuse instead and leave it for manual review;
    // the client already shows the order id for support to reconcile.
    if (credit <= 0) {
      return res.status(200).json({ ok: false, error: 'Payment amount is too small to cover fees. Contact support with your PayPal receipt (Order: ' + orderId + ').' });
    }
    const minAmt = parseFloat(pm.min);
    if (minAmt > 0 && paidAmount < minAmt) {
      return res.status(200).json({ ok: false, error: 'Payment amount is below the minimum ($' + minAmt.toFixed(2) + '). Contact support with your PayPal receipt (Order: ' + orderId + ').' });
    }

    const users = record.smm_users || [];
    const user = users.find((u) => String(u.id) === String(userId));
    if (!user) {
      return res.status(200).json({ ok: false, error: 'User not found' });
    }

    const newBalance = parseFloat(((parseFloat(user.balance) || 0) + credit).toFixed(2));
    const newTx = {
      id: Date.now(),
      type: 'deposit',
      method: 'PayPal',
      amount: paidAmount,
      fee: feeAmt,
      credit: credit,
      ppOrderId: orderId,
      desc: 'PayPal — verified with PayPal and auto-credited',
      date: new Date().toISOString(),
      status: 'approved'
    };
    const updatedUser = Object.assign({}, user, {
      balance: newBalance,
      transactions: [newTx].concat(user.transactions || [])
    });

    processed.push(orderId);
    if (processed.length > 2000) processed.splice(0, processed.length - 2000);

    // The response used to be reported to the client as soon as the write
    // fetch resolved with ok:true — but a diagnostic added to check this
    // proved that isn't sufficient: api/db.js can report ok:true for a
    // write whose own transaction is verifiably GONE on an immediate
    // read-back moments later, within this same request. Whatever the
    // exact cause (a race with something else, an inconsistency at the
    // database layer — inconclusive so far), "the API call returned
    // ok:true" is not being treated as good enough anymore. Loop:
    // write, then independently verify the transaction is actually
    // present via a completely separate read, and only stop once that
    // read-back genuinely confirms it — not just once the write call
    // itself reported success. This order hasn't been marked processed
    // until a verified write lands, so re-attempting is always safe.
    // FOUND IT: the per-attempt trail below always showed write-ok but
    // tx-missing/balance-unchanged, on every single attempt — and this
    // function only ever checked j.ok, never j.smm_users_restricted.
    // api/db.js's write gate returns ok:true EVEN when it silently routed
    // the write through the customer-restricted path (see
    // sanitizeCustomerUserWrites) instead of the fully-trusted admin path
    // — and that restricted path explicitly strips any new `deposit`
    // transaction with status:'approved' (admin/server-only, by design —
    // see PRIVILEGED_TX_TYPES in api/db.js). If dbHeaders()'s admin-role
    // service token isn't being recognized as role:'admin' by api/db.js
    // for any reason, every retry in this loop would keep "succeeding"
    // (ok:true) while api/db.js keeps quietly discarding the deposit
    // transaction itself — exactly matching what every attempt reported.
    // Treat a restricted write as a failure requiring retry, the same way
    // admin.html/smm-panel.html already do for their own writes.
    async function writeCredit() {
      const r = await fetch(API_BASE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({
          smm_users: [updatedUser],
          smm_paypal_processed: processed,
          smm_ts: Date.now()
        })
      });
      const j = await r.json().catch(() => null);
      if (j && j.smm_users_restricted) {
        // Compare the secret THIS process signed the token with against
        // the one api/db.js verified it against, in the same round trip —
        // a mismatch here means AUTH_JWT_SECRET was changed at some point
        // and this specific serverless function is still running on a
        // warm instance that captured the OLD value at its own cold
        // start, while api/db.js's instance captured the current one (or
        // vice versa). A match means the secret is fine and the real
        // cause is something else (the token malformed some other way,
        // the header not reaching api/db.js intact, etc).
        const mine = SECRET_FINGERPRINT;
        const theirs = j.authSecretFingerprint;
        let line = 'write-RESTRICTED — secret fingerprint mine=' + mine + ' vs db.js=' + (theirs || 'n/a') + (mine === theirs ? ' (MATCH — not a secret mismatch)' : ' (MISMATCH — this is a stale-secret issue)');
        if (j.authDiagnostic) line += ' | reason: ' + JSON.stringify(j.authDiagnostic);
        attemptLog.push(line);
        return false;
      }
      return !!(j && j.ok === true);
    }
    // Two prior fixes (retry-until-verified, then cache-busting the read)
    // both still exhausted every attempt on real tests — meaning either
    // the read is genuinely still seeing stale data every single time, or
    // something about the READ ITSELF is silently failing (a rejected
    // request due to the new headers, a parse error, etc.) and being
    // swallowed by a bare catch, which would look identical to "verified
    // false" from the outside. Capture which one it actually is per
    // attempt instead of collapsing both into a single boolean.
    const attemptLog = [];
    async function verifyLanded() {
      try {
        const verifyRecord = await readRecord();
        const verifyUser = (verifyRecord.smm_users || []).find((u) => String(u.id) === String(userId));
        const found = !!(verifyUser && (verifyUser.transactions || []).some((t) => t && t.id === newTx.id));
        attemptLog.push('read-ok,user-' + (verifyUser ? 'found' : 'MISSING') + ',tx-' + (found ? 'found' : 'missing') + ',balance=' + (verifyUser ? verifyUser.balance : 'n/a'));
        return found;
      } catch (e) {
        attemptLog.push('READ-THREW: ' + e.message);
        return false;
      }
    }
    let saved = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 4;
    while (!saved && attempts < MAX_ATTEMPTS) {
      attempts++;
      const wroteOk = await writeCredit();
      attemptLog.push('attempt ' + attempts + ': write-' + (wroteOk ? 'ok' : 'FAILED'));
      if (wroteOk) saved = await verifyLanded();
    }
    if (!saved) {
      // Surface the full diagnostic trail to the admin — this is the
      // difference between "the write keeps failing", "the read keeps
      // seeing stale data", and "the read itself is erroring out", which
      // all look identical from the customer's side but need different
      // fixes.
      try {
        const cfg = record.smm_tg_bot || {};
        if (cfg.token && cfg.chatId) {
          await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.chatId,
              parse_mode: 'HTML',
              text: `❌ <b>PayPal credit could NOT be verified after ${MAX_ATTEMPTS} attempts</b>\nUser: ${updatedUser.fname || updatedUser.email || userId}\nOrder: ${orderId}\nExpected transaction id: ${newTx.id}\n\n${attemptLog.map((l) => '• ' + l).join('\n')}`
            })
          });
        }
      } catch (e) { /* best-effort */ }
      return res.status(200).json({
        ok: false,
        deployMarker: DEPLOY_MARKER,
        error: 'Payment was verified with PayPal but could not be reliably saved [' + DEPLOY_MARKER + '] — please contact support with your PayPal receipt (Order: ' + orderId + ').'
      });
    }
    // Best-effort admin notification — must never fail the verified response.
    try {
      const cfg = record.smm_tg_bot || {};
      if (cfg.token && cfg.chatId) {
        await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cfg.chatId,
            parse_mode: 'HTML',
            text: `✅ <b>PayPal Verified & Credited</b>\nUser: ${updatedUser.fname || updatedUser.email || userId}\nPaid: $${paidAmount.toFixed(2)}\nCredited: $${credit.toFixed(2)}\nNew Balance: $${newBalance.toFixed(2)}\nOrder: ${orderId}\nWrite verified present on read-back${attempts > 1 ? ` (needed ${attempts} attempts — see if this keeps happening)` : ''}`
          })
        });
      }
    } catch (e) { /* best-effort */ }

    // transaction is returned so the client can add it straight into its
    // local copy of the user's history immediately — the balance patch
    // alone (see smm-panel.html's verifyPayPalOrder()) left Payment History
    // showing nothing for this deposit until the next full server sync.
    return res.status(200).json({ ok: true, credited: credit, newBalance: newBalance, transaction: newTx, deployMarker: DEPLOY_MARKER });
  } catch (e) {
    return res.status(200).json({ ok: false, deployMarker: DEPLOY_MARKER, error: e.message + ' [' + DEPLOY_MARKER + ']' });
  }
};
