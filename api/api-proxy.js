// Vercel Serverless Function — SMM Provider API Proxy
// Bypasses CORS restrictions for provider API calls. Only ever called from
// admin.html (testing/managing provider accounts) — gated with the same
// shared key every other first-party/admin-only endpoint requires, since it
// was previously a fully open relay to any URL with any key.
const { DB_SERVICE_KEY, dbHeaders, API_BASE, fetchInternal } = require('./_dbkey');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://afghanfollowers.online');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-db-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { url, key, action, providerId, ...params } = body;

    // GET /api/db strips smm_providers[].key from every browser response
    // (see api/db.js) — an admin browser that never had a provider's real
    // key locally (any device other than the one it was entered on) could
    // never actually use "Load Services" / "Check Balance", even after
    // providers themselves started syncing across devices. providerId lets
    // the caller ask this server to resolve the real url+key itself, via
    // the same internal service token dispatchOneOrder() already uses —
    // deliberately ignoring any client-supplied url/key in that case, so a
    // forged url can never redirect a real key to somewhere else.
    let resolvedUrl = url, resolvedKey = key;
    if (providerId) {
      const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
      const db = await dbResp.json();
      const prov = (db.smm_providers || []).find((p) => String(p.id) === String(providerId));
      if (!prov || !prov.url || !prov.key) {
        return res.status(200).json({ error: 'Provider config not found' });
      }
      resolvedUrl = prov.url;
      resolvedKey = prov.key;
    }

    if (!resolvedUrl || !resolvedKey) {
      return res.status(400).json({ error: 'Missing url or key' });
    }

    const formData = new URLSearchParams();
    formData.append('key', resolvedKey);
    formData.append('action', action || 'services');
    Object.keys(params).forEach(k => formData.append(k, params[k]));

    const response = await fetch(resolvedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(200).json({ error: 'Invalid JSON from provider', raw: text.slice(0, 500) });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
