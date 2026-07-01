// Cross-device sync — Vercel Serverless Function
// NOTE: like the old Netlify version, this only persists in memory
// while the function instance is warm. For permanent storage,
// swap this out for a real database (Vercel KV, Supabase, JSONbin, etc).

let SHARED_DATA = { smm_users: [], smm_orders: [], smm_ts: 0 };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json(SHARED_DATA);
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.smm_users && Array.isArray(body.smm_users)) {
        if (body.smm_users.length >= (SHARED_DATA.smm_users || []).length) {
          SHARED_DATA.smm_users = body.smm_users;
        }
      }
      if (body.smm_orders && Array.isArray(body.smm_orders)) {
        if (body.smm_orders.length >= (SHARED_DATA.smm_orders || []).length) {
          SHARED_DATA.smm_orders = body.smm_orders;
        }
      }
      SHARED_DATA.smm_ts = Date.now();
      return res.status(200).json({ ok: true, users: SHARED_DATA.smm_users.length });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  return res.status(405).json({});
};
