const assert = require('node:assert/strict');
const test = require('node:test');
const C = require('../ticket-order-context');
test('ticket IDs are not order IDs; explicit and legacy references resolve', () => {
  assert.equal(C.orderId({id:'T1780000000000',subject:'General support'}), '');
  assert.equal(C.orderId({subject:'Cancel Request - Order #42'}), '42');
  assert.equal(C.orderId({subject:'سفارش #42'}), '42');
  assert.equal(C.orderId({orderId:7,subject:'Order #42'}), '7');
});
test('provider identity is matched strictly; upstream order ID stays separate', () => {
  const context=C.resolve({orderId:42,userId:8},[{id:42,userId:8,provId:2,provOrderId:777,svcName:'Views',qty:100}],
    [{id:1,name:'Wrong'},{id:2,name:'Correct',key:'secret',url:'secret-url'}]);
  assert.equal(context.providerName,'Correct');
  assert.equal(context.orderId,'42');
  assert.equal(context.providerOrderId,'777');
  assert.equal(C.telegram(context).includes('secret'),false);
  assert.equal(C.html(context).includes('777'),true);
  assert.equal(C.resolve({orderId:42},[{id:42,provId:99}],[{id:1,name:'Wrong'}]).providerName,'Unknown provider');
});
test('missing and other-customer orders do not disclose details', () => {
  const context=C.resolve({orderId:42,userId:8},[{id:42,userId:9,svcName:'private'}],[]);
  assert.equal(context.missing,true);
  assert.equal(C.telegram(context).includes('private'),false);
});
test('escaping and legacy catalog matching do not guess ambiguous providers', () => {
  assert.equal(C.html({orderId:'<script>',missing:true}).includes('<script>'),false);
  const order={id:42,svcName:'Views'};
  assert.equal(C.resolve({orderId:42},[order],[{id:2,name:'Correct'}],[[0,3,'Views','cat','P',2]]).providerName,'Correct');
  assert.equal(C.resolve({orderId:42},[order],[{id:2,name:'Wrong'}],[[0,3,'Views','cat','P',2],[1,4,'Views','cat','Q',3]]).providerName,'Unknown provider');
});
