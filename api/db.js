// Vercel Serverless Function — Real persistent cross-device sync via JSONBin.io
// DIAGNOSTIC VERSION — surfaces real JSONBin errors instead of silently
// falling back to empty defaults, so we can pinpoint config issues.

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
      error: 'Database not configured. Set JSONBIN_BIN_ID and JSONBIN_API_KEY in Vercel environment variables.',
      binIdSet: !!BIN_ID,
      apiKeySet: !!API_KEY
    });
  }

  if (req.method === 'GET') {
    try {
      const r = await fetch(BASE + BIN_ID + '/latest', {
        headers: { 'X-Master-Key': API_KEY }
      });
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch (parseErr) {
        return res.status(200).json({
          diag: 'GET_PARSE_FAILED',
          jsonbinStatus: r.status,
          jsonbinBodyRaw: text.slice(0, 500)
        });
      }
      if (!r.ok || !j.record) {
        return res.status(200).json({
          diag: 'GET_NOT_OK_OR_NO_RECORD',
          jsonbinStatus: r.status,
          jsonbinResponse: j
        });
      }
      return res.status(200).json(j.record);
    } catch (e) {
      return res.status(200).json({ diag: 'GET_EXCEPTION', error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Read current data first
      const r = await fetch(BASE + BIN_ID + '/latest', {
        headers: { 'X-Master-Key': API_KEY }
      });
      const readText = await r.text();
      let j;
      try { j = JSON.parse(readText); } catch (e) { j = {}; }
      if (!r.ok || !j.record) {
        return res.status(200).json({
          diag: 'POST_READ_FAILED',
          jsonbinStatus: r.status,
          jsonbinResponse: j,
          jsonbinBodyRaw: readText.slice(0, 500)
        });
      }
      const current = j.record;

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
      // Services: admin is the single source of truth, always overwrite with latest push
      if (body.smm_svc && Array.isArray(body.smm_svc)) {
        current.smm_svc = body.smm_svc;
      }
      current.smm_ts = Date.now();

      // Write back
      const putResp = await fetch(BASE + BIN_ID, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': API_KEY
        },
        body: JSON.stringify(current)
      });
      const putText = await putResp.text();

      if (!putResp.ok) {
        return res.status(200).json({
          diag: 'PUT_FAILED',
          jsonbinStatus: putResp.status,
          jsonbinBodyRaw: putText.slice(0, 500)
        });
      }

      return res.status(200).json({
        ok: true,
        users: (current.smm_users || []).length,
        orders: (current.smm_orders || []).length,
        services: (current.smm_svc || []).length,
        ts: current.smm_ts
      });
    } catch (e) {
      return res.status(200).json({ diag: 'POST_EXCEPTION', error: e.message });
    }
  }

  return res.status(405).json({});
};
