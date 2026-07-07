// api/auto-post.js
// سیستم پست خودکار — فیسبوک + تلگرام + هوش مصنوعی Groq
// هر روز توسط Vercel Cron اجرا می‌شود

export default async function handler(req, res) {
  const results = { facebook: null, telegram: null };

  try {
    // ----- ۱) تعیین نوع پست: روزهای زوج تبلیغ، روزهای فرد گیمینگ -----
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
    );
    const isPromoDay = dayOfYear % 2 === 0;

    const promoPrompt = `یک پست تبلیغاتی کوتاه و جذاب به زبان فارسی/دری بنویس برای یکی از این دو سرویس (خودت یکی را انتخاب کن):
1. AfghanCoins (afghancoins.online) — فروش یوسی پابجی، جم فری‌فایر، الماس موبایل لجندز با قیمت مناسب و تحویل فوری
2. AfghanFollowers (afghanfollowers.online) — خرید فالوور، لایک و ویو برای انستاگرام، تیک‌تاک، یوتیوب و تلگرام

قوانین:
- حداکثر ۶ خط
- با ایموجی‌های مناسب
- در آخر آدرس سایت و ۳-۴ هشتگ فارسی
- فقط متن پست را بنویس، هیچ توضیح اضافه نده`;

    const gamingPrompt = `یک پست کوتاه و جذاب به زبان فارسی/دری درباره دنیای گیمینگ بنویس. خودت یکی از این موضوع‌ها را انتخاب کن:
- ترفند یا نکته مفید برای PUBG Mobile یا Free Fire یا Mobile Legends
- معرفی یک قابلیت یا آپدیت جالب بازی‌های موبایل
- نکته جالب و دانستنی از دنیای گیم

قوانین:
- حداکثر ۶ خط
- با ایموجی‌های مناسب
- در آخر بنویس: 🎮 خرید یوسی و جم با بهترین قیمت: afghancoins.online
- ۳-۴ هشتگ فارسی
- فقط متن پست را بنویس، هیچ توضیح اضافه نده`;

    // ----- ۲) تولید متن پست با Groq -----
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "user", content: isPromoDay ? promoPrompt : gamingPrompt },
        ],
        temperature: 0.9,
        max_tokens: 500,
      }),
    });

    const groqData = await groqResp.json();
    const postText = groqData?.choices?.[0]?.message?.content?.trim();

    if (!postText) {
      throw new Error("Groq هیچ متنی تولید نکرد: " + JSON.stringify(groqData));
    }

    // ----- ۳) پست به فیسبوک -----
    if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
      const fbResp = await fetch(
        `https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: postText,
            access_token: process.env.FB_PAGE_TOKEN,
          }),
        }
      );
      const fbData = await fbResp.json();
      results.facebook = fbData.id
        ? "✅ موفق: " + fbData.id
        : "❌ خطا: " + JSON.stringify(fbData.error || fbData);
    } else {
      results.facebook = "⏭ تنظیم نشده";
    }

    // ----- ۴) پست به کانال تلگرام -----
    if (process.env.TG_BOT_TOKEN && process.env.TG_CHANNEL) {
      const tgResp = await fetch(
        `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TG_CHANNEL,
            text: postText,
          }),
        }
      );
      const tgData = await tgResp.json();
      results.telegram = tgData.ok
        ? "✅ موفق"
        : "❌ خطا: " + JSON.stringify(tgData);
    } else {
      results.telegram = "⏭ تنظیم نشده";
    }

    // ----- ۵) گزارش به ادمین (پیام خصوصی تلگرام) -----
    if (process.env.TG_BOT_TOKEN) {
      await fetch(
        `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: "7993801735",
            text:
              `📢 گزارش پست خودکار (${isPromoDay ? "تبلیغ" : "گیمینگ"})\n\n` +
              `فیسبوک: ${results.facebook}\n` +
              `تلگرام: ${results.telegram}\n\n` +
              `متن پست:\n${postText}`,
          }),
        }
      );
    }

    return res.status(200).json({ ok: true, type: isPromoDay ? "promo" : "gaming", results, post: postText });
  } catch (err) {
    // گزارش خطا به ادمین
    try {
      if (process.env.TG_BOT_TOKEN) {
        await fetch(
          `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: "7993801735",
              text: "❌ خطا در پست خودکار:\n" + err.message,
            }),
          }
        );
      }
    } catch (_) {}
    return res.status(500).json({ ok: false, error: err.message, results });
  }
}
