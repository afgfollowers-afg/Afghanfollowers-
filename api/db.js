// Vercel Serverless Function — Real persistent cross-device sync via JSONBin.io
// Uses TWO separate bins because JSONBin's free plan caps each record at 100KB:
//  - Main bin (JSONBIN_BIN_ID): smm_users, smm_orders, smm_tickets (small, grows slowly)
//  - Services bin (JSONBIN_SVC_BIN_ID): smm_svc (can be large — 500 services ~ near/over 100KB)
//
// SETUP:
// 1. Bin #1 (already created): {"smm_users":[],"smm_orders":[],"smm_tickets":[],"smm_ts":0}
//    env vars: JSONBIN_BIN_ID, JSONBIN_API_KEY
// 2. Bin #2 (new): {"smm_svc":[]}
//    env var: JSONBIN_SVC_BIN_ID  (uses the same JSONBIN_API_KEY)

const BIN_ID = process.env.JSONBIN_BIN_ID;
const SVC_BIN_ID = process.env.JSONBIN_SVC_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const BASE = 'https://api.jsonbin.io/v3/b/';

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BIN_ID || !API_KEY) {
    return res.status(500).json({ error: 'Database not configured. Set JSONBIN_BIN_ID and JSONBIN_API_KEY.' });
  }

  if (req.method === 'GET') {
    const main = await readBin(BIN_ID);
    if (!main.ok) return res.status(200).json({ diag: 'GET_MAIN_FAILED', jsonbinStatus: main.status, jsonbinBodyRaw: main.raw });

    let svc = [];
    if (SVC_BIN_ID) {
      const svcResult = await readBin(SVC_BIN_ID);
      if (svcResult.ok) svc = svcResult.record.smm_svc || [];
      // if services bin fails, just return empty services rather than failing the whole request
    }
    const out = Object.assign({}, main.record, { smm_svc: svc });
    return res.status(200).json(out);
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Handle services separately (goes to the dedicated bin)
      if (body.smm_svc && Array.isArray(body.smm_svc)) {
        if (!SVC_BIN_ID) {
          return res.status(200).json({ diag: 'NO_SVC_BIN_CONFIGURED', error: 'Set JSONBIN_SVC_BIN_ID env var for a second bin dedicated to services.' });
        }
        const w = await writeBin(SVC_BIN_ID, { smm_svc: body.smm_svc });
        if (!w.ok) return res.status(200).json({ diag: 'PUT_SVC_FAILED', jsonbinStatus: w.status, jsonbinBodyRaw: w.raw });
        // If ONLY services were sent, we're done — no need to touch the main bin
        const onlyServices = !body.smm_users && !body.smm_orders && !body.smm_tickets;
        if (onlyServices) {
          return res.status(200).json({ ok: true, services: body.smm_svc.length });
        }
      }

      // Main bin: users / orders / tickets
      const main = await readBin(BIN_ID);
      if (!main.ok) return res.status(200).json({ diag: 'POST_READ_MAIN_FAILED', jsonbinStatus: main.status, jsonbinBodyRaw: main.raw });
      const current = main.record;

      if (body.smm_users && Array.isArray(body.smm_users)) {
        if (body.smm_users.length >= (current.smm_users || []).length) current.smm_users = body.smm_users;
      }
      if (body.smm_orders && Array.isArray(body.smm_orders)) {
        if (body.smm_orders.length >= (current.smm_orders || []).length) current.smm_orders = body.smm_orders;
      }
      if (body.smm_tickets && Array.isArray(body.smm_tickets)) {
        if (body.smm_tickets.length >= (current.smm_tickets || []).length) current.smm_tickets = body.smm_tickets;
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
