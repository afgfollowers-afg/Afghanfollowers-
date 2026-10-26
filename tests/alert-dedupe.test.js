const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appendSystemAlert, ALERT_WINDOW_MS } = require('../api/_alert-dedupe');
const alert = { source: 'dispatch', message: 'Order #1 failed to dispatch: Service not found in catalog' };
test('repeat updates count without new entry or notification; unresolved dispatch incidents stay suppressed past 24 hours', () => {
  const first = appendSystemAlert([], alert, 1000);
  assert.equal(first.notify, true);
  const again = appendSystemAlert(first.entries, alert, 2000);
  assert.equal(again.notify, false);
  assert.equal(again.entries.length, 1);
  assert.equal(again.entries[0].count, 2);
  assert.equal(again.entries[0].ts, 1000);
  assert.equal(again.entries[0].lastSeenAt, 2000);
  assert.equal(appendSystemAlert(again.entries, alert, 1000 + ALERT_WINDOW_MS).notify, false);
});
test('different order, error, or source still notifies', () => {
  const { entries } = appendSystemAlert([], alert, 1000);
  for (const incoming of [
    { ...alert, message: alert.message.replace('#1', '#2') },
    { ...alert, message: 'Order #1 failed to dispatch: Provider config not found' },
    { ...alert, source: 'payment' }
  ]) assert.equal(appendSystemAlert(entries, incoming, 2000).notify, true);
});
test('existing legacy records suppress repeats after cold start', () => {
  const entries = JSON.parse(JSON.stringify([{ ...alert, ts: 1000, id: 'legacy' }]));
  const result = appendSystemAlert(entries, alert, 2000);
  assert.equal(result.notify, false);
  assert.equal(result.entries[0].count, 2);
  assert.equal(entries[0].count, undefined);
});
test('log stays bounded; missing or future timestamps cannot hide alerts', () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({ ...alert, message: String(i), ts: 1000 }));
  assert.equal(appendSystemAlert(entries, alert, 2000).entries.length, 200);
  assert.equal(appendSystemAlert([{ ...alert }], alert, 2000).notify, true);
  assert.equal(appendSystemAlert([{ ...alert, ts: 3000 }], alert, 2000).notify, true);
});


test('resolved incidents and changed dispatch configurations can notify again', () => {
  const first = appendSystemAlert([], { ...alert, details: { incident: 'config-1' } }, 1000);
  assert.equal(appendSystemAlert(first.entries, { ...alert, details: { incident: 'config-2' } }, 2000).notify, true);
  first.entries[0].resolvedAt = 1500;
  assert.equal(appendSystemAlert(first.entries, alert, 2000).notify, true);
  const generic = { source: 'payment', message: 'temporary problem' };
  const old = appendSystemAlert([], generic, 1000);
  assert.equal(appendSystemAlert(old.entries, generic, 1000 + ALERT_WINDOW_MS).notify, true);
});
