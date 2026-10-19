const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveOrderProvider } = require('../api/_order-provider');
const first = { id: 1 }, second = { id: 2 };
test('explicit missing provider never falls back to another provider', () => {
  assert.equal(resolveOrderProvider([first], 99), null);
  assert.equal(resolveOrderProvider([first, second], 99), null);
});
test('provider IDs match across string and numeric representations', () => {
  assert.equal(resolveOrderProvider([first, second], '2'), second);
  const zero = { id: 0 };
  assert.equal(resolveOrderProvider([first, zero], 0), zero);
});
test('legacy orders require exactly one provider', () => {
  for (const id of [undefined, null, '']) {
    assert.equal(resolveOrderProvider([], id), null);
    assert.equal(resolveOrderProvider([first], id), first);
    assert.equal(resolveOrderProvider([first, second], id), null);
  }
});
