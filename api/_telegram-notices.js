'use strict';
const { createHash, randomUUID } = require('crypto');
const { KV_ENABLED, kvClaim, kvRelease } = require('./_kv');
const recent = new Map();
function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function ticketEvent(ticket) {
  return 'ticket:' + String(ticket.id) + ':' + hash(JSON.stringify({
    subject:ticket.subject||ticket.title||'', message:ticket.message||ticket.msg||'',
    userMessages:(ticket.messages||[]).filter(m=>m.from==='user').map(m=>m.text||m.msg||''),
    delivery:ticket.providerDelivery||'', response:ticket.providerResponse||''
  }));
}
async function sendOnce({chatId,event,ttl=86400}, send) {
  const key='smm_telegram_notice_v1:'+hash(String(chatId)+':'+event);
  const owner=randomUUID();
  if(KV_ENABLED){
    const claim=await kvClaim(key,owner,ttl);
    if(!claim.ok)return {ok:false,error:'Notification reservation unavailable'};
    if(!claim.claimed)return {ok:true,duplicate:true};
  }else{
    const now=Date.now();
    for(const [k,until] of recent)if(until<=now)recent.delete(k);
    if(recent.has(key))return {ok:true,duplicate:true};
    if(recent.size>=2000)recent.delete(recent.keys().next().value);
    recent.set(key,now+ttl*1000);
  }
  try{
    const result=await send();
    // A definite Telegram rejection is safe to retry. Network timeouts
    // are ambiguous: retain the reservation to avoid replaying a sent message.
    if(result&&result.ok===false){
      if(KV_ENABLED)await kvRelease(key,owner);else recent.delete(key);
    }
    return result;
  }catch(e){return {ok:false,error:'Telegram delivery outcome unknown; not replayed automatically'};}
}
module.exports={sendOnce,ticketEvent,hash};
