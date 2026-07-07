// Vercel Serverless Function — AI Assistant (powered by Groq)
// Answers customer questions about buying followers/likes/views/subscribers,
// orders, payments, etc. Politely declines unrelated topics.

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SITE = 'https://afghanfollowers.online';
const { DB_SERVICE_KEY } = require('./_dbkey');

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

// System prompt for the second mode this function serves: generating a
// marketing/re-engagement email for email-automation.html. Kept in the same
// file as the chat assistant (rather than a new endpoint) to stay under
// Vercel's Hobby-plan cap of 12 serverless functions per deployment.
const EMAIL_SYSTEM_PROMPT = `شما کپی‌رایتر بازاریابی ایمیلی برای Afghan Followers (افغان فالوورز) هستید — یک پنل فروش فالوور، لایک، ویو و ممبر شبکه‌های اجتماعی (اینستاگرام، تیک‌تاک، تلگرام، یوتیوب، فیسبوک) در افغانستان.

وظیفه‌ات نوشتن متن یک ایمیل بازاریابی/اطلاع‌رسانی کوتاه، جذاب و دوستانه به زبان فارسی است، بر اساس موضوعی که کاربر می‌دهد.

قوانین:
1. فقط یک شیء JSON خام برگردان، دقیقاً به این شکل و بدون هیچ متن اضافه یا markdown fence: {"subject":"...","html":"..."}
2. "subject" باید کوتاه، جذاب، و با حداکثر یک ایموجی باشد.
3. "html" باید HTML ساده و امن باشد (فقط تگ‌های div/p/strong/br/a/ul/li — بدون script/style/iframe)، حداکثر ۱۲۰ کلمه، لحن گرم و صمیمی.
4. اگر می‌خواهی جای نام یا لینک بگذاری، دقیقاً از {{name}}، {{site_name}} یا {{panel_link}} استفاده کن (این‌ها بعداً جایگزین می‌شوند).
5. هیچ قیمت، تخفیف یا وعده‌ی دروغ نساز مگر کاربر دقیقاً آن را در موضوع خواسته باشد.`;

// System prompt for the third mode: writing a short SEO blog post about
// growing Instagram/TikTok followers, for the daily content cron
// (sync-orders.js?job=daily-content). Same reasoning as EMAIL_SYSTEM_PROMPT
// for staying in this file instead of a new endpoint.
const BLOG_SYSTEM_PROMPT = `شما نویسنده‌ی محتوای وبلاگ برای Afghan Followers (افغان فالوورز) هستید — پنل فروش فالوور، لایک و ویو اینستاگرام و تیک‌تاک، عمدتاً برای مخاطب افغان.

وظیفه‌ات نوشتن یک مقاله‌ی کوتاه وبلاگی، مفید و واقعی (نه تبلیغاتی صرف) درباره‌ی موضوعی است که کاربر می‌دهد — معمولاً نکات رشد ارگانیک اینستاگرام یا تیک‌تاک.

قوانین:
1. فقط یک شیء JSON خام برگردان، دقیقاً به این شکل و بدون هیچ متن اضافه یا markdown fence: {"title":"...","excerpt":"...","html":"...","emoji":"..."}
2. "title" کوتاه و جذاب (حداکثر ۱۰ کلمه)، بدون ایموجی.
3. "excerpt" یک خط خلاصه (حداکثر ۲۵ کلمه).
4. "html" باید ۲۵۰ تا ۴۰۰ کلمه باشد، شامل حداقل یک &lt;h2&gt; و چند &lt;p&gt;، نکات عملی و واقعی بدهد (نه ادعای غیرواقعی مثل "فالوور رایگان نامحدود"). فقط تگ‌های p/strong/br/a/ul/li/h2/h3 مجازند — بدون script/style/iframe.
5. "emoji" یک ایموجی مرتبط با موضوع.
6. هیچ قیمت یا تخفیف دقیق ادعا نکن مگر کاربر آن را در موضوع خواسته باشد.`;

async function callGroq(messages, maxTokens) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.6,
      max_tokens: maxTokens
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('Groq API error: ' + JSON.stringify(data));
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('No reply from AI');
  return content.trim();
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!GROQ_API_KEY) return res.status(200).json({ ok: false, error: 'AI assistant not configured (GROQ_API_KEY missing).' });

    // ── Mode 2: generate an email subject+body from a short topic brief
    // (used by email-automation.html's "Generate with AI" button) ──
    if (body.mode === 'generate_email') {
      // Admin-only mode — must not be usable by anonymous visitors who find it,
      // since it burns the same Groq quota shared with the public chat widget.
      if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const topic = (body.topic || '').trim();
      if (!topic) return res.status(200).json({ ok: false, error: 'No topic provided' });

      const raw = await callGroq([
        { role: 'system', content: EMAIL_SYSTEM_PROMPT },
        { role: 'user', content: topic }
      ], 500);

      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim());
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'AI returned invalid format, try again' });
      }
      if (!parsed.subject || !parsed.html) {
        return res.status(200).json({ ok: false, error: 'AI response missing subject/html' });
      }
      return res.status(200).json({ ok: true, subject: parsed.subject, html: parsed.html });
    }

    // ── Mode 3: generate a blog post from a short topic brief (used by the
    // daily content cron, and reusable from admin.html for manual drafts) ──
    if (body.mode === 'generate_blog') {
      if (DB_SERVICE_KEY && req.headers['x-db-key'] !== DB_SERVICE_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const topic = (body.topic || '').trim();
      if (!topic) return res.status(200).json({ ok: false, error: 'No topic provided' });

      const raw = await callGroq([
        { role: 'system', content: BLOG_SYSTEM_PROMPT },
        { role: 'user', content: topic }
      ], 900);

      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim());
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'AI returned invalid format, try again' });
      }
      if (!parsed.title || !parsed.html) {
        return res.status(200).json({ ok: false, error: 'AI response missing title/html' });
      }
      return res.status(200).json({ ok: true, title: parsed.title, excerpt: parsed.excerpt || '', html: parsed.html, emoji: parsed.emoji || '📝' });
    }

    // ── Mode 1 (default): customer support chat reply ──
    const message = (body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-6) : []; // last 6 messages for context
    if (!message) return res.status(200).json({ ok: false, error: 'No message provided' });

    const reply = await callGroq([
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: message }
    ], 400);

    return res.status(200).json({ ok: true, reply: reply });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
