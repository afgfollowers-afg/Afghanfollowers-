const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const refunds = require('../api/_refunds');
const source = fs.readFileSync(path.join(__dirname, '../api/db.js'), 'utf8');
function app({ failWrite = false, failTelegram = false } = {}) {
  let record = {
    smm_orders: [{ id: 10, userId: 1, cost: 2.1234, status: 'pending', cancel: true }],
    smm_users: [{ id: 1, balance: 5, transactions: [], tgChatId: 123 }],
    smm_tg_bot: { token: 'test-token', chatId: 456 }, smm_ts: 1
  };
  const sent = [];
  const fakeFetch = async (url, opts = {}) => {
    if (url.includes('api.telegram.org')) {
      sent.push(JSON.parse(opts.body));
      return { ok: !failTelegram, json: async () => ({ ok: !failTelegram }) };
    }
    if (url.includes('/test-services/')) return { ok: true, text: async () => JSON.stringify({ record: { smm_svc: [[1, 100, 'Test service', 'Test', 'Test provider', 1, 1, 2, 1, 10000, true]] } }) };
    if (opts.method === 'PUT') {
      if (!failWrite) record = JSON.parse(opts.body);
      return { ok: !failWrite, status: failWrite ? 500 : 200, text: async () => '{}' };
    }
    return { ok: true, text: async () => JSON.stringify({ record }) };
  };
  const context = {
    module: { exports: {} }, Buffer, console,
    process: { env: { JSONBIN_BIN_ID: 'test', JSONBIN_SVC_BIN_ID: 'test-services', JSONBIN_API_KEY: 'test' } },
    fetch: fakeFetch,
    require: name => {
      if (name === './_auth') return { AUTH_CONFIGURED: true, getAuth: req => req.auth, diagnoseAuth: () => ({}) };
      if (name === './_kv') return { KV_ENABLED: false };
      if (name === './_dbkey') return {};
      if (name === './_refunds') return { settleRefunds: refunds.settleRefunds,
        deliverRefundNotifications: r => refunds.deliverRefundNotifications(r, fakeFetch) };
      return require(name.startsWith('.') ? path.join(__dirname, '../api', name) : name);
    }
  };
  vm.runInNewContext(source, context);
  return {
    sent, get record() { return record; },
    async request(body, auth = { sub: 1, role: 'user' }, method = 'POST') {
      let output, status;
      const res = { setHeader() {}, status(code) { status = code; return this; }, json(data) { output = data; } };
      await context.module.exports({ method, body, headers: {}, query: { nosvc: '1' }, auth }, res);
      return { status, body: output };
    }
  };
}
test('customer cancellation persists credit and sends Telegram once across repeated requests', async () => {
  const api = app();
  const first = await api.request({ action: 'cancel_order', orderId: 10 });
  assert.equal(first.body.ok, true);
  assert.equal(api.record.smm_users[0].balance, 7.1234);
  assert.equal(api.record.smm_orders[0].status, 'cancelled');
  assert.equal(api.sent.length, 2);
  await api.request({ action: 'cancel_order', orderId: '10' });
  assert.equal(api.record.smm_users[0].balance, 7.1234);
  assert.equal(api.record.smm_users[0].transactions.length, 1);
  assert.equal(api.sent.length, 2);
});
test('provider sync and admin status patches issue the same server-side refund', async () => {
  for (const body of [
    { smm_orders_sync: [{ id: 10, status: 'canceled', cost: 999, userId: 999 }] },
    { smm_orders: [{ id: 10, status: 'refunded' }] }
  ]) {
    const api = app();
    assert.equal((await api.request(body, { sub: 'service', role: 'admin' })).body.ok, true);
    assert.equal(api.record.smm_users[0].balance, 7.1234);
    assert.equal(api.record.smm_orders[0].userId, 1);
    assert.equal(api.record.smm_orders[0].cost, 2.1234);
  }
});
test('forged customer refunds, syncs and other-user cancellations never credit money', async () => {
  const api = app();
  await api.request({ smm_users: [{ id: 1, balance: 999, transactions: [{ id: 99, type: 'refund', orderId: 10, amount: 999 }] }],
    smm_orders_sync: [{ id: 10, status: 'cancelled' }] });
  assert.equal(api.record.smm_users[0].balance, 5);
  assert.equal(api.record.smm_orders[0].status, 'pending');
  assert.equal((await api.request({ action: 'cancel_order', orderId: 10 }, { sub: 2, role: 'user' })).status, 403);
  assert.equal((await api.request({ action: 'cancel_order', orderId: 10 }, null)).status, 401);
  assert.equal(api.sent.length, 0);
});
test('a failed persistence never claims a refund or sends a Telegram confirmation', async () => {
  const api = app({ failWrite: true });
  const result = await api.request({ action: 'cancel_order', orderId: 10 });
  assert.equal(result.body.ok, undefined);
  assert.equal(result.body.diag, 'PUT_MAIN_FAILED');
  assert.equal(api.record.smm_users[0].balance, 5);
  assert.equal(api.sent.length, 0);
});
test('Telegram failure leaves the refund credited and notifications queued', async () => {
  const api = app({ failTelegram: true });
  assert.equal((await api.request({ action: 'cancel_order', orderId: 10 })).body.ok, true);
  assert.equal(api.record.smm_users[0].balance, 7.1234);
  assert.equal(api.record.smm_refund_notifications.length, 2);
  const view = await api.request(null, { sub: 1, role: 'user' }, 'GET');
  assert.equal(view.body.smm_refund_notifications, undefined);
});
test('dispatched and completed orders cannot be cancelled by a customer', async () => {
  for (const patch of [{ provOrderId: 123 }, { dispatchAttemptedAt: Date.now() }, { status: 'completed' }]) {
    const api = app();
    Object.assign(api.record.smm_orders[0], patch);
    assert.equal((await api.request({ action: 'cancel_order', orderId: 10 })).status, 409);
    assert.equal(api.record.smm_users[0].balance, 5);
  }
});
test('historical admin refund descriptions are linked without crediting a second time', async () => {
  const api = app();
  api.record.smm_orders[0].status = 'refunded';
  api.record.smm_users[0].transactions = [{ id: 99, type: 'refund', amount: 2.1234,
    desc: 'Refund for order #10', status: 'approved' }];
  await api.request({ smm_refunds_reconcile: true }, { sub: 'service', role: 'admin' });
  assert.equal(api.record.smm_users[0].balance, 5);
  assert.equal(api.record.smm_users[0].transactions[0].orderId, 10);
  assert.equal(api.sent.length, 0);
});

test('new paid orders require a matching accepted debit before they can later be refunded', async () => {
  const order = { id: 20, userId: 1, svcId: 100, provId: 1, cost: 2, qty: 1000, status: 'pending', cancel: true };
  const unpaid = app();
  await unpaid.request({ smm_orders: [order] });
  assert.equal(unpaid.record.smm_orders.length, 1);
  const paid = app();
  await paid.request({ smm_orders: [order], smm_users: [{ id: 1, transactions: [
    { id: 101, type: 'spend', amount: 2, status: 'approved' }
  ] }] });
  assert.equal(paid.record.smm_orders.length, 2);
  assert.equal(paid.record.smm_users[0].balance, 3);
  assert.equal((await paid.request({ action: 'cancel_order', orderId: 20 })).body.ok, true);
  assert.equal(paid.record.smm_users[0].balance, 5);
});

test('admin refund action rejects expired/customer sessions and works for an admin', async () => {
  const api = app();
  for (const auth of [null, { sub: 1, role: 'user' }]) {
    assert.equal((await api.request({ action: 'refund_order', orderId: 10 }, auth)).status, 403);
    assert.equal(api.record.smm_users[0].balance, 5);
  }
  assert.equal((await api.request({ action: 'refund_order', orderId: 10 }, { sub: 'admin', role: 'admin' })).body.ok, true);
  assert.equal(api.record.smm_users[0].balance, 7.1234);
});
