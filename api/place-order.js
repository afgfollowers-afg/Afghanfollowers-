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
const { dbHeaders, DB_SERVICE_KEY } = require('./_dbkey');
const { dispatchOneOrder } = require('./sync-orders');

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

    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const order = (db.smm_orders || []).find((o) => String(o.id) === String(orderId));
    if (!order) {
      return res.status(200).json({ ok: false, error: 'Order not found' });
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
