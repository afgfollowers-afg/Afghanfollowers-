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

async function createTicket(chatId, username, message) {
  try {
    const r = await fetch(SITE + '/api/db');
    const db = await r.json();
    const tickets = db.smm_tickets || [];
    const ticket = {
      id: 'T' + Date.now(),
      userId: 'tg_' + chatId,
      user: username || ('Telegram User ' + chatId),
      email: '',
      tgChatId: chatId,
      subject: 'Telegram Support Request',
      message: message,
      msg: message,
      status: 'open',
      priority: 'normal',
      date: new Date().toISOString(),
      messages: [{ from: 'user', text: message, date: new Date().toLocaleString() }]
    };
    tickets.unshift(ticket);
    await fetch(SITE + '/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smm_tickets: tickets, smm_ts: Date.now() })
    });
    return ticket;
  } catch (e) {
    return null;
  }
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

  // Ticket creation: "/ticket <message>"
  const ticketMatch = text.match(/^\/ticket\s+([\s\S]+)$/i);
  if (ticketMatch) {
    const msgText = ticketMatch[1].trim();
    const username = (msg.from && (msg.from.username ? '@' + msg.from.username : msg.from.first_name)) || 'Telegram User';
    const ticket = await createTicket(chatId, username, msgText);
    if (ticket) {
      reply = `✅ <b>تیکت شما ثبت شد!</b>\n\nشماره تیکت: ${ticket.id}\n\nادمین در اسرع وقت پاسخ می‌دهد. برای پیگیری وارد پنل شوید:\n${SITE}`;
      const token = process.env.TG_BOT_TOKEN;
      if (token) {
        try {
          const cfg = await fetch(SITE + '/api/db').then(r => r.json());
          const adminChat = (cfg.smm_tg_bot && cfg.smm_tg_bot.chatId) || null;
          if (adminChat) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: adminChat, text: `🎫 <b>New Ticket ${ticket.id}</b>\nFrom: ${username}\nMessage: ${msgText.slice(0, 300)}`, parse_mode: 'HTML' })
            });
          }
        } catch (e) {}
      }
    } else {
      reply = '❌ خطا در ثبت تیکت. لطفاً دوباره امتحان کنید یا از پنل استفاده کنید.';
    }
  }
  // Order status lookup: "/order 12345" or just a bare number
  const orderMatch = !ticketMatch && (text.match(/^\/order\s+(\d+)$/) || text.match(/^#?(\d{5,})$/));
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
  } else if (ticketMatch) {
    // already handled above
  } else if (text === '/start') {
    reply = `👋 سلام ${firstName}!\n\nبه پنل <b>Afghan Followers</b> خوش آمدید.\n\n🌐 سایت: ${SITE}\n\nبرای دریافت کمک از دستورات زیر استفاده کنید:\n/help - راهنما\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره] - وضعیت سفارش\n/ticket [پیام] - باز کردن تیکت پشتیبانی\n/support - پشتیبانی`;
  } else if (text === '/help' || lower.includes('help') || lower.includes('کمک')) {
    reply = `📋 <b>راهنما</b>\n\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره سفارش] - وضعیت سفارش\n/ticket [پیام] - باز کردن تیکت پشتیبانی\n/prices - قیمت‌ها\n/support - پشتیبانی\n\n💬 برای پشتیبانی با ادمین تماس بگیرید.`;
  } else if (text === '/panel') {
    reply = `🔗 <b>لینک پنل</b>\n\n${SITE}\n\nبرای ورود ثبت نام کنید یا لاگین کنید.`;
  } else if (text === '/services' || lower.includes('service') || lower.includes('سرویس')) {
    reply = `📦 <b>سرویس‌های ما</b>\n\n✅ Instagram Followers\n✅ TikTok Likes\n✅ YouTube Views\n✅ Telegram Members\n✅ Facebook Likes\n✅ Twitter Followers\n\n🌐 برای سفارش: ${SITE}`;
  } else if (lower.includes('order') || lower.includes('سفارش') || lower.includes('وضعیت') || lower.includes('فالور') || lower.includes('follower')) {
    reply = `📦 <b>پیگیری سفارش</b>\n\nبرای دیدن وضعیت سفارش، شماره سفارشتان را برایم بفرستید، مثلاً:\n<code>/order 12345</code>\n\nیا وارد پنل شوید:\n${SITE}`;
  } else if (text === '/support' || lower.includes('support') || lower.includes('پشتیبانی') || lower.includes('problem') || lower.includes('مشکل')) {
    reply = `🆘 <b>پشتیبانی</b>\n\nبرای ثبت درخواست پشتیبانی، همینجا برایم بفرستید:\n<code>/ticket پیام شما</code>\n\nمثال:\n<code>/ticket مشکلی با سفارشم دارم</code>\n\nیا وارد پنل شوید و از بخش Tickets استفاده کنید:\n🌐 ${SITE}\n\nادمین در اسرع وقت پاسخ می‌دهد.`;
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
