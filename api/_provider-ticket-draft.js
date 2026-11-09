'use strict';
function providerDraft(ticket, context, order) {
  const userMessages=Array.isArray(ticket.messages)?ticket.messages.filter(m=>m.from==='user'):[];
  const last=userMessages.length?userMessages[userMessages.length-1]:null;
  const message=String(last&&(last.text||last.msg)||ticket.message||ticket.msg||'').trim();
  const mapped=!!(context&&!context.missing&&context.providerId&&context.providerOrderId&&context.providerName&&context.providerName!=='Unknown provider');
  const kind=ticket.requestType==='cancellation'?'Cancellation request':ticket.requestType==='refill'?'Refill request':'Order support request';
  const providerOrderId=mapped?context.providerOrderId:'[ADD PROVIDER ORDER ID]';
  const rows=[
    'Subject: '+kind+' - Order #'+providerOrderId,
    '',
    'Hello Support,',
    'Please review the following request for your order.',
    'Order ID: '+providerOrderId
  ];
  if(context&&!context.missing){
    rows.push('Service: '+String(context.service||'—').slice(0,300));
    rows.push('Quantity: '+String(context.quantity));
  }
  if(mapped&&order&&order.link)rows.push('Order link: '+String(order.link).slice(0,500));
  rows.push('','Request:');
  rows.push(message.slice(0,2000)||'[ADD REQUEST DETAILS]');
  if(message.length>2000)rows.push('[Message shortened; full text is in the original ticket.]');
  rows.push('','Please investigate and let us know the result. Thank you.');
  return {ready:mapped&&!!message,text:rows.join('\n'),
    provider:mapped?context.providerName:'Unknown provider',
    reason:!mapped?'شماره سفارش پروایدر یا پروایدر مشخص نیست؛ قبل از ارسال تکمیل کنید.':!message?'متن درخواست خالی است؛ قبل از ارسال تکمیل کنید.':''};
}
module.exports={providerDraft};
