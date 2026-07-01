// Vercel Serverless Function — Real persistent cross-device sync via JSONBin.io
// This replaces in-memory storage (which resets every few minutes and does NOT
// share data between devices/browsers) with a real, permanent JSON store.
//
// SETUP REQUIRED (one-time, ~2 minutes):
// 1. Go to https://jsonbin.io and create a free account
// 2. Create a new Bin, paste this as its initial content:
//    {"smm_users":[],"smm_orders":[],"smm_tickets":[],"smm_ts":0}
// 3. Copy the Bin ID (shown in the URL/dashboard) and your X-Master-Key (API key)
// 4. In Vercel: Project → Settings → Environment Variables, add:
//    JSONBIN_BIN_ID = your bin id
//    JSONBIN_API_KEY = your master key
// 5. Redeploy the project so the new env vars take effect

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const BASE = 'https://api.jsonbin.io/v3/b/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!BIN_ID || !API_KEY) {
    return res.status(500).json({
      error: 'Database not configured. Set JSONBIN_BIN_ID and JSONBIN_API_KEY in Vercel environment variables.'
    });
  }

  if (req.method === 'GET') {
    try {
      const r = await fetch(BASE + BIN_ID + '/latest', {
        headers: { 'X-Master-Key': API_KEY }
      });
      const j = await r.json();
      return res.status(200).json(j.record || { smm_users: [], smm_orders: [], smm_tickets: [], smm_ts: 0 });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Read current data first
      const r = await fetch(BASE + BIN_ID + '/latest', {
        headers: { 'X-Master-Key': API_KEY }
      });
      const j = await r.json();
      const current = j.record || { smm_users: [], smm_orders: [], smm_tickets: [], smm_ts: 0 };

      // Merge — keep the larger dataset for each field
      if (body.smm_users && Array.isArray(body.smm_users)) {
        if (body.smm_users.length >= (current.smm_users || []).length) {
          current.smm_users = body.smm_users;
        }
      }
      if (body.smm_orders && Array.isArray(body.smm_orders)) {
        if (body.smm_orders.length >= (current.smm_orders || []).length) {
          current.smm_orders = body.smm_orders;
        }
      }
      if (body.smm_tickets && Array.isArray(body.smm_tickets)) {
        if (body.smm_tickets.length >= (current.smm_tickets || []).length) {
          current.smm_tickets = body.smm_tickets;
        }
      }
      current.smm_ts = Date.now();

      // Write back
      await fetch(BASE + BIN_ID, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': API_KEY
        },
        body: JSON.stringify(current)
      });

      return res.status(200).json({ ok: true, users: current.smm_users.length, orders: current.smm_orders.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({});
};
