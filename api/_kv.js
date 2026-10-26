// Upstash Redis (REST) storage backend — a drop-in replacement for the
// JSONBin data layer (see api/db.js's readBin/writeBin).
//
// Why this exists: JSONBin's free tier caps total requests per month, and the
// panel exhausted it ("Requests exhausted", HTTP 403), which took the entire
// data layer offline — /api/db kept returning 200 while serving empty objects
// and silently dropping writes, so smm_admin_creds read as "not configured"
// and the admin was locked out, and no order/user/balance change persisted.
// Upstash's free tier is far larger (hundreds of thousands of commands a
// month) and its REST API needs no npm dependency — just fetch — so it slots
// in behind the same readBin()/writeBin() the rest of the code already calls,
// storing the two blobs the app uses (the main record + the gzip-compressed
// service catalog) under two fixed keys.
//
// Enabled only when BOTH env vars are present, so a deployment without them
// keeps using JSONBin exactly as before (strictly non-breaking):
//   UPSTASH_REDIS_REST_URL    e.g. https://xxxx-yyyy.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  the REST token from the Upstash console
const KV_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_ENABLED = !!(KV_URL && KV_TOKEN);

// Fixed keys for the two blobs (mirror JSONBin's two bins). Versioned so a
// future format change can migrate under a new key without clobbering the old.
const KV_MAIN_KEY = 'smm_main_v1';
const KV_SVC_KEY = 'smm_svc_v1';

// Upstash REST: GET /get/<key> -> {"result": "<stored string>" | null}
async function kvGet(key) {
  try {
    const r = await fetch(KV_URL + '/get/' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Cache-Control': 'no-cache' }
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, raw: text.slice(0, 300) };
    let j; try { j = JSON.parse(text); } catch (e) { return { ok: false, status: 502, raw: 'kv non-json response' }; }
    return { ok: true, value: (j && j.result !== undefined) ? j.result : null };
  } catch (e) { return { ok: false, status: 0, raw: e.message }; }
}

// Upstash REST: POST /set/<key> with the raw value as the request body ->
// {"result":"OK"}. Bodies well within Upstash's request-size limit for this
// app's data (the main blob is well under 1 MB; the service catalog is
// gzip-compressed before it ever reaches here).
async function kvSet(key, valueStr) {
  try {
    const r = await fetch(KV_URL + '/set/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KV_TOKEN },
      body: valueStr
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, raw: text.slice(0, 300) };
    return { ok: true };
  } catch (e) { return { ok: false, status: 0, raw: e.message }; }
}

// Separate expiring keys coordinate notification delivery across Vercel
// instances. NX is atomic; a read-then-write of the main blob is not.
async function kvClaim(key, owner, ttlSeconds) {
  try {
    const r = await fetch(KV_URL, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, owner, 'NX', 'EX', ttlSeconds])
    });
    const data = await r.json();
    if (!r.ok || data.error) return { ok: false };
    return { ok: true, claimed: data.result === 'OK' };
  } catch (_) { return { ok: false }; }
}
async function kvRelease(key, owner) {
  try {
    const script = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
    await fetch(KV_URL, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, 1, key, owner])
    });
  } catch (_) { /* a failed release expires naturally */ }
}

async function kvForget(key) {
  try {
    await fetch(KV_URL, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(['DEL', key])
    });
  } catch (_) { /* existing reservation expires naturally */ }
}

module.exports = { KV_ENABLED, KV_URL, kvGet, kvSet, kvClaim, kvRelease, kvForget, KV_MAIN_KEY, KV_SVC_KEY };

