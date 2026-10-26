const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, money } = require('../refund-report');
const order = { id: 10, userId: 1, cost: 3, status: 'cancelled' };
function report(transactions, orders = [order]) { return buildReport([{ id: 1, transactions }], orders); }
test('compromised, unlinked and overcharged refund records cannot inflate verified totals', () => {
  const result = report([
    { id: 1, type: 'refund', amount: 1950000, status: 'approved' },
    { id: 2, type: 'refund', amount: 1950000, orderId: 10, status: 'approved' },
    { id: 3, type: 'refund', amount: 2, orderId: 10, status: 'approved' }
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.count, 1);
  assert.equal(result.issues.length, 2);
});
test('count is unique refunded orders; duplicate IDs are ignored and valid split refunds are combined', () => {
  const tx = { id: 1, type: 'refund', amount: '1.25', orderId: 10, status: 'approved' };
  const result = report([tx, tx, { id: 2, type: 'refund', amount: '.75', desc: 'Refund for order #10' }]);
  assert.equal(result.total, 2);
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].amount, 2);
});
test('multiple refunds cannot collectively exceed the original order price', () => {
  const result = report([1, 2].map(id => ({ id, type: 'refund', amount: 2, orderId: 10, status: 'approved' })));
  assert.equal(result.total, 0);
  assert.equal(result.count, 0);
  assert.equal(result.issues.length, 2);
});
test('only the matching customer and cancelled charged orders can contribute', () => {
  const tx = [{ id: 1, type: 'refund', amount: 1, orderId: 10, status: 'approved' }];
  for (const patch of [{ userId: 2 }, { status: 'processing' }, { cost: 0 }, { free: true }]) {
    assert.equal(report(tx, [Object.assign({}, order, patch)]).total, 0);
  }
  for (const status of ['pending', 'rejected', 'failed']) {
    assert.equal(report([Object.assign({}, tx[0], { status })]).total, 0);
  }
});
test('reports do not alter balances, transactions or customer records', () => {
  const users = [{ id: 1, balance: 9, transactions: [{ id: 1, type: 'refund', amount: 1950000 }] }];
  const before = JSON.stringify(users);
  buildReport(users, [order]);
  assert.equal(JSON.stringify(users), before);
  assert.equal(money(1234.5), '$1,234.5000');
});
