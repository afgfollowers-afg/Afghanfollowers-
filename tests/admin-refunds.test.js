const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
const source = html.slice(html.indexOf('function getAdminRefundRows('), html.indexOf('// ═══ NAV ═══'));
test('admin refunds report lists actual credits, links legacy orders and filters safely', () => {
  const elements = { 'admin-refunds-tbl': {}, 'admin-rf-search': { value: '' }, 'admin-rf-total': {}, 'admin-rf-count': {} };
  const context = {
    document: { getElementById: id => elements[id] },
    getRealUsers: () => [{ id: 1, fname: '<script>name</script>', email: 'user@test.local', transactions: [
      { type: 'refund', amount: 2.1234, orderId: 10, date: '2026-01-02', status: 'approved' },
      { type: 'refund', amount: 1, desc: 'Refund for order #20', date: '2026-01-01' },
      { type: 'refund', amount: 999, status: 'pending' },
      { type: 'refund', amount: 999, status: 'rejected' },
      { type: 'deposit', amount: 999, status: 'approved' }
    ] }],
    escHtmlAdmin: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  };
  vm.runInNewContext(source, context);
  context.rRefunds();
  assert.equal(elements['admin-rf-total'].textContent, '$3.1234');
  assert.equal(elements['admin-rf-count'].textContent, 2);
  assert.match(elements['admin-refunds-tbl'].innerHTML, /#10/);
  assert.match(elements['admin-refunds-tbl'].innerHTML, /#20/);
  assert.doesNotMatch(elements['admin-refunds-tbl'].innerHTML, /<script>/);
  elements['admin-rf-search'].value = '20';
  context.rRefunds();
  assert.equal(elements['admin-rf-total'].textContent, '$1.0000');
  assert.equal(elements['admin-rf-count'].textContent, 1);
  elements['admin-rf-search'].value = 'missing-user';
  context.rRefunds();
  assert.equal(elements['admin-rf-total'].textContent, '$0.0000');
  assert.match(elements['admin-refunds-tbl'].innerHTML, /No refunds found/);
});
