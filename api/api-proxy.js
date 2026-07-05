// Vercel Serverless Function — SMM Provider API Proxy
// Bypasses CORS restrictions for provider API calls

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://afghanfollowers.online');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { url, key, action, ...params } = body;

    if (!url || !key) {
      return res.status(400).json({ error: 'Missing url or key' });
    }

    const formData = new URLSearchParams();
    formData.append('key', key);
    formData.append('action', action || 'services');
    Object.keys(params).forEach(k => formData.append(k, params[k]));

    const response = await fetch(url, {
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
