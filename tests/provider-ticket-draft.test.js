const {test}=require('node:test');
const assert=require('node:assert/strict');
const {providerDraft}=require('../api/_provider-ticket-draft');
const context={orderId:'42',providerId:'2',providerName:'Supplier',providerOrderId:'777',service:'Views',quantity:100, response:'INTERNAL RESPONSE'};
test('external draft uses provider order ID, latest user message and no internal feedback/identity',()=>{
 const draft=providerDraft({id:'T1',requestType:'cancellation',email:'private@example.com',messages:[{from:'user',text:'Old'},{from:'admin',text:'Private reply'},{from:'user',text:'Please cancel'}]},context,{link:'https://social.test/post'});
 assert.equal(draft.ready,true);
 assert.match(draft.text,/Order ID: 777/);
 assert.match(draft.text,/Please cancel/);
 assert.equal(draft.text.includes('INTERNAL RESPONSE'),false);
 assert.equal(draft.text.includes('private@example.com'),false);
 assert.equal(draft.text.includes('Private reply'),false);
 assert.equal(draft.text.includes('Order ID: 42'),false);
});
test('no order mapping generates an explicit incomplete template without guessing',()=>{
 for(const c of [null,{orderId:'42',missing:true},{...context,providerOrderId:''},{...context,providerName:'Unknown provider'}]){
  const draft=providerDraft({message:'Help'},c);
  assert.equal(draft.ready,false);
  assert.match(draft.text,/\[ADD PROVIDER ORDER ID\]/);
 }
});
test('general/refill tickets get their own subjects; empty request needs review',()=>{
 assert.match(providerDraft({message:'Help'},context).text,/Order support request/);
 assert.match(providerDraft({message:'Dropped',requestType:'refill'},context).text,/Refill request/);
 assert.equal(providerDraft({},context).ready,false);
});
