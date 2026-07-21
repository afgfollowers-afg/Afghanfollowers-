// Vercel Serverless Function — Dispatch one order to its SMM provider.
//
// Previously accepted {providerUrl, apiKey, service, link, quantity} straight
// from the client, with no auth check at all — an open relay that also
// forced every browser (smm-panel.html's own order-placement code included)
// to hold the provider's real API key locally to call it. Now takes just an
// {orderId}, requires the same shared key every other first-party endpoint
// uses, and resolves the order + provider entirely server-side via
// sync-orders.js's dispatchOneOrder() — the provider's URL/key never leave
// the server. Dispatch still happens immediately (not on the next cron);
// this is the on-demand counterpart to that file's daily retry sweep.
const { dbHeaders, DB_SERVICE_KEY, API_BASE, fetchInternal } = require('./_dbkey');
const { dispatchOneOrder } = require('./sync-orders');
const { getAuth, AUTH_CONFIGURED } = require('./_auth');

const SITE = 'https://afghanfollowers.online';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-db-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = body.orderId;
    if (orderId === undefined || orderId === null) {
      return res.status(200).json({ ok: false, error: 'Missing orderId' });
    }

    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const order = (db.smm_orders || []).find((o) => String(o.id) === String(orderId));
    if (!order) {
      return res.status(200).json({ ok: false, error: 'Order not found' });
    }

    // The shared x-db-key alone isn't ownership — it's a constant baked
    // into every public page's source, so without this check any visitor
    // could force-dispatch (force:true below skips the normal cooldown)
    // an order belonging to a different customer just by guessing/
    // enumerating an orderId (these are Date.now() timestamps). Admin
    // callers (approveFreeLikes()) and the internal service token both
    // need to dispatch orders they don't personally "own", so only a
    // plain customer token is restricted to its own orders.
    if (AUTH_CONFIGURED) {
      const auth = getAuth(req);
      const isInternalOrAdmin = !!(auth && auth.role === 'admin');
      if (!isInternalOrAdmin && (!auth || String(order.userId) !== String(auth.sub))) {
        return res.status(200).json({ ok: false, error: 'Not authorized to dispatch this order' });
      }
    }

    const result = await dispatchOneOrder(
      order,
      { providers: db.smm_providers || [], svcList: db.smm_svc || [] },
      { force: true }
    );
    return res.status(200).json(Object.assign({ order: result.provOrderId }, result));
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
