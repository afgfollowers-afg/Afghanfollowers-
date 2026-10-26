const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../api/sync-orders.js'), 'utf8');
async function run(order, providers) {
  const calls = [], writes = [];
  const context = {
    module: { exports: {} }, process: { env: {} }, URLSearchParams,
    require: name => name === './_order-provider' ? require('../api/_order-provider') : {
      API_BASE: 'https://test.local', dbHeaders: () => ({}),
      fetchInternal: async (url, opts) => {
        if (opts && opts.method === 'POST') writes.push(JSON.parse(opts.body));
        return { ok: true, json: async () => opts && opts.method === 'POST' ? { ok: true } : ({ smm_orders: [order], smm_providers: providers }) };
      }
    },
    fetch: async (url) => {
      calls.push(url);
      return { text: async () => JSON.stringify({ status: 'Canceled' }) };
    }
  };
  vm.runInNewContext(source + '\nmodule.exports.runSyncTest = runOrderSyncJob;', context);
  const result = await context.module.exports.runSyncTest(false);
  return { calls, writes, result };
}
const providers = [{ id: 1, url: 'https://first.local', key: 'test' }, { id: 2, url: 'https://second.local', key: 'test' }];
test('missing and ambiguous providers never query a different panel or cancel an order', async () => {
  for (const provId of [99, undefined]) {
    const order = { id: 10, provOrderId: 123, provId, status: 'processing' };
    const result = await run(order, providers);
    assert.equal(result.calls.length, 0);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].smm_orders_sync.length, 0);
    assert.equal(result.writes[0].smm_refunds_reconcile, true);
    assert.equal(order.status, 'processing');
    assert.match(result.result.debugInfo[0].error, /Provider missing or ambiguous/);
  }
});
test('matched provider still synchronizes actual cancellations', async () => {
  const result = await run({ id: 10, provOrderId: 123, provId: '2', status: 'processing' }, providers);
  assert.deepEqual(result.calls, ['https://second.local']);
  assert.equal(result.writes[0].smm_orders_sync[0].status, 'cancelled');
});


test('a sweep with no active orders still reconciles historical refunds', async () => {
  const result = await run({ id: 10, provOrderId: 123, provId: 2, status: 'cancelled' }, providers);
  assert.equal(result.calls.length, 0);
  assert.equal(result.writes[0].smm_refunds_reconcile, true);
});
