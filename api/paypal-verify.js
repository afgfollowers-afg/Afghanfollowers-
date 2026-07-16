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

const { dbHeaders, DB_SERVICE_KEY } = require('./_dbkey');
const { getAuth, AUTH_CONFIGURED } = require('./_auth');

const SITE = 'https://afghanfollowers.online';
const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b/';

async function readRecord() {
  const r = await fetch(JSONBIN_BASE + BIN_ID + '/latest', { headers: { 'X-Master-Key': API_KEY } });
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

    // The response used to be reported to the client as soon as this fetch
    // resolved, without ever checking whether the write actually succeeded
    // — a transient failure writing to the database (JSONBin hiccup, an
    // unexpected auth rejection, anything writeBin() surfaces as
    // PUT_MAIN_FAILED) still returned "credited!" to the customer, whose
    // balance then never actually changed server-side. It looked exactly
    // like a real credit right up until their next fresh login pulled the
    // server's true, unchanged balance. Confirm the write actually landed
    // (with one retry for a transient blip) before telling the customer
    // it's real — this order hasn't been marked processed yet, so a retry
    // from here is safe and won't be rejected as a duplicate.
    async function writeCredit() {
      const r = await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({
          smm_users: [updatedUser],
          smm_paypal_processed: processed,
          smm_ts: Date.now()
        })
      });
      const j = await r.json().catch(() => null);
      return !!(j && j.ok === true);
    }
    let saved = await writeCredit();
    if (!saved) saved = await writeCredit();
    if (!saved) {
      return res.status(200).json({
        ok: false,
        error: 'Payment was verified with PayPal but could not be saved — please contact support with your PayPal receipt (Order: ' + orderId + ').'
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
            text: `✅ <b>PayPal Verified & Credited</b>\nUser: ${updatedUser.fname || updatedUser.email || userId}\nPaid: $${paidAmount.toFixed(2)}\nCredited: $${credit.toFixed(2)}\nNew Balance: $${newBalance.toFixed(2)}\nOrder: ${orderId}`
          })
        });
      }
    } catch (e) { /* best-effort */ }

    // transaction is returned so the client can add it straight into its
    // local copy of the user's history immediately — the balance patch
    // alone (see smm-panel.html's verifyPayPalOrder()) left Payment History
    // showing nothing for this deposit until the next full server sync.
    return res.status(200).json({ ok: true, credited: credit, newBalance: newBalance, transaction: newTx });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
