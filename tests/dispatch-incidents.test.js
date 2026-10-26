const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const helpers = require('../api/_dispatch-errors');
const source = fs.readFileSync(path.join(__dirname, '../api/sync-orders.js'), 'utf8');
const snapshot = { providers: [{ id: 1, url: 'https://provider.test', key: 'test' }], svcList: [] };
function setup(state = { order: { id: 10, userId: 1, svcId: 5, provId: 1, qty: 10, status: 'pending' }, logs: [] }) {
  let result = { ok: false, error: 'Quantity less than minimal 100' };
  let attempts = 0;
  const writes = [];
  const context = {
    module: { exports: {} }, process: { env: {} }, URLSearchParams,
    nextResult: () => { attempts++; return structuredClone(result); },
    require: name => {
      if (name === './_dispatch-errors') return helpers;
      if (name === './_order-provider') return require('../api/_order-provider');
      return {
        API_BASE: 'https://panel.test', dbHeaders: () => ({}),
        logSystemError: async (...args) => state.logs.push(args),
        fetchInternal: async (_, opts) => {
          if (opts && opts.method === 'POST') {
            const body = JSON.parse(opts.body);
            writes.push(body);
            if (body.smm_orders) Object.assign(state.order, body.smm_orders[0]);
            return { ok: true, json: async () => ({ ok: true }) };
          }
          return { ok: true, json: async () => ({ smm_orders: [structuredClone(state.order)] }) };
        }
      };
    }
  };
  vm.runInNewContext(source + '\ndispatchOneOrderCore = async () => nextResult();', context);
  return { state, writes, get attempts() { return attempts; },
    result(value) { result = value; },
    dispatch(config = snapshot, opts) { return context.module.exports.dispatchOneOrder(structuredClone(state.order), config, opts); } };
}
test('permanent catalog/config/quantity errors do not retry or alert on every sweep or cold start', async () => {
  for (const error of ['Service not found in catalog', 'Provider config not found', 'Quantity less than minimal 100']) {
    const app = setup();
    app.result({ ok: false, error });
    await app.dispatch();
    assert.equal(app.state.order.dispatchFailure.permanent, true);
    assert.equal((await app.dispatch()).blocked, true);
    const cold = setup(app.state);
    assert.equal((await cold.dispatch()).blocked, true);
    assert.equal(cold.attempts, 0);
    assert.equal(app.attempts, 1);
    assert.equal(app.state.logs.length, 1);
  }
});
test('manual retry does not repeat an unchanged alert; changing relevant configuration retries and alerts', async () => {
  const app = setup();
  await app.dispatch();
  await app.dispatch(snapshot, { force: true });
  assert.equal(app.attempts, 2);
  assert.equal(app.state.logs.length, 1);
  const changed = structuredClone(snapshot);
  changed.providers[0].key = 'new-config';
  await app.dispatch(changed);
  assert.equal(app.attempts, 3);
  assert.equal(app.state.logs.length, 2);
});
test('transient errors keep retrying while the same unresolved failure sends only one alert', async () => {
  const app = setup();
  app.result({ ok: false, error: 'Provider temporarily unavailable' });
  await app.dispatch();
  await app.dispatch();
  assert.equal(app.attempts, 2);
  assert.equal(app.state.order.dispatchFailure.permanent, false);
  assert.equal(app.state.logs.length, 1);
  app.result({ ok: true, provOrderId: 123 });
  await app.dispatch();
  assert.equal(app.state.order.dispatchFailure, null);
  assert.equal(app.writes.at(-1).smm_error_log_resolve.orderId, 10);
});
test('unrelated provider changes and balance refreshes do not restart permanent incidents', () => {
  const order = { id: 10, svcId: 5, provId: 1, qty: 10 };
  const changed = structuredClone(snapshot);
  changed.providers[0].balance = 20;
  changed.providers.push({ id: 2, url: 'https://other.test', key: 'other' });
  assert.equal(helpers.dispatchFingerprint(order, snapshot), helpers.dispatchFingerprint(order, changed));
  assert.notEqual(helpers.dispatchFingerprint(order, snapshot), helpers.dispatchFingerprint({ ...order, qty: 100 }, snapshot));
});
