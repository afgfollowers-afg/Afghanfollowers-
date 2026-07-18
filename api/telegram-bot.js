// Vercel Serverless Function — Telegram Bot webhook handler
const SITE = 'https://afghanfollowers.online';
const { dbHeaders, API_BASE, fetchInternal } = require('./_dbkey');
const { dispatchOneOrder } = require('./sync-orders');

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tgApi(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return r.json();
}

async function getDb() {
  const r = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
  return r.json();
}

async function saveUsers(users) {
  await fetchInternal(API_BASE + '/api/db', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ smm_users: users, smm_ts: Date.now() })
  });
}

function findUserByChat(users, chatId) {
  return (users || []).find(function (u) { return u && u.tgChatId !== undefined && u.tgChatId !== null && String(u.tgChatId) === String(chatId); });
}

// Mirrors smm-panel.html's own detectPlatform() so the bot's platform
// grouping (see groupByPlatform below) matches what customers already see
// in the web panel, rather than inventing a second, divergent taxonomy.
function detectPlatform(str) {
  if (!str) return 'other';
  var s = String(str).toLowerCase();
  if (s.indexOf('tiktok') > -1 || s.indexOf('tik tok') > -1 || s.indexOf('tik-tok') > -1) return 'tiktok';
  if (s.indexOf('instagram') > -1 || s.indexOf('insta ') > -1) return 'instagram';
  if (s.indexOf('telegram') > -1) return 'telegram';
  if (s.indexOf('youtube') > -1 || s.indexOf('yt ') > -1) return 'youtube';
  if (s.indexOf('facebook') > -1 || s.indexOf(' fb ') > -1) return 'facebook';
  if (s.indexOf('twitter') > -1 || s.indexOf(' x ') > -1 || s.indexOf('tweet') > -1) return 'twitter';
  if (s.indexOf('whatsapp') > -1 || s.indexOf('whats app') > -1) return 'whatsapp';
  if (s.indexOf('linkedin') > -1) return 'linkedin';
  if (s.indexOf('twitch') > -1) return 'twitch';
  if (s.indexOf('spotify') > -1) return 'spotify';
  if (s.indexOf('pinterest') > -1) return 'pinterest';
  if (s.indexOf('snapchat') > -1) return 'snapchat';
  if (s.indexOf('discord') > -1) return 'discord';
  if (s.indexOf('reddit') > -1) return 'reddit';
  return 'other';
}

const PLATFORM_ORDER = ['instagram', 'tiktok', 'telegram', 'youtube', 'facebook', 'twitter', 'whatsapp', 'linkedin', 'twitch', 'spotify', 'pinterest', 'snapchat', 'discord', 'reddit', 'other'];
const PLATFORM_LABEL = {
  instagram: '📸 Instagram', tiktok: '🎵 TikTok', telegram: '✈️ Telegram', youtube: '▶️ YouTube',
  facebook: '👍 Facebook', twitter: '🐦 Twitter/X', whatsapp: '💚 WhatsApp', linkedin: '💼 LinkedIn',
  twitch: '🎥 Twitch', spotify: '🎧 Spotify', pinterest: '📌 Pinterest', snapchat: '👻 Snapchat',
  discord: '🎮 Discord', reddit: '👽 Reddit', other: '📦 Other'
};

// smm_svc compact row format (see api/db.js / sync-orders.js):
// [id, svcId, fullDesc, category, provName, provId, cost, price, min, max, active, cancel, refill]
function decompressSvc(raw) {
  return (raw || [])
    .filter(function (s) { return s && s[10] !== 0; })
    .map(function (s) {
      return {
        id: s[0], svcId: s[1], name: s[2], category: s[3], provName: s[4], provId: s[5],
        price: parseFloat(s[7]) || 0, min: parseInt(s[8], 10) || 1, max: parseInt(s[9], 10) || 1000000
      };
    });
}

function groupByPlatform(svcs) {
  var map = {};
  svcs.forEach(function (s) {
    var p = detectPlatform(s.category);
    if (p === 'other') p = detectPlatform(s.name);
    if (!map[p]) map[p] = [];
    map[p].push(s);
  });
  return map;
}

// Pending in-bot order requests never last more than this — an old "confirm"
// button tapped long after the fact would otherwise place an order at a
// price/balance that may no longer be accurate.
const PENDING_TTL_MS = 20 * 60 * 1000;

async function startBuyFlow(token, chatId, isEnglish) {
  const db = await getDb();
  const groups = groupByPlatform(decompressSvc(db.smm_svc));
  const buttons = [];
  let row = [];
  PLATFORM_ORDER.forEach(function (p) {
    if (!groups[p] || !groups[p].length) return;
    row.push({ text: PLATFORM_LABEL[p] || p, callback_data: 'buyp|' + (isEnglish ? '1' : '0') + '|' + p });
    if (row.length === 2) { buttons.push(row); row = []; }
  });
  if (row.length) buttons.push(row);
  if (!buttons.length) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'No services available right now — please try the panel.' : 'در حال حاضر سرویسی موجود نیست — از پنل استفاده کنید.' });
    return;
  }
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish ? '🛒 <b>Buy a service</b>\n\nChoose a platform:' : '🛒 <b>خرید سرویس</b>\n\nیک پلتفرم را انتخاب کنید:',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function showServiceList(token, chatId, platform, isEnglish) {
  const db = await getDb();
  const groups = groupByPlatform(decompressSvc(db.smm_svc));
  const list = (groups[platform] || []).slice().sort(function (a, b) { return a.price - b.price; }).slice(0, 10);
  if (!list.length) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'No services found for this platform.' : 'سرویسی برای این پلتفرم پیدا نشد.' });
    return;
  }
  const buttons = list.map(function (s) {
    const label = (s.name || '').slice(0, 45) + ' — $' + s.price.toFixed(4) + '/1000';
    return [{ text: label, callback_data: 'buys|' + (isEnglish ? '1' : '0') + '|' + s.id }];
  });
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: (isEnglish
      ? '📦 <b>Services</b>\n\nTap one to order — min/max shown after you pick.\n\n💡 See all options: '
      : '📦 <b>سرویس‌ها</b>\n\nروی یکی بزن تا سفارش بدی — حداقل/حداکثر بعد از انتخاب نشان داده می‌شود.\n\n💡 دیدن همه‌ی سرویس‌ها: ') + SITE + '/smm-panel.html',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function selectService(token, chatId, rowId, isEnglish) {
  const db = await getDb();
  const users = db.smm_users || [];
  const user = findUserByChat(users, chatId);
  if (!user) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? `🔒 <b>Account not linked</b>\n\nTo order directly from Telegram, first link your account: log into the panel, open "Free Likes", and tap "🔗 Connect Telegram".\n\n🌐 ${SITE}/smm-panel.html`
        : `🔒 <b>حساب متصل نیست</b>\n\nبرای سفارش مستقیم از تلگرام، اول باید حسابتان را وصل کنید: وارد پنل شوید، بخش «Free Likes» را باز کنید و روی «🔗 اتصال تلگرام» بزنید.\n\n🌐 ${SITE}/smm-panel.html`
    });
    return;
  }
  const svc = decompressSvc(db.smm_svc).find(function (s) { return String(s.id) === String(rowId); });
  if (!svc) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This service is no longer available.' : 'این سرویس دیگر موجود نیست.' });
    return;
  }
  user.tgPending = {
    svcRowId: svc.id, svcId: svc.svcId, provId: svc.provId, name: svc.name, category: svc.category,
    price: svc.price, min: svc.min, max: svc.max, step: 'await_qty_link', ts: Date.now()
  };
  await saveUsers(users);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish
      ? `✅ <b>${escapeHtml(svc.name)}</b>\n💰 $${svc.price.toFixed(4)} / 1000\n🔢 Min: ${svc.min} — Max: ${svc.max}\n\nNow send the link/username and quantity in one message, e.g.:\n<code>https://instagram.com/yourpage 1000</code>\n\nSend /cancel to abort.`
      : `✅ <b>${escapeHtml(svc.name)}</b>\n💰 $${svc.price.toFixed(4)} به ازای ۱۰۰۰\n🔢 حداقل: ${svc.min} — حداکثر: ${svc.max}\n\nحالا لینک/یوزرنیم و تعداد را در یک پیام بفرست، مثلاً:\n<code>https://instagram.com/yourpage 1000</code>\n\nبرای انصراف /cancel را بفرست.`
  });
}

// Handles a free-text message while the chat has an in-progress "waiting for
// link+quantity" order — assumes the caller (maybeHandlePendingFreeText)
// already confirmed user.tgPending.step === 'await_qty_link' and passes in
// the already-fetched user/users so this doesn't re-read the DB itself.
async function handleQtyLinkText(token, chatId, user, users, text, isEnglish) {
  const pending = user.tgPending;
  if (Date.now() - pending.ts > PENDING_TTL_MS) {
    user.tgPending = null;
    await saveUsers(users);
    return false;
  }

  const m = text.match(/^(\S[\s\S]*?)\s+(\d+)\s*$/);
  if (!m) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? '❌ Please send it as: <link/username> <quantity>\ne.g. <code>https://instagram.com/yourpage 1000</code>\n\nOr /cancel to abort.'
        : '❌ لطفاً به این شکل بفرست: لینک/یوزرنیم و تعداد\nمثلاً: <code>https://instagram.com/yourpage 1000</code>\n\nیا /cancel برای انصراف.'
    });
    return true;
  }
  const link = m[1].trim();
  const qty = parseInt(m[2], 10);
  if (qty < pending.min || qty > pending.max) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId,
      text: isEnglish
        ? `❌ Quantity must be between ${pending.min} and ${pending.max}. Please resend.`
        : `❌ تعداد باید بین ${pending.min} تا ${pending.max} باشد. دوباره بفرست.`
    });
    return true;
  }

  const cost = parseFloat((pending.price * qty / 1000).toFixed(4)) || 0.0001;
  const balance = parseFloat(user.balance) || 0;
  if (cost > balance) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? `❌ <b>Insufficient balance</b>\n\nThis order costs $${cost.toFixed(4)}, your balance is $${balance.toFixed(2)}.\n\nTop up, then resend the link and quantity.`
        : `❌ <b>موجودی کافی نیست</b>\n\nهزینه این سفارش $${cost.toFixed(4)} است، موجودی شما $${balance.toFixed(2)} است.\n\nابتدا شارژ کنید، سپس دوباره لینک و تعداد را بفرست.`,
      reply_markup: { inline_keyboard: [[{ text: isEnglish ? '💳 Top up now' : '💳 شارژ حساب', callback_data: 'tup|' + (isEnglish ? '1' : '0') }]] }
    });
    return true;
  }

  user.tgPending = Object.assign({}, pending, { step: 'await_confirm', qty: qty, link: link, cost: cost, ts: Date.now() });
  await saveUsers(users);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish
      ? `🧾 <b>Confirm your order</b>\n\n📦 ${escapeHtml(pending.name)}\n🔗 ${escapeHtml(link)}\n🔢 Qty: ${qty}\n💰 Cost: $${cost.toFixed(4)}\n💳 Balance after: $${(balance - cost).toFixed(2)}`
      : `🧾 <b>تایید سفارش</b>\n\n📦 ${escapeHtml(pending.name)}\n🔗 ${escapeHtml(link)}\n🔢 تعداد: ${qty}\n💰 هزینه: $${cost.toFixed(4)}\n💳 موجودی بعد از خرید: $${(balance - cost).toFixed(2)}`,
    reply_markup: {
      inline_keyboard: [[
        { text: isEnglish ? '✅ Confirm' : '✅ تایید', callback_data: 'buyc|' + (isEnglish ? '1' : '0') },
        { text: isEnglish ? '❌ Cancel' : '❌ انصراف', callback_data: 'buyx|' + (isEnglish ? '1' : '0') }
      ]]
    }
  });
  return true;
}

async function confirmPendingOrder(token, chatId, isEnglish) {
  const db = await getDb();
  const users = db.smm_users || [];
  const user = findUserByChat(users, chatId);
  if (!user || !user.tgPending || user.tgPending.step !== 'await_confirm') {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'Nothing to confirm — start over with /buy.' : 'چیزی برای تایید نیست — دوباره با /buy شروع کن.' });
    return;
  }
  const pending = user.tgPending;
  if (Date.now() - pending.ts > PENDING_TTL_MS) {
    user.tgPending = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This request expired — start over with /buy.' : 'این درخواست منقضی شد — دوباره با /buy شروع کن.' });
    return;
  }
  const svc = decompressSvc(db.smm_svc).find(function (s) { return String(s.id) === String(pending.svcRowId); });
  if (!svc || Math.abs(svc.price - pending.price) > 1e-9) {
    user.tgPending = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This service changed or is no longer available — start over with /buy.' : 'این سرویس تغییر کرده یا دیگر موجود نیست — دوباره با /buy شروع کن.' });
    return;
  }
  const balance = parseFloat(user.balance) || 0;
  if (pending.cost > balance) {
    user.tgPending = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', {
      chat_id: chatId,
      text: isEnglish ? 'Insufficient balance now — top up and start over with /buy.' : 'موجودی کافی نیست — شارژ کن و دوباره با /buy شروع کن.',
      reply_markup: { inline_keyboard: [[{ text: isEnglish ? '💳 Top up now' : '💳 شارژ حساب', callback_data: 'tup|' + (isEnglish ? '1' : '0') }]] }
    });
    return;
  }

  const orderId = Date.now();
  const orderPlatform = detectPlatform(pending.category);
  const order = {
    id: orderId, userId: user.id, user: ((user.fname || user.name || '') + (user.lname ? ' ' + user.lname : '')).trim(),
    email: user.email || '', platform: orderPlatform, plat: orderPlatform,
    service: pending.name, svc: pending.name, svcName: pending.name,
    svcId: pending.svcId, provId: pending.provId,
    link: pending.link, qty: pending.qty, cost: pending.cost,
    startCount: 0, remain: pending.qty, status: 'processing',
    dispatchAttemptedAt: Date.now(), date: new Date().toISOString(), source: 'telegram'
  };

  user.balance = parseFloat((balance - pending.cost).toFixed(4));
  user.orders = (parseInt(user.orders, 10) || 0) + 1;
  user.transactions = user.transactions || [];
  user.transactions.unshift({ id: Date.now(), type: 'spend', amount: pending.cost, desc: 'Order: ' + pending.name, date: new Date().toISOString(), status: 'approved' });
  user.tgPending = null;

  await fetchInternal(API_BASE + '/api/db', {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ smm_users: users, smm_orders: [order], smm_ts: Date.now() })
  });

  let dispatchNote = '';
  try {
    const result = await dispatchOneOrder(order, { providers: db.smm_providers || [], svcList: db.smm_svc || [] }, {});
    if (!result.ok) dispatchNote = isEnglish ? '\n\n⏳ Sending to the provider — this can take a moment.' : '\n\n⏳ در حال ارسال به سرویس‌دهنده — کمی طول می‌کشد.';
  } catch (e) {
    dispatchNote = isEnglish ? '\n\n⏳ Sending to the provider — this can take a moment.' : '\n\n⏳ در حال ارسال به سرویس‌دهنده — کمی طول می‌کشد.';
  }

  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: (isEnglish
      ? `✅ <b>Order placed!</b>\n\nOrder #${orderId}\n📦 ${escapeHtml(pending.name)}\n🔢 Qty: ${pending.qty}\n💰 $${pending.cost.toFixed(4)}\n\nTrack it any time: <code>/order ${orderId}</code>`
      : `✅ <b>سفارش ثبت شد!</b>\n\nشماره سفارش #${orderId}\n📦 ${escapeHtml(pending.name)}\n🔢 تعداد: ${pending.qty}\n💰 $${pending.cost.toFixed(4)}\n\nبرای پیگیری: <code>/order ${orderId}</code>`) + dispatchNote
  });

  await notifyAdmin(token, `🛒 <b>New Telegram Order #${orderId}</b>\n👤 ${escapeHtml(order.user || order.email || ('User ' + user.id))}\n📦 ${escapeHtml(pending.name)}\n🔢 ${pending.qty}\n💰 $${pending.cost.toFixed(4)}`);
}

// Clears both in-progress flows (an order awaiting link/qty/confirm, and a
// top-up awaiting amount/proof/PayPal confirmation) — used by /cancel and by
// every "❌ Cancel" button, since only one flow is ever meaningfully active
// per chat and clearing the other one too is harmless.
async function cancelAnyPending(token, chatId, isEnglish) {
  const db = await getDb();
  const users = db.smm_users || [];
  const user = findUserByChat(users, chatId);
  let hadSomething = false;
  if (user && user.tgPending) { user.tgPending = null; hadSomething = true; }
  if (user && user.tgTopup) { user.tgTopup = null; hadSomething = true; }
  if (hadSomething) await saveUsers(users);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: isEnglish ? (hadSomething ? '❌ Cancelled.' : 'Nothing to cancel.') : (hadSomething ? '❌ لغو شد.' : 'چیزی برای لغو نیست.')
  });
}

async function showBalance(token, chatId, isEnglish) {
  const db = await getDb();
  const user = findUserByChat(db.smm_users || [], chatId);
  if (!user) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? `🔒 Account not linked yet. Open the panel → Free Likes → "Connect Telegram" to link it.\n\n🌐 ${SITE}/smm-panel.html`
        : `🔒 حساب هنوز وصل نشده. از پنل وارد شو → بخش Free Likes → «اتصال تلگرام».\n\n🌐 ${SITE}/smm-panel.html`
    });
    return;
  }
  const bal = parseFloat(user.balance) || 0;
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish
      ? `💳 <b>Your balance:</b> $${bal.toFixed(2)}\n📦 Orders: ${user.orders || 0}\n\nUse /topup to add funds right here.`
      : `💳 <b>موجودی شما:</b> $${bal.toFixed(2)}\n📦 تعداد سفارش‌ها: ${user.orders || 0}\n\nبرای شارژ همینجا از /topup استفاده کن.`
  });
}

// ── Direct top-up flow (/topup) ──────────────────────────────────────────
// Lets the customer pay from inside the chat instead of going to the panel:
// PayPal orders are created via PayPal's own REST API (same Orders v2 flow
// api/paypal-verify.js already trusts) and captured the moment the customer
// taps "I've paid"; every other configured method (Binance Pay, USDT,
// Cash/Hawala, ...) shows the same payment details the panel's manual "Add
// Funds" flow does and logs a deposit_pending transaction for the admin to
// approve — identical shape to smm-panel.html's afSubmitManual(), so it
// shows up in the existing admin approval UI without any changes there.
const PM_ICON = {
  paypal: '🅿️ PayPal', binance: '🟡 Binance Pay', usdt_trc20: '₮ USDT (TRC20)',
  usdt_erc20: 'Ξ USDT (ERC20)', payment_approval: '💵 Cash / Hawala', perfectmoney: '💎 Perfect Money'
};

async function paypalToken(clientId, secret, apiBase) {
  const r = await fetch(apiBase + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('PayPal auth failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function startTopupFlow(token, chatId, isEnglish) {
  const db = await getDb();
  // Stripe needs a hosted card-entry form the bot has no way to drive, so
  // it's excluded here even if an admin has it toggled on — every other
  // method either redirects to a real payment page (PayPal) or is a manual
  // proof-of-payment method the panel already supports the same way.
  const pms = (db.smm_pm || []).filter(function (m) { return m && m.on && m.method !== 'stripe'; });
  if (!pms.length) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'No payment method is configured yet — please contact support.' : 'هنوز روش پرداختی تنظیم نشده — با پشتیبانی تماس بگیرید.' });
    return;
  }
  const buttons = pms.map(function (m) {
    return [{ text: PM_ICON[m.method] || m.vname || m.method, callback_data: 'tupm|' + (isEnglish ? '1' : '0') + '|' + m.id }];
  });
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish ? '💳 <b>Add funds</b>\n\nChoose a payment method:' : '💳 <b>افزایش موجودی</b>\n\nیک روش پرداخت را انتخاب کنید:',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function selectTopupMethod(token, chatId, pmId, isEnglish) {
  const db = await getDb();
  const users = db.smm_users || [];
  const user = findUserByChat(users, chatId);
  if (!user) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? `🔒 <b>Account not linked</b>\n\nLog into the panel, open "Free Likes", and tap "🔗 Connect Telegram" first.\n\n🌐 ${SITE}/smm-panel.html`
        : `🔒 <b>حساب متصل نیست</b>\n\nاول وارد پنل شو، بخش «Free Likes» را باز کن و روی «🔗 اتصال تلگرام» بزن.\n\n🌐 ${SITE}/smm-panel.html`
    });
    return;
  }
  const pm = (db.smm_pm || []).find(function (m) { return String(m.id) === String(pmId) && m.on; });
  if (!pm) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This payment method is no longer available.' : 'این روش پرداخت دیگر موجود نیست.' });
    return;
  }
  const min = parseFloat(pm.min) || 1;
  const max = parseFloat(pm.max) || 100000;
  user.tgTopup = { pmId: pm.id, method: pm.method, vname: pm.vname, min: min, max: max, step: 'await_amount', ts: Date.now() };
  await saveUsers(users);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish
      ? `💳 <b>${escapeHtml(pm.vname || pm.method)}</b>\n\nSend the amount you want to add (between $${min} and $${max}):`
      : `💳 <b>${escapeHtml(pm.vname || pm.method)}</b>\n\nمبلغی که می‌خواهید شارژ کنید را بفرست (بین $${min} تا $${max}):`
  });
}

async function finishStartPaypalOrder(token, db, chatId, user, users, amt, isEnglish) {
  const pm = (db.smm_pm || []).find(function (m) { return m.method === 'paypal'; });
  if (!pm || !pm.clientId || !pm.clientSecret) {
    user.tgTopup = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'PayPal is not fully configured — please use another method or the panel.' : 'PayPal کامل تنظیم نشده — از روش دیگر یا پنل استفاده کنید.' });
    return;
  }
  const apiBase = pm.env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  try {
    const accessToken = await paypalToken(pm.clientId, pm.clientSecret, apiBase);
    const orderResp = await fetch(apiBase + '/v2/checkout/orders', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: pm.cur || 'USD', value: amt.toFixed(2) }, description: 'Wallet top-up — Afghan Followers' }],
        application_context: { brand_name: 'Afghan Followers', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' }
      })
    });
    const order = await orderResp.json();
    const approveLink = (order.links || []).find(function (l) { return l.rel === 'approve'; });
    if (!orderResp.ok || !approveLink) {
      user.tgTopup = null;
      await saveUsers(users);
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ Could not start the PayPal payment. Please try again later.' : '❌ شروع پرداخت PayPal ممکن نشد. بعداً دوباره امتحان کنید.' });
      return;
    }
    user.tgTopup = { pmId: pm.id, method: 'paypal', amount: amt, ppOrderId: order.id, step: 'await_paypal_confirm', ts: Date.now() };
    await saveUsers(users);
    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? `💰 <b>Pay $${amt.toFixed(2)} with PayPal</b>\n\n1️⃣ Tap the button below and complete the payment\n2️⃣ Come back and tap "✅ I've paid"\n\nYour balance is credited automatically once PayPal confirms it.`
        : `💰 <b>پرداخت $${amt.toFixed(2)} با PayPal</b>\n\n1️⃣ روی دکمه زیر بزن و پرداخت را کامل کن\n2️⃣ برگرد و روی «✅ پرداخت کردم» بزن\n\nبه محض تایید PayPal، موجودی‌ات خودکار شارژ می‌شود.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: isEnglish ? '🔗 Pay with PayPal' : '🔗 پرداخت با PayPal', url: approveLink.href }],
          [
            { text: isEnglish ? '✅ I\'ve paid' : '✅ پرداخت کردم', callback_data: 'tupx|' + (isEnglish ? '1' : '0') },
            { text: isEnglish ? '❌ Cancel' : '❌ انصراف', callback_data: 'tupc|' + (isEnglish ? '1' : '0') }
          ]
        ]
      }
    });
  } catch (e) {
    user.tgTopup = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ PayPal error — please try again later.' : '❌ خطای PayPal — بعداً دوباره امتحان کنید.' });
  }
}

async function showManualPaymentInstructions(token, db, chatId, user, users, amt, isEnglish) {
  const pm = (db.smm_pm || []).find(function (m) { return String(m.id) === String(user.tgTopup.pmId); });
  if (!pm) {
    user.tgTopup = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This payment method is no longer available.' : 'این روش پرداخت دیگر موجود نیست.' });
    return;
  }
  user.tgTopup = Object.assign({}, user.tgTopup, { amount: amt, step: 'await_proof', ts: Date.now() });
  await saveUsers(users);

  var details;
  if (pm.method === 'binance') details = (isEnglish ? 'Binance Pay ID: ' : 'شناسه Binance Pay: ') + '<code>' + escapeHtml(pm.payId || '-') + '</code>';
  else if (pm.method === 'usdt_trc20' || pm.method === 'usdt_erc20') details = (isEnglish ? 'Wallet address: ' : 'آدرس کیف پول: ') + '<code>' + escapeHtml(pm.wallet || '-') + '</code>';
  else details = escapeHtml(pm.account || '') + (pm.instructions ? '\n' + escapeHtml(pm.instructions) : '');

  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish
      ? `💵 <b>Pay $${amt.toFixed(2)} — ${escapeHtml(pm.vname || pm.method)}</b>\n\n${details}\n\nAfter sending the payment, reply here with your transaction ID / reference so an admin can verify and credit it.\n\nOr /cancel to abort.`
      : `💵 <b>پرداخت $${amt.toFixed(2)} — ${escapeHtml(pm.vname || pm.method)}</b>\n\n${details}\n\nبعد از انجام پرداخت، شماره تراکنش/مرجع را همینجا بفرست تا ادمین تایید و شارژ کند.\n\nیا /cancel برای انصراف.`
  });
}

async function handleTopupAmountText(token, db, chatId, user, users, text, isEnglish) {
  const topup = user.tgTopup;
  const amt = parseFloat(text.replace(/[^0-9.]/g, ''));
  if (!amt || isNaN(amt) || amt <= 0) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ Please send a valid amount, e.g. 20' : '❌ لطفاً یک مبلغ معتبر بفرست، مثلاً 20' });
    return;
  }
  if (amt < topup.min || amt > topup.max) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId,
      text: isEnglish ? `❌ Amount must be between $${topup.min} and $${topup.max}.` : `❌ مبلغ باید بین $${topup.min} تا $${topup.max} باشد.`
    });
    return;
  }
  if (topup.method === 'paypal') {
    await finishStartPaypalOrder(token, db, chatId, user, users, amt, isEnglish);
  } else {
    await showManualPaymentInstructions(token, db, chatId, user, users, amt, isEnglish);
  }
}

async function handleTopupProofText(token, chatId, user, users, text, isEnglish) {
  const topup = user.tgTopup;
  const txid = text.trim().slice(0, 200);
  user.transactions = user.transactions || [];
  user.transactions.unshift({
    id: Date.now(), type: 'deposit_pending', method: topup.method, amount: topup.amount,
    txid: txid, status: 'pending', desc: 'Telegram — awaiting admin approval', date: new Date().toISOString()
  });
  user.tgTopup = null;
  await saveUsers(users);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: isEnglish
      ? `✅ <b>Payment submitted!</b>\n\nAmount: $${topup.amount.toFixed(2)}\nReference: ${escapeHtml(txid)}\n\nAn admin will verify and credit your wallet shortly.`
      : `✅ <b>پرداخت ثبت شد!</b>\n\nمبلغ: $${topup.amount.toFixed(2)}\nمرجع: ${escapeHtml(txid)}\n\nادمین به‌زودی تایید و شارژ می‌کند.`
  });
  await notifyAdmin(token, `💰 <b>New Telegram Top-up Request</b>\n👤 ${escapeHtml(user.fname || user.name || user.email || ('User ' + user.id))}\n💳 ${escapeHtml(topup.method)}\n💵 $${topup.amount.toFixed(2)}\n🔖 ${escapeHtml(txid)}`);
}

async function confirmPaypalTopup(token, chatId, isEnglish) {
  const db = await getDb();
  const users = db.smm_users || [];
  const user = findUserByChat(users, chatId);
  if (!user || !user.tgTopup || user.tgTopup.step !== 'await_paypal_confirm') {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'Nothing pending — start over with /topup.' : 'چیزی در انتظار نیست — دوباره با /topup شروع کن.' });
    return;
  }
  const topup = user.tgTopup;
  if (Date.now() - topup.ts > PENDING_TTL_MS) {
    user.tgTopup = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This payment request expired — start over with /topup.' : 'این درخواست پرداخت منقضی شد — دوباره با /topup شروع کن.' });
    return;
  }
  const pm = (db.smm_pm || []).find(function (m) { return m.method === 'paypal'; });
  if (!pm || !pm.clientId || !pm.clientSecret) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'PayPal is not configured.' : 'PayPal تنظیم نشده.' });
    return;
  }

  // Same idempotency ledger api/paypal-verify.js writes to — a captured
  // order must only ever be credited once, no matter which path captured it.
  const processed = db.smm_paypal_processed || [];
  if (processed.indexOf(topup.ppOrderId) !== -1) {
    user.tgTopup = null;
    await saveUsers(users);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? 'This payment was already processed.' : 'این پرداخت قبلاً پردازش شده.' });
    return;
  }

  const apiBase = pm.env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  try {
    const accessToken = await paypalToken(pm.clientId, pm.clientSecret, apiBase);
    const captureResp = await fetch(apiBase + '/v2/checkout/orders/' + encodeURIComponent(topup.ppOrderId) + '/capture', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
    });
    const captureJson = await captureResp.json();
    if (!captureResp.ok) {
      const notApproved = Array.isArray(captureJson.details) && captureJson.details.some(function (d) { return d.issue === 'ORDER_NOT_APPROVED'; });
      await tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text: notApproved
          ? (isEnglish ? "⏳ You haven't completed the PayPal payment yet — tap the payment link first, then try again." : '⏳ هنوز پرداخت PayPal را کامل نکردی — اول روی لینک پرداخت بزن، سپس دوباره امتحان کن.')
          : (isEnglish ? '❌ Payment could not be verified. Please try again in a moment.' : '❌ تایید پرداخت ممکن نشد. کمی بعد دوباره امتحان کن.')
      });
      return;
    }
    if (captureJson.status !== 'COMPLETED') {
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ Payment not completed yet. Please finish it in PayPal, then try again.' : '❌ پرداخت هنوز کامل نشده. آن را در PayPal کامل کن و دوباره امتحان کن.' });
      return;
    }
    const unit = captureJson.purchase_units && captureJson.purchase_units[0];
    const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
    const paidAmount = capture && parseFloat(capture.amount.value);
    if (!paidAmount || paidAmount <= 0) {
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ Could not verify the paid amount — contact support with order id: ' + topup.ppOrderId : '❌ تایید مبلغ پرداختی ممکن نشد — با پشتیبانی و این شماره تماس بگیر: ' + topup.ppOrderId });
      return;
    }

    const fee = parseFloat(pm.fee) || 0;
    const feeFixed = parseFloat(pm.feeFixed) || 0;
    const feeAmt = parseFloat((paidAmount * (fee / 100) + feeFixed).toFixed(2));
    const credit = parseFloat((paidAmount - feeAmt).toFixed(2));
    if (credit <= 0) {
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ Payment too small to cover fees — contact support with order id: ' + topup.ppOrderId : '❌ مبلغ برای پوشش کارمزد کافی نیست — با پشتیبانی و این شماره تماس بگیر: ' + topup.ppOrderId });
      return;
    }

    const newBalance = parseFloat(((parseFloat(user.balance) || 0) + credit).toFixed(2));
    user.balance = newBalance;
    user.transactions = user.transactions || [];
    user.transactions.unshift({
      id: Date.now(), type: 'deposit', method: 'PayPal', amount: paidAmount, fee: feeAmt, credit: credit,
      ppOrderId: topup.ppOrderId, desc: 'PayPal (Telegram) — verified and auto-credited', date: new Date().toISOString(), status: 'approved'
    });
    user.tgTopup = null;

    const newProcessed = processed.concat([topup.ppOrderId]);
    if (newProcessed.length > 2000) newProcessed.splice(0, newProcessed.length - 2000);

    await fetchInternal(API_BASE + '/api/db', {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ smm_users: users, smm_paypal_processed: newProcessed, smm_ts: Date.now() })
    });

    await tgApi(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: isEnglish
        ? `✅ <b>Payment confirmed!</b>\n\nPaid: $${paidAmount.toFixed(2)}\nCredited: $${credit.toFixed(2)}\nNew balance: $${newBalance.toFixed(2)}`
        : `✅ <b>پرداخت تایید شد!</b>\n\nمبلغ پرداختی: $${paidAmount.toFixed(2)}\nمبلغ شارژ شده: $${credit.toFixed(2)}\nموجودی جدید: $${newBalance.toFixed(2)}`
    });
    await notifyAdmin(token, `✅ <b>PayPal Top-up via Telegram</b>\n👤 ${escapeHtml(user.fname || user.email || ('User ' + user.id))}\n💵 Paid $${paidAmount.toFixed(2)} → Credited $${credit.toFixed(2)}\nOrder: ${topup.ppOrderId}`);
  } catch (e) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: isEnglish ? '❌ Error verifying the payment — please try again in a moment.' : '❌ خطا در تایید پرداخت — کمی بعد دوباره امتحان کن.' });
  }
}

// Single entry point for every free-text message that might be answering an
// in-progress /buy or /topup flow — one DB read, routed to whichever step
// (if any) is actually pending. Returns false when there's nothing pending
// so the caller falls through to the bot's normal keyword/FAQ replies.
async function maybeHandlePendingFreeText(token, chatId, text, isEnglish) {
  const db = await getDb();
  const users = db.smm_users || [];
  const user = findUserByChat(users, chatId);
  if (!user) return false;
  if (user.tgPending && user.tgPending.step === 'await_qty_link') {
    return handleQtyLinkText(token, chatId, user, users, text, isEnglish);
  }
  if (user.tgTopup && user.tgTopup.step === 'await_amount') {
    if (Date.now() - user.tgTopup.ts > PENDING_TTL_MS) { user.tgTopup = null; await saveUsers(users); return false; }
    await handleTopupAmountText(token, db, chatId, user, users, text, isEnglish);
    return true;
  }
  if (user.tgTopup && user.tgTopup.step === 'await_proof') {
    if (Date.now() - user.tgTopup.ts > PENDING_TTL_MS) { user.tgTopup = null; await saveUsers(users); return false; }
    await handleTopupProofText(token, chatId, user, users, text, isEnglish);
    return true;
  }
  return false;
}

async function handleCallbackQuery(cbq, token) {
  const chatId = (cbq.message && cbq.message.chat && cbq.message.chat.id) || (cbq.from && cbq.from.id);
  const data = cbq.data || '';
  // Best-effort ack so Telegram stops showing a loading spinner on the
  // tapped button — must never block the actual action below.
  try { await tgApi(token, 'answerCallbackQuery', { callback_query_id: cbq.id }); } catch (e) {}
  if (!chatId) return;

  const parts = data.split('|');
  const kind = parts[0];
  const isEnglish = parts[1] === '1';
  if (kind === 'buyp') await showServiceList(token, chatId, parts[2], isEnglish);
  else if (kind === 'buys') await selectService(token, chatId, parts[2], isEnglish);
  else if (kind === 'buyc') await confirmPendingOrder(token, chatId, isEnglish);
  else if (kind === 'buyx') await cancelAnyPending(token, chatId, isEnglish);
  else if (kind === 'tup') await startTopupFlow(token, chatId, isEnglish);
  else if (kind === 'tupm') await selectTopupMethod(token, chatId, parts[2], isEnglish);
  else if (kind === 'tupx') await confirmPaypalTopup(token, chatId, isEnglish);
  else if (kind === 'tupc') await cancelAnyPending(token, chatId, isEnglish);
}

async function lookupOrder(orderId) {
  try {
    const r = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
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
    const cfg = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() }).then(r => r.json());
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
    const r = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await r.json();
    const users = db.smm_users || [];
    const user = users.find(u => u.id && Number(u.id).toString(36).toUpperCase() === code);
    if (!user) return false;
    user.tgChatId = chatId;
    await fetchInternal(API_BASE + '/api/db', {
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
    const r = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
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
    await fetchInternal(API_BASE + '/api/db', {
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

  const token = process.env.TG_BOT_TOKEN || req.query.token;
  if (!token) return res.status(200).send('no token');

  // Inline-keyboard button taps (platform/service pick, order confirm/cancel
  // in the /buy flow below) arrive as their own update type with no
  // `message`/`edited_message` field — handled entirely separately from the
  // plain-text command routing below.
  if (body.callback_query) {
    await handleCallbackQuery(body.callback_query, token);
    return res.status(200).send('ok');
  }

  const msg = body.message || body.edited_message;
  if (!msg) return res.status(200).send('ok');

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const firstName = (msg.from && msg.from.first_name) || 'User';

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

  // Direct-sale flow: /buy walks the customer through picking a platform,
  // then a service, then link+quantity, entirely inside Telegram — see
  // startBuyFlow()/handleCallbackQuery() above. Checked as an exact command
  // (plus a couple of bare trigger words) rather than a substring match, so
  // it can't misfire on unrelated messages that merely contain "buy".
  if (text === '/buy' || lower.trim() === 'خرید' || lower.trim() === 'buy') {
    await startBuyFlow(token, chatId, isEnglish);
    return res.status(200).send('ok');
  }
  // Direct top-up: /topup lets the customer pay from inside the chat (PayPal
  // is captured automatically the moment they confirm; every other
  // configured method logs a pending deposit for the admin to approve, same
  // as the panel's manual "Add Funds" flow) — see startTopupFlow() above.
  if (text === '/topup' || lower.trim() === 'شارژ' || lower.trim() === 'topup' || lower.trim() === 'top up') {
    await startTopupFlow(token, chatId, isEnglish);
    return res.status(200).send('ok');
  }
  if (text === '/cancel') {
    await cancelAnyPending(token, chatId, isEnglish);
    return res.status(200).send('ok');
  }
  if (text === '/balance' || lower.trim() === 'موجودی' || lower.trim() === 'balance') {
    await showBalance(token, chatId, isEnglish);
    return res.status(200).send('ok');
  }
  // Full step-by-step walkthrough for /buy + /topup — separate from /help
  // (which is a one-line command index) since a first-time customer needs
  // the actual sequence of steps and a concrete example, not just a list of
  // slash commands to guess the order of.
  if (text === '/guide' || lower.trim() === 'راهنمای خرید' || lower.trim() === 'guide' || lower.trim() === 'how to buy') {
    await sendMsg(chatId, isEnglish
      ? `🛍️ <b>How to buy — step by step</b>\n\n`
        + `1️⃣ Send /buy\n`
        + `2️⃣ Pick a platform (Instagram, TikTok, YouTube, ...)\n`
        + `3️⃣ Tap a service from the list (price per 1000 is shown)\n`
        + `4️⃣ First time only: if your account isn't linked yet, the bot tells you to open the panel → "Free Likes" → "🔗 Connect Telegram" once\n`
        + `5️⃣ Send the link/username <b>and</b> quantity in one message:\n<code>https://instagram.com/yourpage 1000</code>\n`
        + `6️⃣ Check the summary (service, cost, balance after) and tap ✅ Confirm\n`
        + `7️⃣ Done! You get an order number — track it any time with <code>/order 12345</code>\n\n`
        + `💳 <b>If your balance isn't enough:</b>\n`
        + `1️⃣ Send /topup (or tap "💳 Top up now" when it's offered)\n`
        + `2️⃣ Pick a payment method\n`
        + `3️⃣ Send the amount\n`
        + `4️⃣ PayPal: tap the payment link, pay, come back and tap "✅ I've paid" — credited instantly\n`
        + `   Other methods (Binance Pay/USDT/Hawala): pay to the shown address, then send your transaction ID — an admin approves it shortly\n\n`
        + `🚫 /cancel anytime to abort an order or payment in progress.\n\n`
        + `Need the full list of commands? Send /help.`
      : `🛍️ <b>راهنمای خرید — قدم به قدم</b>\n\n`
        + `1️⃣ دستور /buy را بفرست\n`
        + `2️⃣ پلتفرم را انتخاب کن (اینستاگرام، تیک‌تاک، یوتیوب، ...)\n`
        + `3️⃣ از لیست، روی یک سرویس بزن (قیمت هر ۱۰۰۰ تا نشان داده می‌شود)\n`
        + `4️⃣ فقط بار اول: اگر حسابت به تلگرام وصل نیست، ربات می‌گوید از پنل → «Free Likes» → «🔗 اتصال تلگرام» یک‌بار وصل کن\n`
        + `5️⃣ لینک/یوزرنیم <b>و</b> تعداد را در یک پیام بفرست:\n<code>https://instagram.com/yourpage 1000</code>\n`
        + `6️⃣ خلاصه سفارش (سرویس، هزینه، موجودی بعد از خرید) را چک کن و روی ✅ تایید بزن\n`
        + `7️⃣ تمام! شماره سفارش می‌گیری — هر وقت خواستی با <code>/order 12345</code> پیگیری کن\n\n`
        + `💳 <b>اگر موجودی کافی نبود:</b>\n`
        + `1️⃣ /topup را بفرست (یا دکمه‌ی «💳 شارژ حساب» که نشان داده می‌شود را بزن)\n`
        + `2️⃣ روش پرداخت را انتخاب کن\n`
        + `3️⃣ مبلغ را بفرست\n`
        + `4️⃣ PayPal: روی لینک پرداخت بزن، پرداخت را کامل کن، برگرد و «✅ پرداخت کردم» را بزن — همون لحظه شارژ می‌شود\n`
        + `   بقیه روش‌ها (Binance Pay/USDT/حواله): مبلغ را به آدرس/شناسه‌ی نشان‌داده‌شده واریز کن، سپس شماره تراکنش را بفرست — ادمین به‌زودی تایید می‌کند\n\n`
        + `🚫 هر زمان با /cancel می‌توانی سفارش یا پرداخت نیمه‌کاره را لغو کنی.\n\n`
        + `لیست کامل دستورات را می‌خواهی؟ /help را بفرست.`
    );
    return res.status(200).send('ok');
  }

  // If this chat is mid-/buy or mid-/topup (waiting for "<link> <quantity>",
  // a top-up amount, or manual payment proof), treat any non-command text as
  // that answer — must run before every keyword/FAQ branch below, since a
  // pasted Instagram link, a bare amount, or a non-numeric transaction
  // reference would otherwise get swallowed by a generic FAQ reply further
  // down instead of being read as real input. No cheap digit-based
  // pre-filter here (unlike an earlier version of this check) — a manual
  // payment reference isn't guaranteed to contain a digit at all, so
  // skipping the DB lookup for text without one would silently drop it.
  if (!text.startsWith('/')) {
    const handledPending = await maybeHandlePendingFreeText(token, chatId, text, isEnglish);
    if (handledPending) return res.status(200).send('ok');
  }

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
      ? `👋 Hi ${firstName}!\n\nWelcome to the <b>Afghan Followers</b> panel.\n\n🌐 Site: ${SITE}\n\nUseful commands:\n📖 /guide - step-by-step buying guide\n🛒 /buy - order a service right here\n💳 /topup - add funds right here (PayPal, Binance Pay, USDT, Hawala)\n💰 /balance - check your wallet balance\n/help - help\n/panel - open the panel\n/services - service list\n/order [number] - order status\n/ticket [message] - open a support ticket\n/support - support\n\n🎁 Tip: ask me "free likes" to find out how to get free likes just by inviting friends.`
      : `👋 سلام ${firstName}!\n\nبه پنل <b>Afghan Followers</b> خوش آمدید.\n\n🌐 سایت: ${SITE}\n\nبرای دریافت کمک از دستورات زیر استفاده کنید:\n📖 /guide - راهنمای قدم‌به‌قدم خرید\n🛒 /buy - سفارش مستقیم همین‌جا\n💳 /topup - شارژ مستقیم همین‌جا (PayPal، Binance Pay، USDT، حواله)\n💰 /balance - مشاهده موجودی کیف پول\n/help - راهنما\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره] - وضعیت سفارش\n/ticket [پیام] - باز کردن تیکت پشتیبانی\n/support - پشتیبانی\n\n🎁 نکته: بپرس «لایک رایگان» تا بگم چطور فقط با دعوت دوستات لایک رایگان بگیری.`;
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
      ? `📋 <b>Help</b>\n\n📖 /guide - full step-by-step buying guide (start here if you're new)\n🛒 /buy - order a service right here (pick platform → service → send link + quantity → confirm)\n💳 /topup - add funds right here — PayPal is credited instantly, other methods are verified by an admin\n💰 /balance - check your wallet balance\n/cancel - abort an in-progress order or payment\n/panel - open the panel\n/services - service list\n/order [order number] - order status\n/ticket [message] - open a support ticket\n/prices - pricing\n/support - support\n\n🎁 Ask "free likes" any time to learn about our invite-and-earn program.\n\n💬 Contact admin for support.`
      : `📋 <b>راهنما</b>\n\n📖 /guide - راهنمای کامل قدم‌به‌قدم خرید (اگه تازه‌کاری از اینجا شروع کن)\n🛒 /buy - سفارش مستقیم همین‌جا (پلتفرم → سرویس → ارسال لینک و تعداد → تایید)\n💳 /topup - شارژ مستقیم همین‌جا — PayPal فوری اعمال می‌شود، بقیه روش‌ها توسط ادمین تایید می‌شوند\n💰 /balance - مشاهده موجودی کیف پول\n/cancel - لغو سفارش یا پرداخت نیمه‌کاره\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/order [شماره سفارش] - وضعیت سفارش\n/ticket [پیام] - باز کردن تیکت پشتیبانی\n/prices - قیمت‌ها\n/support - پشتیبانی\n\n🎁 هر وقت خواستی بپرس «لایک رایگان» تا برنامه‌ی دعوت و جایزه رو برات توضیح بدم.\n\n💬 برای پشتیبانی با ادمین تماس بگیرید.`;
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
