// Vercel Serverless Function — Real persistent cross-device sync via JSONBin.io
// Uses TWO bins (JSONBin free plan caps each record at 100KB):
//  - Main bin (JSONBIN_BIN_ID): smm_users, smm_orders, smm_tickets
//  - Services bin (JSONBIN_SVC_BIN_ID): smm_svc, GZIP-COMPRESSED to fit the size limit
//
// Env vars needed: JSONBIN_BIN_ID, JSONBIN_SVC_BIN_ID, JSONBIN_API_KEY

const zlib = require('zlib');

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
    const out = Object.assign({}, main.record, { smm_svc: svc });
    return res.status(200).json(out);
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

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

      if (body.smm_users && Array.isArray(body.smm_users)) {
        if (body.smm_users.length >= (current.smm_users || []).length) current.smm_users = body.smm_users;
      }
      if (body.smm_orders && Array.isArray(body.smm_orders)) {
        if (body.smm_orders.length >= (current.smm_orders || []).length) current.smm_orders = body.smm_orders;
      }
      if (body.smm_tickets && Array.isArray(body.smm_tickets)) {
        if (body.smm_tickets.length >= (current.smm_tickets || []).length) current.smm_tickets = body.smm_tickets;
      }
      // Payment methods: admin is the single source of truth, always overwrite
      if (body.smm_pm && Array.isArray(body.smm_pm)) {
        current.smm_pm = body.smm_pm;
      }
      if (body.smm_providers && Array.isArray(body.smm_providers)) {
        current.smm_providers = body.smm_providers;
      }
      if (body.smm_orders_sync && Array.isArray(body.smm_orders_sync)) {
        // Used by the sync-orders cron job to write back updated order statuses
        current.smm_orders = body.smm_orders_sync;
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
