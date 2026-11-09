(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketOrderContext = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function escape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function orderId(ticket) {
    if (ticket.orderId !== undefined && ticket.orderId !== null && String(ticket.orderId).trim()) return String(ticket.orderId).trim();
    var subject = String(ticket.subject || ticket.title || '').trim();
    if (/^#?\d+$/.test(subject)) return subject.replace(/^#/, '');
    var match = subject.match(/(?:\border\b|سفارش|اردر)\s*(?:شماره\s*)?[#:\-]?\s*(\d+)/i);
    return match ? match[1] : '';
  }
  function resolve(ticket, orders, providers, services) {
    var id = orderId(ticket);
    if (!id) return null;
    var order = (orders || []).find(function(o) { return String(o.id) === id; });
    if (order && ticket.userId != null && order.userId != null && String(ticket.userId) !== String(order.userId)) order = null;
    if (!order) return { orderId: id, missing: true };
    var providerId = order.provId;
    if (providerId == null || providerId === '') {
      var rows = (services || []).filter(function(s) {
        return s[2] === (order.svcName || order.service || order.svc);
      });
      if (rows.length === 1) providerId = rows[0][5];
    }
    var provider = (providers || []).find(function(p) { return providerId != null && String(p.id) === String(providerId); });
    return {
      orderId: id, providerId: providerId == null ? '' : String(providerId),
      providerName: provider ? (provider.name || provider.title || 'Unknown provider') : (order.provName || order.providerName || 'Unknown provider'),
      providerOrderId: order.provOrderId == null ? '' : String(order.provOrderId),
      service: order.svcName || order.service || order.svc || '—',
      quantity: order.qty == null ? '—' : order.qty, status: order.status || '—',
      delivery:ticket.providerDelivery||'', deliveryNote:ticket.providerNote||'', refillId:ticket.providerRefillId||'', response:ticket.providerResponse||''
    };
  }
  function lines(context) {
    if (!context) return [];
    if (context.missing) return [['Order / سفارش', '#' + context.orderId], ['Details / جزئیات', 'Order unavailable / سفارش در دسترس نیست']];
    return [
      ['Order / سفارش سایت', '#' + context.orderId],
      ['Provider / پروایدر', context.providerName + (context.providerId ? ' (ID: ' + context.providerId + ')' : '')],
      ['Provider order / سفارش پروایدر', context.providerOrderId || 'Not dispatched / هنوز ارسال نشده'],
      ['Service / سرویس', context.service],
      ['Quantity / تعداد', context.quantity],
      ['Status / وضعیت', context.status],
      ['Provider request / ارسال درخواست', context.delivery||'Not submitted / ارسال نشده'],
      ['Result / پاسخ', context.deliveryNote||'—'],
      ['Refill ID / شماره جبران', context.refillId||'—'],
      ['Provider response / پاسخ پروایدر (admin)', context.response||'—']
    ];
  }
  function html(context) {
    if (!context) return '';
    return '<div style="padding:12px;border:1px solid var(--bd,#343d57);border-radius:10px;margin:10px 0;font-size:12px;overflow-wrap:anywhere">' +
      lines(context).map(function(row) { return '<div><b>' + escape(row[0]) + ':</b> <span dir="auto">' + escape(row[1]) + '</span></div>'; }).join('') + '</div>';
  }
  function telegram(context) {
    return lines(context).map(function(row) { return escape(row[0]) + ': <b>' + escape(row[1]) + '</b>'; }).join('\n');
  }
  function publicTicket(ticket) {
    var clean=Object.assign({},ticket);
    ['providerDelivery','providerNote','providerResponse','providerRefillId'].forEach(function(key){delete clean[key];});
    return clean;
  }
  return { publicTicket:publicTicket, orderId: orderId, resolve: resolve, html: html, telegram: telegram, escape: escape };
});
