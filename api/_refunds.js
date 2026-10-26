// Wallet refunds are issued only for persisted orders, using their stored
// owner and price. A stable ledger id makes repeat syncs and stale pushes safe.
const REFUND_STATUSES = ['cancelled', 'canceled', 'refunded'];
function settleRefunds(record, storedOrders, now = new Date().toISOString()) {
  const stored = new Map((storedOrders || []).filter(Boolean).map(o => [String(o.id), o]));
  const queue = record.smm_refund_notifications || [];
  for (const order of record.smm_orders || []) {
    if (!order || !REFUND_STATUSES.includes(String(order.status).toLowerCase())) continue;
    const original = stored.get(String(order.id));
    if (!original) continue; // never refund an order introduced in this request
    const user = (record.smm_users || []).find(u => u && String(u.id) === String(original.userId));
    const cost = Number(original.cost !== undefined ? original.cost : original.totalCost);
    if (!user || !Number.isFinite(cost) || cost <= 0) continue;
    const transactions = user.transactions || [];
    const previous = transactions.filter(t => {
      if (!t || t.type !== 'refund' || t.status === 'rejected' || t.status === 'pending') return false;
      // Older admin refunds recorded only a description, without orderId.
      const legacy = t.orderId == null && String(t.desc || '').match(/(?:order\s*#|#)([A-Za-z0-9_-]+)/i);
      const matches = String(t.orderId != null ? t.orderId : legacy && legacy[1]) === String(order.id);
      if (matches && t.orderId == null) t.orderId = original.id;
      return matches;
    });
    const paid = previous.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const amount = Number(Math.max(0, cost - paid).toFixed(4));
    if (!amount) continue;
    const id = 'refund-order-' + order.id;
    if (transactions.some(t => t && String(t.id) === id)) continue;
    user.balance = Number(((Number(user.balance) || 0) + amount).toFixed(4));
    user.transactions = [{ id, type: 'refund', orderId: original.id, amount,
      date: now, status: 'approved', desc: 'Order #' + original.id + ' cancelled — refunded to wallet' }].concat(transactions);
    // Persist the notification with the credit. Failed deliveries remain queued
    // and are retried on a later write without issuing another wallet credit.
    const text = '↩️ برگشت پول سفارش / Order refund\nسفارش / Order #' + original.id
      + '\nکاربر / User: ' + (user.fname || user.name || user.id)
      + '\nمبلغ / Amount: $' + amount.toFixed(4)
      + '\n✅ پول دوباره به موجودی حساب برگشت داده شد.\nRefunded to your wallet.';
    queue.push({ id: id, text });
  }
  record.smm_refund_notifications = queue;
}

async function deliverRefundNotifications(record, send = fetch) {
  // Refund notifications belong exclusively to the dedicated admin bot.
  // Resolve the same env/panel settings as system alerts; never fall back
  // to the main customer bot or to a queued customer's chat ID.
  const { resolveAdminBot } = require('./_dbkey');
  const { token, chatId } = await resolveAdminBot(record.smm_tg_bot || {});
  const delivered = [];
  if (!token || !chatId) return delivered;
  const groups = new Map();
  for (const item of record.smm_refund_notifications || []) {
    // Old releases queued one copy per main-bot/customer recipient. Collapse
    // those copies and acknowledge all of them after one admin-bot send.
    const eventId = String(item.id).split(':')[0];
    const group = groups.get(eventId) || { text: item.text, ids: [] };
    group.ids.push(item.id);
    groups.set(eventId, group);
  }
  await Promise.all(Array.from(groups.values()).slice(0, 10).map(async item => {
    try {
      const response = await send('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: item.text }),
        signal: AbortSignal.timeout(5000)
      });
      const result = await response.json();
      if (response.ok && result.ok) delivered.push(...item.ids);
    } catch (_) { /* keep queued; a Telegram failure must never undo a refund */ }
  }));
  return delivered;
}
module.exports = { settleRefunds, deliverRefundNotifications };
