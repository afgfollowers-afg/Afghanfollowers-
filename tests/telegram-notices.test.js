const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helperSource=fs.readFileSync(path.join(__dirname,'../api/_telegram-notices.js'),'utf8');
function fixture(atomic=true){
  const reservations=new Map();
  const module={exports:{}};
  new Function('require','module',helperSource)(name=>name==='crypto'?require('node:crypto'):{
    KV_ENABLED:atomic,
    kvClaim:async(key,owner)=>{
      if(reservations.has(key))return{ok:true,claimed:false};
      reservations.set(key,owner);return{ok:true,claimed:true};
    },
    kvRelease:async(key,owner)=>{if(reservations.get(key)===owner)reservations.delete(key);}
  },module);
  return module.exports;
}
for(const atomic of [true,false]){
 test('suppress concurrent duplicate deliveries; retain new events/destinations ('+atomic+')',async()=>{
   const h=fixture(atomic);let sent=0;
   const send=async()=>{sent++;return{ok:true};};
   const results=await Promise.all([
     h.sendOnce({chatId:1,event:'ticket:1'},send),
     h.sendOnce({chatId:1,event:'ticket:1'},send)
   ]);
   assert.equal(sent,1);assert.equal(results.filter(r=>r.duplicate).length,1);
   await h.sendOnce({chatId:1,event:'ticket:2'},send);
   await h.sendOnce({chatId:2,event:'ticket:1'},send);
   assert.equal(sent,3);
 });
 test('retry explicit rejection but do not replay uncertain sends ('+atomic+')',async()=>{
   const h=fixture(atomic);let sent=0;
   await h.sendOnce({chatId:1,event:'rejected'},async()=>({ok:false}));
   await h.sendOnce({chatId:1,event:'rejected'},async()=>{sent++;return{ok:true};});
   assert.equal(sent,1);
   await h.sendOnce({chatId:1,event:'timeout'},async()=>{throw Error('timeout');});
   const next=await h.sendOnce({chatId:1,event:'timeout'},async()=>{sent++;return{ok:true};});
   assert.equal(next.duplicate,true);assert.equal(sent,1);
 });
}
test('new user reply/provider response notifies; admin status/reply does not replay alert',()=>{
 const h=fixture();
 const ticket={id:'T1',message:'Hi',status:'open',messages:[{from:'user',text:'Hi'}]};
 assert.equal(h.ticketEvent(ticket),h.ticketEvent({...ticket,status:'closed',messages:[...ticket.messages,{from:'admin',text:'Reply'}]}));
 assert.notEqual(h.ticketEvent(ticket),h.ticketEvent({...ticket,messages:[...ticket.messages,{from:'user',text:'Followup'}]}));
 assert.notEqual(h.ticketEvent(ticket),h.ticketEvent({...ticket,providerResponse:'Accepted'}));
});
