// api/auto-post.js
// سیستم پست خودکار — فیسبوک + تلگرام + هوش مصنوعی Groq
// هر روز توسط Vercel Cron اجرا می‌شود

export default async function handler(req, res) {
  const results = { facebook: null, telegram: null };
  const isDryRun = req.query?.dryrun === "1" || req.query?.dryrun === "true";

  try {
    // ----- ۱) تعیین نوع پست: روزهای زوج تبلیغ مستقیم، روزهای فرد محتوای آموزشی -----
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
    );
    const isPromoDay = dayOfYear % 2 === 0;

    const promoPrompt = `یک پست تبلیغاتی کوتاه و جذاب فقط درباره AfghanFollowers بنویس.

AfghanFollowers (afghanfollowers.online) — خرید فالوور واقعی، لایک و ویو برای انستاگرام، تیک‌تاک، یوتیوب و تلگرام. قیمت مناسب، تحویل سریع، پشتیبانی ۲۴ ساعته.

قوانین نوشتن:
- کاملاً به زبان فارسی/دری بنویس — هیچ کلمه انگلیسی نگذار (نام پلتفورم‌ها مثل انستاگرام، تیک‌تاک، یوتیوب، تلگرام را به فارسی بنویس)
- حداکثر ۶ خط
- با ایموجی‌های مناسب
- در آخر فقط این آدرس: afghanfollowers.online
- ۳ هشتگ فارسی
- فقط متن پست را بنویس، هیچ توضیح اضافه نده`;

    const gamingPrompt = `یک پست آموزشی کوتاه و جذاب درباره رشد در شبکه‌های اجتماعی بنویس. یکی از این موضوع‌ها را انتخاب کن:
- چطور تعداد فالوور انستاگرام را زیاد کنیم
- نکات مهم برای وایرال شدن در تیک‌تاک
- چطور بازدید یوتیوب را افزایش دهیم
- راه‌های افزایش ممبر کانال تلگرام

قوانین نوشتن:
- کاملاً به زبان فارسی/دری بنویس — هیچ کلمه انگلیسی نگذار (نام پلتفورم‌ها را به فارسی: انستاگرام، تیک‌تاک، یوتیوب، تلگرام)
- حداکثر ۶ خط
- با ایموجی‌های مناسب
- در آخر بنویس: 📲 فالوور و لایک واقعی: afghanfollowers.online
- ۳ هشتگ فارسی
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
          {
            role: "system",
            content: "تو یک نویسنده محتوای فارسی/دری هستی. فقط و فقط از حروف فارسی/دری بنویس. هرگز از حروف چینی، انگلیسی، عربی یا هر زبان دیگری استفاده نکن. خروجی باید ۱۰۰٪ فارسی/دری باشد. فقط استثنا: آدرس سایت afghanfollowers.online و هشتگ‌های فارسی.",
          },
          { role: "user", content: isPromoDay ? promoPrompt : gamingPrompt },
        ],
        temperature: 0.9,
        max_tokens: 500,
      }),
    });

    const groqData = await groqResp.json();
    const rawText = groqData?.choices?.[0]?.message?.content?.trim();

    if (!rawText) {
      throw new Error("Groq هیچ متنی تولید نکرد: " + JSON.stringify(groqData));
    }

    // پاک‌سازی کاراکترهای غیرفارسی (چینی، لاتین و غیره)
    // نگه داشتن: فارسی/عربی (۰۶۰۰-۰۶FF)، ایموجی، فاصله، خط جدید، علائم نگارشی، آدرس سایت و هشتگ
    const postText = rawText
      .split('\n')
      .map(line => {
        // خطوطی که آدرس سایت دارند را دست نزن
        if (/afghanfollowers\.online/.test(line)) return line;
        // حذف کاراکترهای چینی، ژاپنی، کره‌ای و لاتین از بقیه خطوط
        return line.replace(/[一-鿿㐀-䶿　-〿가-힯A-za-z]/g, '').trim();
      })
      .filter(line => line.length > 0)
      .join('\n');

    if (!postText.trim()) {
      throw new Error("متن پس از پاک‌سازی خالی شد — خروجی Groq: " + rawText.slice(0, 200));
    }

    // ----- ۲.۵) حالت آزمایشی (dry run): فقط پیش‌نمایش به ادمین، هیچ انتشاری انجام نمی‌شود -----
    if (isDryRun) {
      if (process.env.TG_BOT_TOKEN) {
        await fetch(
          `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: "7993801735",
              text:
                `🧪 DRY RUN — پیش‌نمایش پست خودکار (${isPromoDay ? "تبلیغ" : "آموزشی"})\n` +
                `هیچ‌چیز منتشر نشد (نه فیسبوک، نه کانال تلگرام).\n\n` +
                `متن پست:\n${postText}`,
            }),
          }
        );
      }
      return res.status(200).json({
        ok: true,
        dryRun: true,
        type: isPromoDay ? "promo" : "educational",
        post: postText,
      });
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
              `📢 گزارش پست خودکار (${isPromoDay ? "تبلیغ" : "آموزشی"})\n\n` +
              `فیسبوک: ${results.facebook}\n` +
              `تلگرام: ${results.telegram}\n\n` +
              `متن پست:\n${postText}`,
          }),
        }
      );
    }

    return res.status(200).json({ ok: true, type: isPromoDay ? "promo" : "educational", results, post: postText });
  } catch (err) {
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
