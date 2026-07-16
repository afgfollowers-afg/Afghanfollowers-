// Vercel Serverless Function — Telegram Bot webhook handler
const SITE = 'https://afghanfollowers.online';
const { dbHeaders, API_BASE } = require('./_dbkey');

async function lookupOrder(orderId) {
  try {
    const r = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
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

// Best-effort ping to the admin's personal chat (same bot, different chat id
// — configured once in Settings → Integrations, stored as smm_tg_bot.chatId).
async function notifyAdmin(token, text) {
  try {
    const cfg = await fetch(API_BASE + '/api/db', { headers: dbHeaders() }).then(r => r.json());
    const adminChat = (cfg.smm_tg_bot && cfg.smm_tg_bot.chatId) || null;
    if (!adminChat) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: adminChat, text: text, parse_mode: 'HTML' })
    });
  } catch (e) { /* best-effort — must not break the customer's reply */ }
}

// Links a panel account to this Telegram chat so admin-approved Free Likes
// rewards (including the visit-based "invite 100 → 50 visits" path) can
// message the user directly. `code` is the user's own referral code
// (id.toString(36).toUpperCase()) — reused as the link token so no extra
// per-user secret needs generating.
async function linkTelegramAccount(code, chatId) {
  try {
    const r = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await r.json();
    const users = db.smm_users || [];
    const user = users.find(u => u.id && Number(u.id).toString(36).toUpperCase() === code);
    if (!user) return false;
    user.tgChatId = chatId;
    await fetch(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_users: users, smm_ts: Date.now() })
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function createTicket(chatId, username, message) {
  try {
    const r = await fetch(API_BASE + '/api/db', { headers: dbHeaders() });
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
    await fetch(API_BASE + '/api/db', {
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

  // Reply in English only when the message has real Latin-alphabet words
  // beyond a bare "/command" or a number, and no Persian/Arabic script —
  // otherwise "/start" or "/order 12345" (no language content at all) would
  // misfire as English for the site's mostly Persian/Dari-speaking audience.
  const textForLangCheck = text.replace(/^\/[a-zA-Z]+\s*/, '');
  const isEnglish = /[a-zA-Z]{2,}/.test(textForLangCheck) && !/[؀-ۿ]/.test(text);

  // Account linking: "/start LINK_<refCode>" (deep link from the panel's
  // Free Likes "Connect Telegram" button) — must run before the generic
  // "/start" greeting below, since this is a more specific match on the
  // same command.
  const linkMatch = text.match(/^\/start\s+LINK_([A-Z0-9]+)$/i);
  if (linkMatch) {
    const linked = await linkTelegramAccount(linkMatch[1].toUpperCase(), chatId);
    const reply2 = linked
      ? (isEnglish
          ? `✅ <b>Telegram connected!</b>\n\nYou'll get a message right here as soon as your Free Likes reward is approved.`
          : `✅ <b>تلگرام شما وصل شد!</b>\n\nهر وقت جایزه‌ی لایک رایگانتان تایید شود، همین‌جا بهتان خبر می‌دهیم.`)
      : (isEnglish
          ? `❌ Couldn't find a matching account for this link. Please open "Connect Telegram" from your own Free Likes page in the panel and try again.`
          : `❌ حسابی مطابق با این لینک پیدا نشد. لطفاً از داخل صفحه‌ی Free Likes خودتان در پنل، روی «اتصال تلگرام» بزنید و دوباره امتحان کنید.`);
    await sendMsg(chatId, reply2);
    return res.status(200).send('ok');
  }

  // Ticket creation: "/ticket <message>"
  const ticketMatch = text.match(/^\/ticket\s+([\s\S]+)$/i);
  if (ticketMatch) {
    const msgText = ticketMatch[1].trim();
    const username = (msg.from && (msg.from.username ? '@' + msg.from.username : msg.from.first_name)) || 'Telegram User';
    const ticket = await createTicket(chatId, username, msgText);
    if (ticket) {
      reply = isEnglish
        ? `✅ <b>Your ticket has been submitted!</b>\n\nTicket ID: ${ticket.id}\n\nAdmin will reply as soon as possible. Track it in the panel:\n${SITE}`
        : `✅ <b>تیکت شما ثبت شد!</b>\n\nشماره تیکت: ${ticket.id}\n\nادمین در اسرع وقت پاسخ می‌دهد. برای پیگیری وارد پنل شوید:\n${SITE}`;
      if (token) await notifyAdmin(token, `🎫 <b>New Ticket ${ticket.id}</b>\nFrom: ${username}\nMessage: ${msgText.slice(0, 300)}`);
    } else {
      reply = isEnglish
        ? '❌ Error submitting the ticket. Please try again or use the panel.'
        : '❌ خطا در ثبت تیکت. لطفاً دوباره امتحان کنید یا از پنل استفاده کنید.';
    }
  }
  // Order status lookup: "/order 12345" or just a bare number
  const orderMatch = !ticketMatch && (text.match(/^\/order\s+(\d+)$/) || text.match(/^#?(\d{5,})$/));
  if (orderMatch) {
    const order = await lookupOrder(orderMatch[1]);
    if (order) {
      reply = isEnglish
        ? `${statusEmoji(order.status)} <b>Order #${order.id}</b>\n\n`
          + `Service: ${order.service || order.svcName || '—'}\n`
          + `Quantity: ${order.qty || '—'}\n`
          + `Status: <b>${order.status || 'pending'}</b>\n`
          + (order.startCount !== undefined ? `Start Count: ${order.startCount}\n` : '')
          + (order.remain !== undefined ? `Remaining: ${order.remain}\n` : '')
        : `${statusEmoji(order.status)} <b>سفارش #${order.id}</b>\n\n`
          + `سرویس: ${order.service || order.svcName || '—'}\n`
          + `تعداد: ${order.qty || '—'}\n`
          + `وضعیت: <b>${order.status || 'pending'}</b>\n`
          + (order.startCount !== undefined ? `Start Count: ${order.startCount}\n` : '')
          + (order.remain !== undefined ? `باقیمانده: ${order.remain}\n` : '');
    } else {
      reply = isEnglish
        ? `❌ No order found with that number.\n\nView your orders in the panel:\n${SITE}`
        : `❌ سفارشی با این شماره پیدا نشد.\n\nبرای مشاهده سفارش‌هایتان وارد پنل شوید:\n${SITE}`;
    }
  } else if (ticketMatch) {
    // already handled above
  } else if (text === '/start') {
    reply = isEnglish
      ? `👋 Hi ${firstName}!\n\nWelcome to the <b>Afghan Followers</b> panel.\n\n🌐 Site: ${SITE}\n\nUseful commands:\n/help - help\n/panel - open the panel\n/services - service list\n/order [number] - order status\n/ticket [message] - open a support ticket\n/support - support\n\n🎁 Tip: ask me "free likes" to find out how to get free likes just by inviting friends.`
      : `👋 سلام ${firstName}!\n\nبه پنل <b>Afghan Followers</b> خوش آمدید.\n\n🌐 سایت: ${SITE}\n\nبرای دریافت کمک از دستورات زیر استفاده کنید:\n/help - راهنما\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره] - وضعیت سفارش\n/ticket [پیام] - باز کردن تیکت پشتیبانی\n/support - پشتیبانی\n\n🎁 نکته: بپرس «لایک رایگان» تا بگم چطور فقط با دعوت دوستات لایک رایگان بگیری.`;
  } else if (/^(سلام|درود|hi|hello|hey)[\s!.]*$/i.test(text)) {
    reply = isEnglish
      ? `👋 Hey ${firstName}, welcome!\n\nAsk me anything about buying followers, likes, views or members — pricing, payment, account safety, whatever's on your mind 😊\n\nOr just send /services to see what we offer.`
      : `👋 سلام ${firstName} جان، خوش اومدی!\n\nهر سوالی درباره‌ی خرید فالوور، لایک، ویو یا ممبر داری بپرس — قیمت، پرداخت، امنیت حساب، هرچی ذهنتو مشغول کرده 😊\n\nیا مستقیم /services رو بزن ببین چی داریم.`;
  } else if (lower.includes('لایک رایگان') || lower.includes('فری لایک') || lower.includes('رایگان') || lower.includes('دعوت') || lower.includes('معرفی دوست') || lower.includes('free like') || lower.includes('free follow') || lower.includes('invite') || lower.includes('referral') || lower.includes('refer a friend')) {
    reply = isEnglish
      ? `🎁 <b>Free Likes — Invite & Earn</b>\n\nInvite 5 friends who actually sign up (or send your link to 10 people and get 10 verified visits) and claim free Instagram or TikTok likes!\n\nHow it works:\n1️⃣ Open "Free Likes" in the panel and copy your referral link\n2️⃣ Share it — friends must genuinely register (or just visit, for the 10-visit path)\n3️⃣ Once you qualify, pick Instagram or TikTok, enter your link, and submit your claim\n4️⃣ An admin verifies it, then your free likes go out — max once a day\n\n💡 Tip: connect your Telegram from that same page to get pinged the moment it's approved.\n\n🌐 ${SITE}/smm-panel.html → Free Likes`
      : `🎁 <b>لایک رایگان — دعوت کن، جایزه بگیر</b>\n\nبا دعوت ۵ دوست که واقعاً ثبت‌نام کنن (یا لینکتو به ۱۰ نفر بفرستی و ۱۰ بازدید تایید‌شده بگیری) می‌تونی لایک رایگان اینستاگرام یا تیک‌تاک بگیری!\n\nمراحل:\n۱️⃣ از پنل، بخش «Free Likes» رو باز کن و لینک اختصاصی‌تو کپی کن\n۲️⃣ لینک رو با دوستات به اشتراک بذار — باید واقعاً ثبت‌نام کنن (یا فقط بازدید کنن، برای مسیر ۱۰ بازدید)\n۳️⃣ وقتی شرایط رو داشتی، اینستاگرام یا تیک‌تاک رو انتخاب کن، لینکتو وارد کن و درخواست بده\n۴️⃣ بعد از تایید ادمین، لایک رایگان برات ارسال میشه — حداکثر یک‌بار در روز\n\n💡 نکته: از همون صفحه می‌تونی تلگرامتو وصل کنی تا لحظه‌ی تایید، همینجا خبردار بشی.\n\n🌐 ${SITE}/smm-panel.html → Free Likes`;
  } else if (lower.includes('کدام سرویس') || lower.includes('کدوم سرویس') || lower.includes('چی بگیرم') || lower.includes('پیشنهاد') || lower.includes('which service') || lower.includes('recommend')) {
    reply = isEnglish
      ? `🤔 <b>Which service is right for me?</b>\n\nDepends on your goal:\n📈 Fast, cheap number growth → economy services\n💎 High quality, low drop (for a business/brand page) → High Quality / Real Accounts\n\nTell me which platform and what you're going for, and I'll guide you 🙂`
      : `🤔 <b>کدوم سرویس مناسبمه؟</b>\n\nبستگی داره هدفت چیه:\n📈 فقط افزایش عدد سریع و ارزون‌تر → سرویس‌های اقتصادی\n💎 کیفیت بالا و ریزش کم (برای صفحه بیزینسی/برند) → High Quality / Real Accounts\n\nبگو دقیقاً برای کدوم پلتفرم و چه هدفی می‌خوای، راهنماییت می‌کنم 🙂`;
  } else if (lower.includes('ثبت نام') || lower.includes('ثبت‌نام') || lower.includes('register') || lower.includes('sign up') || lower.includes('signup')) {
    reply = isEnglish
      ? `📝 <b>Sign up</b>\n\nOpen the panel and register with your email or phone — free, takes a minute:\n${SITE}/auth.html\n\nThen you can add funds and order right away. Ask me anything else too 🙌`
      : `📝 <b>ثبت‌نام</b>\n\nاز لینک پنل وارد شو و با ایمیل یا شماره‌ات ثبت‌نام کن، رایگانه و یک دقیقه طول می‌کشه:\n${SITE}/auth.html\n\nبعدش می‌تونی مستقیم شارژ کنی و سفارش بدی. سوال دیگه‌ای هم داشتی بپرس 🙌`;
  } else if (lower.includes('شارژ') || lower.includes('افزایش موجودی') || lower.includes('add funds') || lower.includes('topup') || lower.includes('top up')) {
    reply = isEnglish
      ? `💰 <b>Adding funds</b>\n\nOpen "Add Funds" in the panel, pick a payment method (PayPal, Binance, USDT, or Hawala) and enter the amount.\n\nWith PayPal the amount is credited instantly and automatically — no admin approval needed.\n\n🌐 ${SITE}/smm-panel.html`
      : `💰 <b>افزایش موجودی</b>\n\nاز پنل وارد بخش «Add Funds» شو، روش پرداخت (PayPal، Binance، USDT یا حواله) رو انتخاب کن و مبلغ دلخواهتو بریز.\n\nبا PayPal مبلغ فوری و خودکار به حسابت اضافه میشه، نیازی به تایید ادمین نیست.\n\n🌐 ${SITE}/smm-panel.html`;
  } else if (lower.includes('تخفیف') || lower.includes('discount') || lower.includes('عمده') || lower.includes('wholesale') || lower.includes('bulk')) {
    reply = isEnglish
      ? `🎁 <b>Discounts & bulk orders</b>\n\nBigger orders are already more cost-effective since pricing is tiered.\n\nIf you need high volume (multiple accounts/projects), tell me exactly what you need:\n<code>/ticket I need a bulk order for ...</code>`
      : `🎁 <b>تخفیف و خرید عمده</b>\n\nهرچی سفارشت بزرگ‌تر باشه صرفه اقتصادی‌ترش هم بیشتره چون قیمت‌ها پلکانی‌ان.\n\nاگه حجم بالا (چند اکانت/چند پروژه) لازم داری، دقیقاً بگو چی مدنظرته:\n<code>/ticket نیاز به خرید عمده دارم برای ...</code>`;
  } else if (lower.includes('کی جواب') || lower.includes('کی میاید') || lower.includes('response time')) {
    reply = isEnglish
      ? `⏱ <b>Response time</b>\n\nUsually within a few minutes to a few hours. For faster follow-up, open a ticket:\n<code>/ticket your message</code>\n\nOr just keep asking here — happy to help.`
      : `⏱ <b>زمان پاسخ‌گویی</b>\n\nمعمولاً ظرف چند دقیقه تا چند ساعت پاسخ می‌دم. برای پیگیری سریع‌تر، تیکت بزن:\n<code>/ticket پیام شما</code>\n\nهمینجا هم هر سوالی داشته باشی برات جواب میدم.`;
  } else if (lower.includes('واتساپ') || lower.includes('whatsapp')) {
    reply = `💚 <b>WhatsApp Services</b>\n\n✅ Channel Members\n✅ Status Views\n\n🌐 ${SITE}`;
  } else if (lower.includes('لینکدین') || lower.includes('linkedin')) {
    reply = `💼 <b>LinkedIn Services</b>\n\n✅ Followers\n✅ Post Likes\n✅ Connections\n\n🌐 ${SITE}`;
  } else if (lower.includes('اسنپ') || lower.includes('snapchat')) {
    reply = `👻 <b>Snapchat Services</b>\n\n✅ Followers\n✅ Story Views\n\n🌐 ${SITE}`;
  } else if (lower.includes('پینترست') || lower.includes('pinterest')) {
    reply = `📌 <b>Pinterest Services</b>\n\n✅ Followers\n✅ Repins/Saves\n\n🌐 ${SITE}`;
  } else if (lower.includes('دیسکورد') || lower.includes('discord')) {
    reply = `🎮 <b>Discord Services</b>\n\n✅ Server Members\n\n🌐 ${SITE}`;
  } else if (lower.includes('ردیت') || lower.includes('reddit')) {
    reply = `👽 <b>Reddit Services</b>\n\n✅ Upvotes\n✅ Followers\n\n🌐 ${SITE}`;
  } else if (lower.includes('اسپاتیفای') || lower.includes('spotify')) {
    reply = `🎧 <b>Spotify Services</b>\n\n✅ Plays\n✅ Followers\n\n🌐 ${SITE}`;
  } else if (lower.includes('تویچ') || lower.includes('twitch')) {
    reply = `🎥 <b>Twitch Services</b>\n\n✅ Followers\n✅ Channel Views\n\n🌐 ${SITE}`;
  } else if (text === '/help' || lower.includes('help') || lower.includes('کمک')) {
    reply = isEnglish
      ? `📋 <b>Help</b>\n\n/panel - open the panel\n/services - service list\n/order [order number] - order status\n/ticket [message] - open a support ticket\n/prices - pricing\n/support - support\n\n🎁 Ask "free likes" any time to learn about our invite-and-earn program.\n\n💬 Contact admin for support.`
      : `📋 <b>راهنما</b>\n\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره سفارش] - وضعیت سفارش\n/ticket [پیام] - باز کردن تیکت پشتیبانی\n/prices - قیمت‌ها\n/support - پشتیبانی\n\n🎁 هر وقت خواستی بپرس «لایک رایگان» تا برنامه‌ی دعوت و جایزه رو برات توضیح بدم.\n\n💬 برای پشتیبانی با ادمین تماس بگیرید.`;
  } else if (text === '/panel') {
    reply = isEnglish
      ? `🔗 <b>Panel link</b>\n\n${SITE}\n\nSign up or log in to get started.`
      : `🔗 <b>لینک پنل</b>\n\n${SITE}\n\nبرای ورود ثبت نام کنید یا لاگین کنید.`;
  } else if (text === '/services' || lower.includes('service') || lower.includes('سرویس')) {
    reply = isEnglish
      ? `📦 <b>Our Services</b>\n\n✅ Instagram Followers\n✅ TikTok Likes\n✅ YouTube Views\n✅ Telegram Members\n✅ Facebook Likes\n✅ Twitter Followers\n\n🌐 To order: ${SITE}`
      : `📦 <b>سرویس‌های ما</b>\n\n✅ Instagram Followers\n✅ TikTok Likes\n✅ YouTube Views\n✅ Telegram Members\n✅ Facebook Likes\n✅ Twitter Followers\n\n🌐 برای سفارش: ${SITE}`;
  } else if (lower.includes('ریزش') || lower.includes('drop') || lower.includes('unfollow') || lower.includes('کم میشه') || lower.includes('کم می‌شه')) {
    reply = isEnglish
      ? `📉 <b>Follower/like drop</b>\n\nSome drop is normal (usually under 5%) since social platforms constantly remove fake accounts.\n\n✅ Some services include a "No Refill" or "Refill 30/60/365 days" guarantee — meaning any drop gets refilled for free.\n\nCheck each service's description (e.g. "30 Days Refill ♻️") before ordering.`
      : `📉 <b>ریزش فالوور/لایک</b>\n\nمقداری ریزش طبیعیه (معمولاً کمتر از ۵٪) چون شبکه‌های اجتماعی مدام حساب‌های فیک رو پاک می‌کنن.\n\n✅ بعضی سرویس‌ها گارانتی "No Refill" یا "Refill 30/60/365 روزه" دارن — یعنی اگه ریزش داشت، رایگان جاش پر میشه.\n\nموقع سفارش، به توضیحات هر سرویس (مثلاً "30 Days Refill ♻️") دقت کنید.`;
  } else if (lower.includes('امن') || lower.includes('safe') || lower.includes('بن') || lower.includes('ban') || lower.includes('خطر')) {
    reply = isEnglish
      ? `🔒 <b>Your account's safety</b>\n\nWe never ask for your password or login info — just your public profile link/username.\n\nOur services deliver gradually (controlled speed) to look natural to the platform's algorithm.\n\n⚠️ Your account just needs to be Public, not Private.`
      : `🔒 <b>امنیت حساب شما</b>\n\nما هیچ‌وقت پسورد یا اطلاعات ورود شما رو نمی‌خوایم. فقط لینک/یوزرنیم عمومی حسابتون کافیه.\n\nسرویس‌های ما به‌صورت تدریجی (Speed کنترل‌شده) تحویل داده میشن تا برای الگوریتم شبکه‌ی اجتماعی طبیعی به‌نظر برسه.\n\n⚠️ فقط باید حسابتون Public (عمومی) باشه، نه Private.`;
  } else if (lower.includes('خصوصی') || lower.includes('private')) {
    reply = isEnglish
      ? `🔓 <b>Private accounts</b>\n\nUnfortunately services only work on <b>Public</b> accounts.\n\nSet your account to Public before ordering — you can switch it back to Private once the order is done.`
      : `🔓 <b>حساب Private</b>\n\nمتأسفانه سرویس‌ها فقط روی حساب‌های **Public (عمومی)** کار می‌کنن.\n\nقبل از سفارش، حسابتون رو موقتاً Public کنید، بعد از تکمیل سفارش می‌تونید دوباره Private کنید.`;
  } else if (lower.includes('پسورد') || lower.includes('password') || lower.includes('رمز عبور حساب')) {
    reply = isEnglish
      ? `🔑 <b>No password needed</b>\n\nWe never ask for your Instagram/TikTok/YouTube password!\n\nJust the post link or your public username is enough.`
      : `🔑 <b>پسورد لازم نیست</b>\n\nما هیچ‌وقت پسورد اینستاگرام/تیک‌تاک/یوتیوب شما رو نمی‌خوایم!\n\nفقط لینک پست یا یوزرنیم عمومی حسابتون کافیه.`;
  } else if (lower.includes('چند وقت') || lower.includes('چقدر طول') || lower.includes('چه مدت') || lower.includes('how long') || lower.includes('delivery time')) {
    reply = isEnglish
      ? `⏱ <b>Delivery time</b>\n\nMost orders start within minutes to a few hours (Instant Start).\n\nFull completion speed depends on the service — details (e.g. "Day 100K 🚀") are in each service's description.\n\nTo track exactly: <code>/order [order number]</code>`
      : `⏱ <b>زمان تحویل</b>\n\nاکثر سفارش‌ها ظرف چند دقیقه تا چند ساعت شروع میشن (Instant Start).\n\nسرعت کامل شدن بستگی به نوع سرویس داره — جزئیاتش (مثلاً "Day 100K 🚀") تو توضیحات هر سرویس نوشته شده.\n\nبرای پیگیری دقیق: <code>/order [شماره سفارش]</code>`;
  } else if (lower.includes('واقعی') || lower.includes('ربات') || lower.includes('real') || lower.includes('bot account') || lower.includes('فیک')) {
    reply = isEnglish
      ? `👥 <b>Real followers or bots?</b>\n\nWe offer both:\n✅ High Quality / Real Accounts — better quality, less drop, pricier\n✅ Economy services — cheaper, good for a quick number boost\n\nEach service's description (e.g. "100% Real Accounts") tells you exactly which type it is.`
      : `👥 <b>فالوور واقعی یا ربات؟</b>\n\nما هر دو نوع سرویس داریم:\n✅ High Quality / Real Accounts — کیفیت بالاتر، ریزش کمتر، گرون‌تر\n✅ سرویس‌های اقتصادی — ارزون‌تر، مناسب افزایش عدد سریع\n\nتوضیحات هر سرویس (مثلاً "100% Real Accounts") دقیقاً مشخص می‌کنه چه نوعیه.`;
  } else if (lower.includes('حداقل') || lower.includes('حداکثر') || lower.includes('minimum') || lower.includes('maximum') || lower.includes('min order') || lower.includes('max order')) {
    reply = isEnglish
      ? `🔢 <b>Min & max order</b>\n\nEach service has its own limits (e.g. min 100, max 1 million).\n\nThis is shown when you pick a service in the panel.`
      : `🔢 <b>حداقل و حداکثر سفارش</b>\n\nهر سرویس محدودیت خودش رو داره (مثلاً حداقل ۱۰۰، حداکثر ۱ میلیون).\n\nاین اطلاعات موقع انتخاب سرویس تو پنل نمایش داده میشه.`;
  } else if (lower.includes('بازگشت وجه') || lower.includes('refund') || lower.includes('پس بگیرم') || lower.includes('پول برگرد')) {
    reply = isEnglish
      ? `💸 <b>Refunds</b>\n\nIf an order stays incomplete/undelivered, the amount is refunded to your wallet or you get a replacement order.\n\nTo request a refund, please open a ticket:\n<code>/ticket describe your issue</code>`
      : `💸 <b>بازگشت وجه</b>\n\nاگه سفارشی ناقص یا انجام‌نشده باقی بمونه، مبلغش به کیف پول حسابتون برمی‌گرده یا سفارش جایگزین می‌گیرید.\n\nبرای درخواست بازگشت وجه، لطفاً تیکت بزنید:\n<code>/ticket توضیح مشکل شما</code>`;
  } else if (lower.includes('گارانتی') || lower.includes('warranty') || lower.includes('guarantee')) {
    reply = isEnglish
      ? `✅ <b>Service guarantees</b>\n\nMost services include a Refill guarantee (30/60/90/365 days or lifetime ♻️) — meaning any drop gets refilled for free.\n\nEach service's description states its guarantee type.`
      : `✅ <b>گارانتی سرویس‌ها</b>\n\nبیشتر سرویس‌ها گارانتی Refill دارن (۳۰/۶۰/۹۰/۳۶۵ روزه یا مادام‌العمر ♻️) — یعنی اگه ریزش کرد، رایگان جبران میشه.\n\nنوع گارانتی هر سرویس تو توضیحاتش مشخصه.`;
  } else if (lower.includes('یوتیوب') || lower.includes('youtube')) {
    reply = `▶️ <b>YouTube Services</b>\n\n✅ Views\n✅ Likes\n✅ Subscribers\n✅ Comments\n\n🌐 ${SITE}`;
  } else if (lower.includes('فیسبوک') || lower.includes('facebook')) {
    reply = `👍 <b>Facebook Services</b>\n\n✅ Page/Profile Followers\n✅ Post Likes & Reactions\n✅ Comments\n\n🌐 ${SITE}`;
  } else if (lower.includes('توییتر') || lower.includes('تویتر') || lower.includes('twitter') || lower.includes(' x ')) {
    reply = `🐦 <b>Twitter/X Services</b>\n\n✅ Followers\n✅ Tweet Views\n✅ Likes & Retweets\n\n🌐 ${SITE}`;
  } else if (lower.includes('order') || lower.includes('سفارش') || lower.includes('وضعیت') || lower.includes('فالور') || lower.includes('follower')) {
    reply = isEnglish
      ? `📦 <b>Order tracking</b>\n\nTo check an order's status, send me the order number, e.g.:\n<code>/order 12345</code>\n\nOr log into the panel:\n${SITE}`
      : `📦 <b>پیگیری سفارش</b>\n\nبرای دیدن وضعیت سفارش، شماره سفارشتان را برایم بفرستید، مثلاً:\n<code>/order 12345</code>\n\nیا وارد پنل شوید:\n${SITE}`;
  } else if (text === '/support' || lower.includes('support') || lower.includes('پشتیبانی') || lower.includes('problem') || lower.includes('مشکل')) {
    reply = isEnglish
      ? `🆘 <b>Support</b>\n\nTo open a support request, just send it here:\n<code>/ticket your message</code>\n\nExample:\n<code>/ticket I have an issue with my order</code>\n\nOr use the Tickets section in the panel:\n🌐 ${SITE}\n\nAdmin will reply as soon as possible.`
      : `🆘 <b>پشتیبانی</b>\n\nبرای ثبت درخواست پشتیبانی، همینجا برایم بفرستید:\n<code>/ticket پیام شما</code>\n\nمثال:\n<code>/ticket مشکلی با سفارشم دارم</code>\n\nیا وارد پنل شوید و از بخش Tickets استفاده کنید:\n🌐 ${SITE}\n\nادمین در اسرع وقت پاسخ می‌دهد.`;
  } else if (lower.includes('price') || lower.includes('قیمت') || lower.includes('cost') || lower.includes('هزینه')) {
    reply = isEnglish
      ? `💰 <b>Pricing</b>\n\nPrices vary by service type.\n\n👉 For exact pricing:\n${SITE}\n\nOpen the Services section.`
      : `💰 <b>قیمت‌ها</b>\n\nقیمت‌ها بر اساس نوع سرویس متفاوت است.\n\n👉 برای مشاهده قیمت دقیق:\n${SITE}\n\nبخش Services را باز کنید.`;
  } else if (lower.includes('payment') || lower.includes('پرداخت') || lower.includes('pay')) {
    reply = `💳 <b>Payment Methods</b>\n\n✅ PayPal\n✅ Binance Pay\n✅ USDT (TRC20)\n✅ Hawala / Cash\n\n🌐 ${SITE}/smm-panel.html`;
  } else if (lower.includes('instagram') || lower.includes('insta')) {
    reply = `📸 <b>Instagram Services</b>\n\n✅ Real Followers\n✅ Likes\n✅ Views\n✅ Comments\n\n💰 From $0.001/unit\n🌐 ${SITE}`;
  } else if (lower.includes('tiktok')) {
    reply = `🎵 <b>TikTok Services</b>\n\n✅ Followers\n✅ Likes\n✅ Views\n✅ Comments\n\n💰 From $0.001/unit\n🌐 ${SITE}`;
  } else {
    reply = isEnglish
      ? `👋 Hi ${firstName}!\n\nThanks for your message 🙌 Ask me anything about services, pricing, payment, account safety, or your order status — happy to help.\n\nOr use these commands:\n/services - service list\n/prices - pricing\n/order [number] - order status\n/support - support\n\n🌐 ${SITE}`
      : `👋 سلام ${firstName}!\n\nممنون از پیامت 🙌 هر سوالی درباره‌ی سرویس‌ها، قیمت، پرداخت، امنیت حساب یا وضعیت سفارشت داری، همینجا بپرس — دوست دارم کمکت کنم.\n\nیا از دستورات زیر استفاده کن:\n/services - لیست سرویس‌ها\n/prices - قیمت‌ها\n/order [شماره] - وضعیت سفارش\n/support - پشتیبانی\n\n🌐 ${SITE}`;
  }

  if (reply) {
    await sendMsg(chatId, reply);
  }

  // Ticket messages already send their own (richer) admin notice above —
  // for everything else, let the admin know what customers are asking
  // instead of it just vanishing into an automated reply.
  if (!ticketMatch && text) {
    const username = (msg.from && (msg.from.username ? '@' + msg.from.username : firstName)) || 'کاربر تلگرام';
    await notifyAdmin(token, `💬 <b>پیام جدید در ربات تلگرام</b>\n\n👤 ${username}\n📩 ${text.slice(0, 500)}`);
  }

  return res.status(200).send('ok');
};
