// Vercel Serverless Function — Auto-sync order status from providers
// Runs on a schedule (see vercel.json "crons"). For every order that was
// sent to a provider and isn't finished yet, asks the provider for its
// current status/remains and updates our database automatically.

const SITE = 'https://afghanfollowers.online';

module.exports = async (req, res) => {
  try {
    // 1. Get current data
    const dbResp = await fetch(SITE + '/api/db');
    const db = await dbResp.json();
    const orders = db.smm_orders || [];
    const providers = db.smm_providers || [];

    // 2. Find orders that still need checking (sent to a provider, not finished)
    const finished = ['completed', 'canceled', 'cancelled', 'refunded'];
    const pending = orders.filter(o => o.provOrderId && !finished.includes(o.status));

    if (!pending.length) {
      return res.status(200).json({ ok: true, checked: 0, updated: 0, message: 'No pending orders' });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smm_orders_sync: orders, smm_ts: Date.now() })
      });
    }

    return res.status(200).json({ ok: true, checked: pending.length, updated, debugInfo });
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
