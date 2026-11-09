'use strict';
const { publicTicket } = require('../ticket-order-context');
function createOrderSupport(deps) {
  return async function handle(auth, body) {
    if (!auth) return { status:401, body:{ok:false,error:'Login required'} };
    const kind=body.requestType;
    if (!['cancellation','refill'].includes(kind)) return {status:400,body:{ok:false,error:'Unsupported request type'}};
    const initial=await deps.read();
    if (!initial.ok) return {status:503,body:{ok:false,error:'Could not read orders'}};
    const order=(initial.record.smm_orders||[]).find(o=>String(o.id)===String(body.orderId)&&String(o.userId)===String(auth.sub));
    if (!order) return {status:403,body:{ok:false,error:'Order not found in your account'}};
    const user=(initial.record.smm_users||[]).find(u=>String(u.id)===String(auth.sub));
    if (!user||user.status==='suspended') return {status:403,body:{ok:false,error:'Active account required'}};
    if (kind==='cancellation'&&!['pending','processing','in_progress'].includes(order.status))
      return {status:409,body:{ok:false,error:'Order is not eligible for a cancellation request'}};
    if (kind==='refill'&&!['completed','partial'].includes(order.status))
      return {status:409,body:{ok:false,error:'Order is not eligible for a refill request'}};
    const id=(kind==='cancellation'?'OC':'OR')+String(order.id);
    const existing=(initial.record.smm_tickets||[]).find(t=>String(t.id)===id);
    if(existing)return {status:200,body:{ok:true,ticket:publicTicket(existing),duplicate:true}};
    const provider=(initial.record.smm_providers||[]).find(p=>order.provId!=null&&String(p.id)===String(order.provId));
    const capability=kind==='cancellation'?order.cancel===true:order.refill===true;
    const eligible=!!(order.provOrderId&&provider&&provider.url&&provider.key&&capability);
    const now=new Date().toISOString();
    const ticket={
      id,userId:user.id,user:[user.fname||user.name||'User',user.lname||''].filter(Boolean).join(' '),
      email:user.email||'',orderId:String(order.id),requestType:kind,status:'open',priority:'normal',date:now,
      subject:(kind==='cancellation'?'Cancellation request':'Refill request')+' - Order #'+order.id,
      message:String(body.message||'Please review this order request.').slice(0,2000),
      providerDelivery:'needs_review',
      messages:[]
    };
    ticket.msg=ticket.message;
    ticket.messages.push({from:'user',text:ticket.message,date:now});
    let lock=null, owner=String(Date.now())+'-'+Math.random().toString(36).slice(2);
    if(eligible&&deps.atomic){
      lock='smm_order_support_v1:'+String(provider.id)+':'+String(order.provOrderId)+':'+kind;
      const claim=await deps.claim(lock,owner);
      if(!claim.ok)return {status:503,body:{ok:false,error:'Could not reserve the provider request. Please try again.'}};
      if(!claim.claimed)return {status:409,body:{ok:false,error:'This request is already submitted or being processed. Check your tickets.'}};
      ticket.providerDelivery='sending';
    }
    // Persist before any external side effect. Never cancel/refund the order here.
    const persisted=await deps.read();
    if(!persisted.ok){
      if(lock)await deps.release(lock,owner);
      return {status:503,body:{ok:false,error:'Could not save ticket'}};
    }
    persisted.record.smm_tickets=[ticket].concat((persisted.record.smm_tickets||[]).filter(t=>String(t.id)!==id));
    persisted.record.smm_ts=Date.now();
    const saved=await deps.write(persisted.record);
    if(!saved.ok){
      if(lock)await deps.release(lock,owner);
      return {status:503,body:{ok:false,error:'Could not save ticket'}};
    }
    if(lock){
      try{
        const form=new URLSearchParams({key:provider.key,action:kind==='cancellation'?'cancel':'refill'});
        form.set(kind==='cancellation'?'orders':'order',String(order.provOrderId));
        const response=await deps.fetch(provider.url,{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),
          signal:AbortSignal.timeout(10000)
        });
        const data=await response.json();
        ticket.providerResponse=JSON.stringify(data).split(String(provider.key)).join('[redacted]').split(String(provider.url)).join('[provider]').slice(0,800);
        const item=Array.isArray(data)?data.find(x=>String(x.order)===String(order.provOrderId)):data;
        const accepted=response.ok&&item&&!item.error&&(
          kind==='cancellation'?(item.cancel===1||item.cancel==='1'||item.cancel===true):
          (typeof item.refill==='number'||typeof item.refill==='string')&&Number(item.refill)>0
        );
        ticket.providerDelivery=accepted?'accepted':'needs_review';
        if(accepted&&kind==='refill')ticket.providerRefillId=String(item.refill);
        ticket.providerNote=accepted?'Provider accepted the request; completion is not yet confirmed.':'Provider did not confirm this request. Admin review required.';
      }catch(e){
        // A timeout may mean the upstream accepted it. Keep the reservation;
        // never automatically replay an uncertain external operation.
        ticket.providerDelivery='unknown';
        ticket.providerNote='Provider outcome unknown. Admin must check before retrying.';
      }
    }else{
      ticket.providerNote=!eligible?'Provider/order mapping or request capability unavailable. Admin review required.':'Automatic delivery requires atomic request reservation. Admin review required.';
    }
    // Provider feedback is admin-only metadata, never a customer conversation message.
    const latest=await deps.read();
    if(latest.ok){
      latest.record.smm_tickets=(latest.record.smm_tickets||[]).filter(t=>String(t.id)!==id).concat([ticket]);
      latest.record.smm_ts=Date.now();
      const final=await deps.write(latest.record);
      if(!final.ok){
        if(deps.notify)await deps.notify(ticket.id).catch(()=>{});
        return {status:200,body:{ok:true,ticket:publicTicket(ticket),warning:'Request saved. Support will verify its outcome.'}};
      }
    }else return {status:200,body:{ok:true,ticket:publicTicket(ticket),warning:'Request saved. Support will verify its outcome.'}};
    if(deps.notify)await deps.notify(ticket.id).catch(()=>{});
    return {status:200,body:{ok:true,ticket:publicTicket(ticket)}};
  };
}
module.exports={createOrderSupport};
