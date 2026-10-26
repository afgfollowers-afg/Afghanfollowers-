const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settleRefunds, deliverRefundNotifications } = require('../api/_refunds');

function fixture(status = 'cancelled') {
  return { smm_orders: [{ id: 10, userId: 1, cost: 2.1234, status }],
    smm_users: [{ id: 1, balance: 5, tgChatId: 123, transactions: [] }],
    smm_tg_bot: { token: 'test-token', chatId: 456 } };
}
test('cancelled/canceled/refunded orders credit their stored owner and cost once', () => {
  for (const status of ['cancelled', 'canceled', 'refunded']) {
    const db = fixture(status), stored = structuredClone(db.smm_orders);
    db.smm_orders[0].cost = 999;
    db.smm_orders[0].userId = 999;
    settleRefunds(db, stored);
    settleRefunds(db, stored);
    assert.equal(db.smm_users[0].balance, 7.1234);
    assert.equal(db.smm_users[0].transactions.length, 1);
    assert.equal(db.smm_users[0].transactions[0].orderId, 10);
    assert.equal(db.smm_refund_notifications.length, 2);
  }
});
test('historical refunds are retained and only any unpaid remainder is credited', () => {
  const db = fixture();
  db.smm_users[0].transactions = [{ id: 99, type: 'refund', amount: 1, orderId: '10', status: 'approved' }];
  settleRefunds(db, db.smm_orders);
  assert.equal(db.smm_users[0].balance, 6.1234);
  settleRefunds(db, db.smm_orders);
  assert.equal(db.smm_users[0].balance, 6.1234);
});
test('new, active, free and invalid-cost orders never issue refunds', () => {
  const db = fixture();
  settleRefunds(db, []);
  assert.equal(db.smm_users[0].balance, 5);
  for (const cost of [0, -1, 'invalid', Infinity]) {
    db.smm_orders[0].cost = cost;
    settleRefunds(db, db.smm_orders);
    assert.equal(db.smm_users[0].balance, 5);
  }
  const active = fixture('processing');
  settleRefunds(active, active.smm_orders);
  assert.equal(active.smm_users[0].balance, 5);
});
test('Telegram sends amount and order to admin and linked customer; failed sends stay pending', async () => {
  const db = fixture(), sent = [];
  settleRefunds(db, db.smm_orders);
  const delivered = await deliverRefundNotifications(db, async (_, opts) => {
    const message = JSON.parse(opts.body);
    sent.push(message);
    return { ok: true, json: async () => ({ ok: message.chat_id === '456' }) };
  });
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Order #10/);
  assert.match(sent[0].text, /2\.1234/);
  assert.equal(delivered.length, 1);
  assert.equal(db.smm_refund_notifications.length, 2);
  assert.deepEqual(await deliverRefundNotifications(db, async () => { throw Error('offline'); }), []);
  assert.equal(db.smm_users[0].balance, 7.1234);
});
