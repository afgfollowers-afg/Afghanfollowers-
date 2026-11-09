const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../api/_order-support');
async function scenario(kind, opts={}){
 let record={smm_users:[{id:8,fname:"User"}],smm_orders:[{id:42,userId:8,provId:2,provOrderId:777,cancel:true,refill:true,status:kind==="refill"?"completed":"processing"}],smm_providers:[{id:2,key:"secret",url:"https://provider.test"}],smm_tickets:[]};
 let calls=0,writes=0,claimed=false;
 const deps={atomic:opts.atomic!==false,read:async()=>({ok:true,record:JSON.parse(JSON.stringify(record))}),write:async data=>{writes++;if(opts.writeFail)return{ok:false};record=JSON.parse(JSON.stringify(data));return{ok:true};},claim:async()=>{if(claimed)return{ok:true,claimed:false};claimed=true;return{ok:true,claimed:true};},release:async()=>{claimed=false;},
 fetch:async(url,init)=>{calls++;const params=new URLSearchParams(init.body);if(params.get("key")!=="secret"||params.get(kind==="refill"?"order":"orders")!=="777")throw Error("invalid form");if(opts.timeout)throw Error("timeout");return{ok:true,json:async()=>opts.reject?{error:"Rejected"}:kind==="refill"?{refill:123}:[{order:777,cancel:1}]};}};
 if(opts.providerMissing)record.smm_orders[0].provId=99;
 const handler=service.createOrderSupport(deps);
 const first=await handler({sub:opts.otherUser?9:8},{requestType:kind,orderId:42,message:"Please"});
 const second=opts.repeat?await handler({sub:8},{requestType:kind,orderId:42}):null;
 return{first,second,calls,writes,record};
}
test('cancel and refill use the mapped upstream order once', async()=>{
 for(const kind of ['cancellation','refill']){
   const x=await scenario(kind,{repeat:true});
   assert.equal(x.record.smm_tickets[0].providerDelivery,'accepted');
   assert.equal(x.calls,1); assert.equal(x.second.body.duplicate,true);
 }
});
test('wrong user, wrong provider, no atomic store and failed persistence never call upstream',async()=>{
 for(const options of [{otherUser:true},{providerMissing:true},{atomic:false},{writeFail:true}]){
   const x=await scenario('cancellation',options);assert.equal(x.calls,0);
 }
});
test('timeout/rejection are not marked accepted or replayed',async()=>{
 for(const options of [{timeout:true},{reject:true}]){
   const x=await scenario('cancellation',{...options,repeat:true});
   assert.notEqual(x.first.body.ticket.providerDelivery,'accepted');assert.equal(x.calls,1);
 }
});
test('provider acceptance leaves order status and balance untouched',async()=>{
 const x=await scenario('cancellation');assert.equal(x.record.smm_orders[0].status,'processing');
 assert.equal(x.record.smm_users[0].balance,undefined);
});

test('provider feedback is retained for admin but never returned as customer messages or fields',async()=>{
 const x=await scenario('cancellation');
 assert.ok(x.record.smm_tickets[0].providerResponse);
 for(const key of ['providerResponse','providerNote','providerDelivery','providerRefillId'])assert.equal(x.first.body.ticket[key],undefined);
 assert.equal(x.first.body.ticket.messages.some(m=>m.from==='admin'),false);
});
