const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../api/_dbkey.js'), 'utf8');
function setup(saved, fail) {
  const sent = [];
  const context = {
    module: { exports: {} }, URL,
    process: { env: { ADMIN_BOT_TOKEN: 'test', ADMIN_BOT_CHAT_ID: 'test' } },
    require: () => ({}),
    fetch: async (url, opts) => {
      if (url.includes('api.telegram.org')) {
        sent.push(JSON.parse(opts.body));
        return { json: async () => ({ ok: true }) };
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
