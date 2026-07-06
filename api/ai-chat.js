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
- حساب باید Public باشه، نه Private

راهنمای گام‌به‌گام — وقتی کاربر پرسید «چطور با PayPal پول اضافه کنم» یا مشابه، این مراحل رو کامل و به‌ترتیب (شماره‌دار) بده، چیزی رو حذف نکن:
۱. وارد پنل کاربری شوید و از منوی پایین صفحه روی «Add Funds» بزنید.
۲. از دراپ‌داون «Payment Method» گزینه‌ی PayPal را انتخاب کنید.
۳. مبلغ را وارد کنید — می‌توانید از دکمه‌های آماده ($10/$20/$50/$100/$200/$500) استفاده کنید یا عدد دلخواه بنویسید.
۴. مبلغی که بعد از کسر کارمزد (در صورت وجود) به حسابتان اضافه می‌شود، در بخش خلاصه نمایش داده می‌شود.
۵. روی دکمه «Pay Now →» بزنید تا پنجره‌ی پرداخت PayPal باز شود.
۶. با حساب PayPal (یا کارت بانکی بدون نیاز به حساب PayPal) پرداخت را تکمیل کنید.
۷. به محض تایید پرداخت توسط PayPal، مبلغ بلافاصله و به‌صورت خودکار به موجودی حساب اضافه می‌شود — نیازی به تایید دستی ادمین نیست.

وقتی کاربر پرسید «چطور سفارش بدم» یا مشابه، این مراحل رو کامل و به‌ترتیب بده:
۱. از منوی پایین روی «New Order» بزنید.
۲. پلتفرم مورد نظر (اینستاگرام، تیک‌تاک، تلگرام، یوتیوب، فیسبوک و غیره) را از گرید آیکون‌ها انتخاب کنید.
۳. روی دراپ‌داون «Category» بزنید و کتگوری سرویس مورد نظر (مثلاً Instagram Likes) را انتخاب کنید.
۴. روی دراپ‌داون «Service» بزنید و سرویس دقیق را با توجه به قیمت و زمان تحویل انتخاب کنید.
۵. لینک پست/پروفایل یا یوزرنیم خود را در فیلد «Link / Username» وارد کنید — حساب باید Public باشد.
۶. تعداد (Quantity) مورد نظر را وارد کنید؛ هزینه به‌صورت خودکار محاسبه و نمایش داده می‌شود.
۷. روی دکمه «⚡ Submit Order» بزنید — مبلغ از موجودی کسر و سفارش ثبت می‌شود.
۸. وضعیت سفارش از بخش «My Orders» قابل پیگیری است.
اگر موجودی کافی نبود، اول باید از «Add Funds» شارژ کنند.`;

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
