const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../api/_dbkey.js'), 'utf8');
function setup(saved, fail, options = {}) {
  const sent = [];
  const context = {
    module: { exports: {} }, URL,
    process: { env: { ADMIN_BOT_TOKEN: 'test', ADMIN_BOT_CHAT_ID: 'test' } },
    require: name => name === 'crypto' ? require('crypto') : name === './_dispatch-errors' ? require('../api/_dispatch-errors') : name === './_kv' ? (options.kv || {}) : ({}),
    fetch: async (url, opts) => {
      if (url.includes('api.telegram.org')) {
        sent.push(JSON.parse(opts.body));
        return { json: async () => ({ ok: options.telegramOk !== false }) };
      }
      if (fail) throw new Error('database unavailable');
      return { ok: true, status: 200, json: async () => saved };
    }
  };
  vm.runInNewContext(source, context);
  return { log: context.module.exports.logSystemError, sent };
}
test('persisted duplicate suppresses Telegram', async () => {
  const app = setup({ ok: true, systemAlertNotify: false });
  await app.log('dispatch', 'same order');
  assert.equal(app.sent.length, 0);
});
test('new alerts, failed writes and unavailable DB retain Telegram delivery', async () => {
  for (const [saved, fail] of [
    [{ ok: true, systemAlertNotify: true }, false],
    [{ diag: 'PUT_MAIN_FAILED', systemAlertNotify: false }, false],
    [null, true]
  ]) {
    const app = setup(saved, fail);
    await app.log('dispatch', 'same order');
    assert.equal(app.sent.length, 1);
  }
});


test('overlapping dispatch alerts reserve one Telegram send across workers', async () => {
  const claims = new Map();
  const kv = { KV_ENABLED: true,
    kvClaim: async (key, owner) => {
      if (claims.has(key)) return { ok: true, claimed: false };
      claims.set(key, owner);
      return { ok: true, claimed: true };
    },
    kvRelease: async (key, owner) => { if (claims.get(key) === owner) claims.delete(key); }
  };
  const first = setup({ ok: true, systemAlertNotify: true }, false, { kv });
  const other = setup({ ok: true, systemAlertNotify: true }, false, { kv });
  await Promise.all([first.log('dispatch', 'Order #10: quantity too low', { incident: 'one', eventId: 'worker-1' }),
    other.log('dispatch', 'Order #10: quantity too low', { incident: 'one', eventId: 'worker-2' })]);
  assert.equal(first.sent.length + other.sent.length, 1);
});
test('failed Telegram sends release only their own reservation', async () => {
  let released = 0;
  const kv = { KV_ENABLED: true,
    kvClaim: async () => ({ ok: true, claimed: true }),
    kvRelease: async () => { released++; }
  };
  const app = setup({ ok: true, systemAlertNotify: true }, false, { kv, telegramOk: false });
  await app.log('dispatch', 'Order #11: failed');
  assert.equal(released, 1);
});
