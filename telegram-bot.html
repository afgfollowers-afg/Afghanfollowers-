// Vercel Serverless Function — Telegram Bot webhook handler
const SITE = 'https://afghanfollowers.online';

async function lookupOrder(orderId) {
  try {
    const r = await fetch(SITE + '/api/db');
    const db = await r.json();
    const orders = db.smm_orders || [];
    return orders.find(o => String(o.id) === String(orderId)) || null;
  } catch (e) {
    return null;
  }
}

function statusEmoji(status) {
  var map = { completed: '✅', processing: '⏳', pending: '🕐', partial: '⚠️', cancelled: '❌', refunded: '💸' };
  return map[status] || '❔';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  const msg = body.message || body.edited_message;
  if (!msg) return res.status(200).send('ok');

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const firstName = (msg.from && msg.from.first_name) || 'User';

  const token = process.env.TG_BOT_TOKEN || req.query.token;
  if (!token) return res.status(200).send('no token');

  async function sendMsg(chat, txt) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: txt, parse_mode: 'HTML' })
    });
  }

  const lower = text.toLowerCase();
  let reply = '';

  // Order status lookup: "/order 12345" or just a bare number
  const orderMatch = text.match(/^\/order\s+(\d+)$/) || text.match(/^#?(\d{5,})$/);
  if (orderMatch) {
    const order = await lookupOrder(orderMatch[1]);
    if (order) {
      reply = `${statusEmoji(order.status)} <b>سفارش #${order.id}</b>\n\n`
        + `سرویس: ${order.service || order.svcName || '—'}\n`
        + `تعداد: ${order.qty || '—'}\n`
        + `وضعیت: <b>${order.status || 'pending'}</b>\n`
        + (order.startCount !== undefined ? `Start Count: ${order.startCount}\n` : '')
        + (order.remain !== undefined ? `باقیمانده: ${order.remain}\n` : '');
    } else {
      reply = `❌ سفارشی با این شماره پیدا نشد.\n\nبرای مشاهده سفارش‌هایتان وارد پنل شوید:\n${SITE}`;
    }
  } else if (text === '/start') {
    reply = `👋 سلام ${firstName}!\n\nبه پنل <b>Afghan Followers</b> خوش آمدید.\n\n🌐 سایت: ${SITE}\n\nبرای دریافت کمک از دستورات زیر استفاده کنید:\n/help - راهنما\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره] - وضعیت سفارش\n/support - پشتیبانی`;
  } else if (text === '/help' || lower.includes('help') || lower.includes('کمک')) {
    reply = `📋 <b>راهنما</b>\n\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره سفارش] - وضعیت سفارش\n/prices - قیمت‌ها\n/support - پشتیبانی\n\n💬 برای پشتیبانی با ادمین تماس بگیرید.`;
  } else if (text === '/panel') {
    reply = `🔗 <b>لینک پنل</b>\n\n${SITE}\n\nبرای ورود ثبت نام کنید یا لاگین کنید.`;
  } else if (text === '/services' || lower.includes('service') || lower.includes('سرویس')) {
    reply = `📦 <b>سرویس‌های ما</b>\n\n✅ Instagram Followers\n✅ TikTok Likes\n✅ YouTube Views\n✅ Telegram Members\n✅ Facebook Likes\n✅ Twitter Followers\n\n🌐 برای سفارش: ${SITE}`;
  } else if (lower.includes('order') || lower.includes('سفارش') || lower.includes('وضعیت') || lower.includes('فالور') || lower.includes('follower')) {
    reply = `📦 <b>پیگیری سفارش</b>\n\nبرای دیدن وضعیت سفارش، شماره سفارشتان را برایم بفرستید، مثلاً:\n<code>/order 12345</code>\n\nیا وارد پنل شوید:\n${SITE}`;
  } else if (text === '/support' || lower.includes('support') || lower.includes('پشتیبانی') || lower.includes('problem') || lower.includes('مشکل')) {
    reply = `🆘 <b>پشتیبانی</b>\n\nبرای رفع مشکل:\n1. وارد پنل شوید\n2. بخش Tickets را باز کنید\n3. تیکت جدید ارسال کنید\n\n🌐 ${SITE}\n\nادمین در اسرع وقت پاسخ می‌دهد.`;
  } else if (lower.includes('price') || lower.includes('قیمت') || lower.includes('cost') || lower.includes('هزینه')) {
    reply = `💰 <b>قیمت‌ها</b>\n\nقیمت‌ها بر اساس نوع سرویس متفاوت است.\n\n👉 برای مشاهده قیمت دقیق:\n${SITE}\n\nبخش Services را باز کنید.`;
  } else if (lower.includes('payment') || lower.includes('پرداخت') || lower.includes('pay')) {
    reply = `💳 <b>روش‌های پرداخت</b>\n\n✅ PayPal\n✅ Binance Pay\n✅ USDT (TRC20)\n✅ Hawala / Cash\n\n🌐 ${SITE}/smm-panel.html`;
  } else if (lower.includes('instagram') || lower.includes('insta')) {
    reply = `📸 <b>Instagram Services</b>\n\n✅ Real Followers\n✅ Likes\n✅ Views\n✅ Comments\n\n💰 از $0.001/unit\n🌐 ${SITE}`;
  } else if (lower.includes('tiktok')) {
    reply = `🎵 <b>TikTok Services</b>\n\n✅ Followers\n✅ Likes\n✅ Views\n✅ Comments\n\n💰 از $0.001/unit\n🌐 ${SITE}`;
  } else {
    reply = `👋 سلام ${firstName}!\n\nممنون از پیام شما.\n\nبرای کمک:\n/help - راهنما\n/order [شماره] - وضعیت سفارش\n/support - پشتیبانی\n\n🌐 ${SITE}`;
  }

  if (reply) {
    await sendMsg(chatId, reply);
  }

  return res.status(200).send('ok');
};
