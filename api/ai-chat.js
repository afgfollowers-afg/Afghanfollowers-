// Vercel Serverless Function — AI Assistant (powered by Groq)
// Answers customer questions about buying followers/likes/views/subscribers,
// orders, payments, etc. Politely declines unrelated topics.

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SITE = 'https://afghanfollowers.online';

const SYSTEM_PROMPT = `شما دستیار پشتیبانی سایت Afghan Followers (${SITE}) هستید — یک فروشگاه آنلاین فروش فالوور، لایک، ویو و ممبر برای شبکه‌های اجتماعی (اینستاگرام، تیک‌تاک، یوتیوب، فیسبوک، توییتر، تلگرام).

قوانین مهم:
1. فقط به سوالات مرتبط با: خرید فالور/لایک/ویو/سابسکرایبر، نحوه‌ی سفارش، قیمت‌ها، روش‌های پرداخت، زمان تحویل، ریزش/گارانتی، امنیت حساب، وضعیت سفارش، و بازگشت وجه پاسخ بده.
2. اگر سوال کاملاً بی‌ربط بود (مثلاً سوالات عمومی، برنامه‌نویسی، سیاسی، شخصی)، مؤدبانه بگو که فقط می‌تونی درباره‌ی خدمات این سایت کمک کنی و اونا رو به تیکت انسانی (/ticket یا فرم تیکت سایت) هدایت کن.
3. پاسخ‌ها رو کوتاه، دوستانه و به زبان فارسی بده (مگر کاربر انگلیسی بنویسه).
4. هیچ‌وقت پسورد یا اطلاعات ورود درخواست نکن — ما هرگز پسورد نمی‌خوایم.
5. اگه از وضعیت سفارش خاصی پرسیدن، بگو باید وارد پنل بشن و تو صفحه‌ی My Orders چک کنن، یا شماره سفارش رو به پشتیبانی انسانی (تیکت) بدن.
6. اگه سوال خیلی پیچیده یا نیاز به بررسی حساب داره، پیشنهاد بده یه تیکت پشتیبانی واقعی ثبت کنن.

اطلاعات کلی سایت:
- روش‌های پرداخت: PayPal، Binance Pay، USDT (TRC20)، حواله/نقدی
- اکثر سفارش‌ها ظرف چند دقیقه تا چند ساعت شروع میشن
- بعضی سرویس‌ها گارانتی Refill (30/60/365 روزه یا مادام‌العمر) دارن
- فقط لینک یا یوزرنیم عمومی حساب لازمه، نه پسورد
- حساب باید Public باشه، نه Private`;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = (body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-6) : []; // last 6 messages for context

    if (!message) return res.status(200).json({ ok: false, error: 'No message provided' });
    if (!GROQ_API_KEY) return res.status(200).json({ ok: false, error: 'AI assistant not configured (GROQ_API_KEY missing).' });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: message }
    ];

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.4,
        max_tokens: 400
      })
    });

    const groqData = await groqResp.json();
    if (!groqResp.ok) {
      return res.status(200).json({ ok: false, error: 'Groq API error: ' + JSON.stringify(groqData) });
    }

    const reply = groqData.choices && groqData.choices[0] && groqData.choices[0].message && groqData.choices[0].message.content;
    if (!reply) return res.status(200).json({ ok: false, error: 'No reply from AI' });

    return res.status(200).json({ ok: true, reply: reply.trim() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
