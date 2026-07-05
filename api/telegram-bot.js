// Vercel Serverless Function — Telegram Bot webhook handler
const SITE = 'https://afghanfollowers.online';
const { dbHeaders } = require('./_dbkey');

async function lookupOrder(orderId) {
  try {
    const r = await fetch(SITE + '/api/db', { headers: dbHeaders() });
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
    const r = await fetch(SITE + '/api/db', { headers: dbHeaders() });
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
      headers: dbHeaders(),
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
          const cfg = await fetch(SITE + '/api/db', { headers: dbHeaders() }).then(r => r.json());
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
  } else if (lower.includes('ریزش') || lower.includes('drop') || lower.includes('unfollow') || lower.includes('کم میشه') || lower.includes('کم می‌شه')) {
    reply = `📉 <b>ریزش فالوور/لایک</b>\n\nمقداری ریزش طبیعیه (معمولاً کمتر از ۵٪) چون شبکه‌های اجتماعی مدام حساب‌های فیک رو پاک می‌کنن.\n\n✅ بعضی سرویس‌ها گارانتی "No Refill" یا "Refill 30/60/365 روزه" دارن — یعنی اگه ریزش داشت، رایگان جاش پر میشه.\n\nموقع سفارش، به توضیحات هر سرویس (مثلاً "30 Days Refill ♻️") دقت کنید.`;
  } else if (lower.includes('امن') || lower.includes('safe') || lower.includes('بن') || lower.includes('ban') || lower.includes('خطر')) {
    reply = `🔒 <b>امنیت حساب شما</b>\n\nما هیچ‌وقت پسورد یا اطلاعات ورود شما رو نمی‌خوایم. فقط لینک/یوزرنیم عمومی حسابتون کافیه.\n\nسرویس‌های ما به‌صورت تدریجی (Speed کنترل‌شده) تحویل داده میشن تا برای الگوریتم شبکه‌ی اجتماعی طبیعی به‌نظر برسه.\n\n⚠️ فقط باید حسابتون Public (عمومی) باشه، نه Private.`;
  } else if (lower.includes('خصوصی') || lower.includes('private')) {
    reply = `🔓 <b>حساب Private</b>\n\nمتأسفانه سرویس‌ها فقط روی حساب‌های **Public (عمومی)** کار می‌کنن.\n\nقبل از سفارش، حسابتون رو موقتاً Public کنید، بعد از تکمیل سفارش می‌تونید دوباره Private کنید.`;
  } else if (lower.includes('پسورد') || lower.includes('password') || lower.includes('رمز عبور حساب')) {
    reply = `🔑 <b>پسورد لازم نیست</b>\n\nما هیچ‌وقت پسورد اینستاگرام/تیک‌تاک/یوتیوب شما رو نمی‌خوایم!\n\nفقط لینک پست یا یوزرنیم عمومی حسابتون کافیه.`;
  } else if (lower.includes('چند وقت') || lower.includes('چقدر طول') || lower.includes('چه مدت') || lower.includes('how long') || lower.includes('delivery time')) {
    reply = `⏱ <b>زمان تحویل</b>\n\nاکثر سفارش‌ها ظرف چند دقیقه تا چند ساعت شروع میشن (Instant Start).\n\nسرعت کامل شدن بستگی به نوع سرویس داره — جزئیاتش (مثلاً "Day 100K 🚀") تو توضیحات هر سرویس نوشته شده.\n\nبرای پیگیری دقیق: <code>/order [شماره سفارش]</code>`;
  } else if (lower.includes('واقعی') || lower.includes('ربات') || lower.includes('real') || lower.includes('bot account') || lower.includes('فیک')) {
    reply = `👥 <b>فالوور واقعی یا ربات؟</b>\n\nما هر دو نوع سرویس داریم:\n✅ High Quality / Real Accounts — کیفیت بالاتر، ریزش کمتر، گرون‌تر\n✅ سرویس‌های اقتصادی — ارزون‌تر، مناسب افزایش عدد سریع\n\nتوضیحات هر سرویس (مثلاً "100% Real Accounts") دقیقاً مشخص می‌کنه چه نوعیه.`;
  } else if (lower.includes('حداقل') || lower.includes('حداکثر') || lower.includes('minimum') || lower.includes('maximum') || lower.includes('min order') || lower.includes('max order')) {
    reply = `🔢 <b>حداقل و حداکثر سفارش</b>\n\nهر سرویس محدودیت خودش رو داره (مثلاً حداقل ۱۰۰، حداکثر ۱ میلیون).\n\nاین اطلاعات موقع انتخاب سرویس تو پنل نمایش داده میشه.`;
  } else if (lower.includes('بازگشت وجه') || lower.includes('refund') || lower.includes('پس بگیرم') || lower.includes('پول برگرد')) {
    reply = `💸 <b>بازگشت وجه</b>\n\nاگه سفارشی ناقص یا انجام‌نشده باقی بمونه، مبلغش به کیف پول حسابتون برمی‌گرده یا سفارش جایگزین می‌گیرید.\n\nبرای درخواست بازگشت وجه، لطفاً تیکت بزنید:\n<code>/ticket توضیح مشکل شما</code>`;
  } else if (lower.includes('گارانتی') || lower.includes('warranty') || lower.includes('guarantee')) {
    reply = `✅ <b>گارانتی سرویس‌ها</b>\n\nبیشتر سرویس‌ها گارانتی Refill دارن (۳۰/۶۰/۹۰/۳۶۵ روزه یا مادام‌العمر ♻️) — یعنی اگه ریزش کرد، رایگان جبران میشه.\n\nنوع گارانتی هر سرویس تو توضیحاتش مشخصه.`;
  } else if (lower.includes('یوتیوب') || lower.includes('youtube')) {
    reply = `▶️ <b>YouTube Services</b>\n\n✅ Views\n✅ Likes\n✅ Subscribers\n✅ Comments\n\n🌐 ${SITE}`;
  } else if (lower.includes('فیسبوک') || lower.includes('facebook')) {
    reply = `👍 <b>Facebook Services</b>\n\n✅ Page/Profile Followers\n✅ Post Likes & Reactions\n✅ Comments\n\n🌐 ${SITE}`;
  } else if (lower.includes('توییتر') || lower.includes('تویتر') || lower.includes('twitter') || lower.includes(' x ')) {
    reply = `🐦 <b>Twitter/X Services</b>\n\n✅ Followers\n✅ Tweet Views\n✅ Likes & Retweets\n\n🌐 ${SITE}`;
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
