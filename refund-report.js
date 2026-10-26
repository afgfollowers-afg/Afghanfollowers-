(function (root) {
  'use strict';
  function buildReport(users, orders) {
    var byId = new Map((orders || []).filter(Boolean).map(function (o) { return [String(o.id), o]; }));
    var groups = new Map(), issues = [], seen = new Set();
    (users || []).forEach(function (user) {
      (user.transactions || []).forEach(function (tx) {
        if (!tx || tx.type !== 'refund' || (tx.status && tx.status !== 'approved')) return;
        var key = String(user.id) + ':' + String(tx.id);
        if (tx.id != null && seen.has(key)) return;
        if (tx.id != null) seen.add(key);
        var legacy = String(tx.desc || '').match(/(?:order\s*#|#)([A-Za-z0-9_-]+)/i);
        var orderId = tx.orderId != null ? tx.orderId : legacy && legacy[1];
        var order = orderId != null ? byId.get(String(orderId)) : null;
        var amount = Number(tx.credit !== undefined ? tx.credit : tx.amount);
        var row = { userId: user.id, name: ((user.fname || user.name || '') + ' ' + (user.lname || '')).trim() || String(user.id),
          email: user.email || '', orderId: orderId != null ? orderId : '', amount: amount,
          date: tx.date || '', desc: tx.desc || '', transactionId: tx.id };
        function flag(reason) { issues.push(Object.assign({}, row, { reason: reason })); }
        if (!Number.isFinite(amount) || amount <= 0) return flag('Invalid refund amount');
        if (!order || String(order.userId) !== String(user.id)) return flag('No matching order for this customer');
        if (!['cancelled', 'canceled', 'refunded'].includes(String(order.status).toLowerCase())) return flag('Order is not cancelled or refunded');
        var cost = Number(order.cost !== undefined ? order.cost : order.totalCost);
        if (!Number.isFinite(cost) || cost <= 0 || order.free === true) return flag('Order has no refundable charge');
        if (amount > cost + 0.0001) return flag('Refund exceeds the order charge');
        var groupKey = String(user.id) + ':' + String(order.id);
        var group = groups.get(groupKey) || { row: row, units: 0, cost: cost, transactions: [] };
        group.units += Math.round(amount * 1000000);
        group.transactions.push(row);
        if ((Date.parse(row.date) || 0) > (Date.parse(group.row.date) || 0)) group.row = row;
        groups.set(groupKey, group);
      });
    });
    var rows = [];
    groups.forEach(function (group) {
      var amount = group.units / 1000000;
      if (amount > group.cost + 0.0001) {
        group.transactions.forEach(function (row) { issues.push(Object.assign({}, row, { reason: 'Combined refunds exceed the order charge' })); });
      } else rows.push(Object.assign({}, group.row, { amount: amount }));
    });
    rows.sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
    var total = rows.reduce(function (sum, row) { return sum + Math.round(row.amount * 1000000); }, 0) / 1000000;
    return { rows: rows, issues: issues, count: rows.length, total: total };
  }
  function money(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(amount);
  }
  var api = { buildReport: buildReport, money: money };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFRefunds = api;
})(typeof window !== 'undefined' ? window : globalThis);
