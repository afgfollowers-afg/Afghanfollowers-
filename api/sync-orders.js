// Vercel Serverless Function — Auto-sync order status from providers
// Runs on a schedule (see vercel.json "crons"). For every order that was
// sent to a provider and isn't finished yet, asks the provider for its
// current status/remains and updates our database automatically.

const SITE = 'https://afghanfollowers.online';
const { dbHeaders } = require('./_dbkey');

module.exports = async (req, res) => {
  try {
    // 1. Get current data
    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const orders = db.smm_orders || [];
    const providers = db.smm_providers || [];
    const svcList = db.smm_svc || []; // compact array format: [id, svcId, fullDesc, category, provName, provId, cost, price, min, max, active]

    // 1b. Retry orders that were never actually sent to the provider (no provOrderId yet)
    const finishedStatuses = ['completed', 'canceled', 'cancelled', 'refunded'];
    const neverSent = orders.filter(o => !o.provOrderId && !finishedStatuses.includes(o.status));
    let retried = 0;
    const retryDebug = [];

    for (const o of neverSent) {
      // Find the matching service by name to get its provider numeric service id
      const svcRow = svcList.find(s => s[2] === o.svcName || s[2] === o.svc || s[3] === o.svcName);
      if (!svcRow) { retryDebug.push({ orderId: o.id, error: 'Service not found in catalog' }); continue; }
      const provNumericId = svcRow[1]; // provider's numeric service id
      const provId = svcRow[5];
      const prov = providers.find(p => String(p.id) === String(provId)) || providers[0];
      if (!prov || !prov.url || !prov.key) { retryDebug.push({ orderId: o.id, error: 'Provider config not found' }); continue; }

      try {
        const formData = new URLSearchParams();
        formData.append('key', prov.key);
        formData.append('action', 'add');
        formData.append('service', provNumericId);
        formData.append('link', o.link);
        formData.append('quantity', o.qty);

        const r = await fetch(prov.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        });
        const text = await r.text();
        let result;
        try { result = JSON.parse(text); } catch (e) {
          retryDebug.push({ orderId: o.id, error: 'Bad response', rawText: text.slice(0, 200) });
          continue;
        }
        if (result.order) {
          o.provOrderId = result.order;
          o.status = 'processing';
          retried++;
          retryDebug.push({ orderId: o.id, ok: true, newProvOrderId: result.order });
        } else {
          retryDebug.push({ orderId: o.id, error: result.error || 'No order id returned', rawResponse: result });
        }
      } catch (e) {
        retryDebug.push({ orderId: o.id, error: e.message });
      }
    }

    if (retried > 0) {
      await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_orders_sync: orders, smm_ts: Date.now() })
      });
    }

    // 2. Find orders that still need checking (sent to a provider, not finished)
    const finished = ['completed', 'canceled', 'cancelled', 'refunded'];
    const pending = orders.filter(o => o.provOrderId && !finished.includes(o.status));

    if (!pending.length) {
      return res.status(200).json({ ok: true, checked: 0, updated: 0, retried, retryDebug, message: 'No pending orders' });
    }

    // 3. Group pending orders by provider (matched via provId stored on the order, if present,
    //    otherwise fall back to trying every provider — most panels have one provider anyway)
    const byProvider = {};
    pending.forEach(o => {
      const key = o.provId || 'default';
      if (!byProvider[key]) byProvider[key] = [];
      byProvider[key].push(o);
    });

    let updated = 0;
    const idToOrder = {};
    orders.forEach(o => { idToOrder[o.id] = o; });
    const debugInfo = [];

    for (const provId of Object.keys(byProvider)) {
      let prov = providers.find(p => String(p.id) === String(provId));
      if (!prov) prov = providers[0]; // fallback to the only/first configured provider
      if (!prov || !prov.url || !prov.key) continue;

      const group = byProvider[provId];

      // Check each order individually — this provider does not reliably
      // support bulk/comma-separated status requests.
      for (const o of group) {
        try {
          const formData = new URLSearchParams();
          formData.append('key', prov.key);
          formData.append('action', 'status');
          formData.append('order', String(o.provOrderId));

          const r = await fetch(prov.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
          });
          const text = await r.text();
          let info;
          try { info = JSON.parse(text); } catch (e) {
            debugInfo.push({ orderId: o.id, provOrderId: o.provOrderId, error: 'JSON parse failed', rawText: text.slice(0, 200) });
            continue;
          }

          debugInfo.push({ orderId: o.id, provOrderId: o.provOrderId, rawResponse: info });

          if (!info || info.error) continue;

          let changed = false;
          if (info.status) {
            const mapped = mapStatus(info.status);
            if (mapped && mapped !== o.status) { o.status = mapped; changed = true; }
          }
          if (info.remains !== undefined) {
            const remainNum = parseInt(info.remains);
            if (!isNaN(remainNum) && remainNum !== o.remain) { o.remain = remainNum; changed = true; }
          }
          if (info.start_count !== undefined) {
            const startNum = parseInt(info.start_count);
            if (!isNaN(startNum) && startNum !== o.startCount) { o.startCount = startNum; changed = true; }
          }
          if (changed) updated++;
        } catch (e) {
          debugInfo.push({ orderId: o.id, provOrderId: o.provOrderId, error: e.message });
          continue;
        }
      }
    }

    // 4. Write updated orders back if anything changed
    if (updated > 0) {
      await fetch(SITE + '/api/db', {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ smm_orders_sync: orders, smm_ts: Date.now() })
      });
    }

    return res.status(200).json({ ok: true, checked: pending.length, updated, retried, retryDebug, debugInfo });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};

function mapStatus(providerStatus) {
  const s = String(providerStatus).toLowerCase();
  if (s.includes('complet')) return 'completed';
  if (s.includes('partial')) return 'partial';
  if (s.includes('in progress')) return 'in_progress';
  if (s.includes('process')) return 'processing';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('refund')) return 'refunded';
  if (s.includes('pending')) return 'pending';
  return null;
}
