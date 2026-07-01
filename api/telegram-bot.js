// Vercel Serverless Function — Telegram Bot webhook handler
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

  if (text === '/start') {
    reply = `👋 سلام ${firstName}!\n\nبه پنل <b>Afghan Followers</b> خوش آمدید.\n\n🌐 سایت: https://afghanfollowers.online\n\nبرای دریافت کمک از دستورات زیر استفاده کنید:\n/help - راهنما\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/support - پشتیبانی`;
  } else if (text === '/help' || lower.includes('help') || lower.includes('کمک')) {
    reply = `📋 <b>راهنما</b>\n\n/panel - ورود به پنل\n/services - لیست سرویس‌ها\n/prices - قیمت‌ها\n/support - پشتیبانی\n\n💬 برای پشتیبانی با ادمین تماس بگیرید.`;
  } else if (text === '/panel') {
    reply = `🔗 <b>لینک پنل</b>\n\nhttps://afghanfollowers.online\n\nبرای ورود ثبت نام کنید یا لاگین کنید.`;
  } else if (text === '/services' || lower.includes('service') || lower.includes('سرویس')) {
    reply = `📦 <b>سرویس‌های ما</b>\n\n✅ Instagram Followers\n✅ TikTok Likes\n✅ YouTube Views\n✅ Telegram Members\n✅ Facebook Likes\n✅ Twitter Followers\n\n🌐 برای سفارش: https://afghanfollowers.online`;
  } else if (text === '/support' || lower.includes('support') || lower.includes('پشتیبانی') || lower.includes('problem') || lower.includes('مشکل')) {
    reply = `🆘 <b>پشتیبانی</b>\n\nبرای رفع مشکل:\n1. وارد پنل شوید\n2. بخش Tickets را باز کنید\n3. تیکت جدید ارسال کنید\n\n🌐 https://afghanfollowers.online\n\nادمین در اسرع وقت پاسخ می‌دهد.`;
  } else if (lower.includes('price') || lower.includes('قیمت') || lower.includes('cost') || lower.includes('هزینه')) {
    reply = `💰 <b>قیمت‌ها</b>\n\nقیمت‌ها بر اساس نوع سرویس متفاوت است.\n\n👉 برای مشاهده قیمت دقیق:\nhttps://afghanfollowers.online\n\nبخش Services را باز کنید.`;
  } else if (lower.includes('payment') || lower.includes('پرداخت') || lower.includes('pay')) {
    reply = `💳 <b>روش‌های پرداخت</b>\n\n✅ PayPal\n✅ Binance Pay\n✅ USDT (TRC20)\n✅ Hawala / Cash\n\n🌐 https://afghanfollowers.online/smm-panel.html`;
  } else if (lower.includes('instagram') || lower.includes('insta')) {
    reply = `📸 <b>Instagram Services</b>\n\n✅ Real Followers\n✅ Likes\n✅ Views\n✅ Comments\n\n💰 از $0.001/unit\n🌐 https://afghanfollowers.online`;
  } else if (lower.includes('tiktok')) {
    reply = `🎵 <b>TikTok Services</b>\n\n✅ Followers\n✅ Likes\n✅ Views\n✅ Comments\n\n💰 از $0.001/unit\n🌐 https://afghanfollowers.online`;
  } else {
    reply = `👋 سلام ${firstName}!\n\nممنون از پیام شما.\n\nبرای کمک:\n/help - راهنما\n/support - پشتیبانی\n\n🌐 https://afghanfollowers.online`;
  }

  if (reply) {
    await sendMsg(chatId, reply);
  }

  return res.status(200).send('ok');
};
