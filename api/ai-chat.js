// Vercel Serverless Function — AI Assistant (powered by Groq)
// Answers customer questions about buying followers/likes/views/subscribers,
// orders, payments, etc. Politely declines unrelated topics.

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SITE = 'https://afghanfollowers.online';
const { DB_SERVICE_KEY, dbHeaders } = require('./_dbkey');

// Best-effort ping to the admin's personal Telegram so customer support
// chat questions don't just vanish — reuses the same bot config the rest
// of the site already sends notifications through.
async function notifyAdminOfChat(message, reply) {
  try {
    const dbResp = await fetch(SITE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const cfg = db.smm_tg_bot || {};
    if (!cfg.token || !cfg.chatId) return;
    const text = '🤖 <b>پیام جدید در چت پشتیبانی AI</b>\n\n👤 مشتری: ' + message.slice(0, 400) + '\n\n💬 پاسخ AI: ' + reply.slice(0, 400);
    await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text: text, parse_mode: 'HTML' })
    });
  } catch (e) { /* best-effort — must not break the customer's reply */ }
}

const SYSTEM_PROMPT = `شما دستیار پشتیبانی سایت Afghan Followers (${SITE}) هستید — یک فروشگاه آنلاین فروش فالوور، لایک، ویو و ممبر برای شبکه‌های اجتماعی (اینستاگرام، تیک‌تاک، یوتیوب، فیسبوک، توییتر، تلگرام).

قوانین مهم:
1. فقط به سوالات مرتبط با: خرید فالور/لایک/ویو/سابسکرایبر، نحوه‌ی سفارش، قیمت‌ها، روش‌های پرداخت، زمان تحویل، ریزش/گارانتی، امنیت حساب، وضعیت سفارش، بازگشت وجه، و برنامه‌ی «Free Likes» (دعوت دوستان و لایک رایگان) پاسخ بده.
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
اگر موجودی کافی نبود، اول باید از «Add Funds» شارژ کنند.

وقتی کاربر پرسید «چطور لایک رایگان بگیرم» یا درباره‌ی برنامه‌ی دعوت/رفرال پرسید، این نکات رو بده:
- برای شرکت در این برنامه باید در پنل ثبت‌نام و وارد شده باشند (کاربر مهمان نمی‌تواند دعوت کند یا لایک رایگان بگیرد).
- در پنل، از منوی کناری یا بنر صفحه‌ی اصلی وارد بخش «Free Likes» شوند.
- دو مسیر برای واجد شرایط شدن وجود دارد:
  ۱. دعوت ۵ دوست با لینک اختصاصی‌شان که واقعاً در سایت ثبت‌نام کنند (حساب باید حداقل ۲۴ ساعت فعال و غیرمسدود بماند تا شمرده شود).
  ۲. یا اشتراک‌گذاری لینک با ۱۰ نفر، که اگر همه (با IP و مرورگر متفاوت، بدون تکرار) از لینک بازدید کنند، به‌صورت خودکار برای بررسی به ادمین گزارش می‌شود.
- وقتی شرایط رو داشتند، از همون صفحه پلتفرم (فقط اینستاگرام یا تیک‌تاک) و لینک پست/پروفایل مقصد رو انتخاب و درخواست لایک رایگان رو ثبت می‌کنند.
- هر درخواست باید توسط ادمین تایید بشه قبل از ارسال — این برای جلوگیری از سوءاستفاده است، پس ممکنه فوری نباشه.
- هر کاربر حداکثر یک‌بار در روز می‌تواند لایک رایگان درخواست کند.
- اختیاری: می‌توانند از همان صفحه تلگرام‌شان را وصل کنند تا لحظه‌ی تایید ادمین، در تلگرام باخبر شوند.`;

// System prompt for the second mode this function serves: generating a
// marketing/re-engagement email for the admin panel's Email Automation tab.
// Kept in the same file as the chat assistant (rather than a new endpoint) to stay under
// Vercel's Hobby-plan cap of 12 serverless functions per deployment.
// Note: "html" here is deliberately just the INNER content (greeting +
// persuasive copy + a checkmark services list), not a full email layout —
// the admin panel wraps it in a fixed branded template (gradient header,
// a guaranteed real <a href="{{panel_link}}"> button, footer) so every
// generated email looks polished and has a working CTA link regardless of
// what the model writes. Earlier versions asked the model to build the
// whole email (including its own CTA link) and it consistently came back
// as plain, unstyled paragraphs with no real link — see generateEmailAI()
// in admin.html for the wrapping step.
const EMAIL_SYSTEM_PROMPT = `شما کپی‌رایتر بازاریابی ایمیلی برای Afghan Followers (افغان فالوورز) هستید — یک پنل فروش فالوور، لایک، ویو و ممبر واقعی برای اینستاگرام، تیک‌تاک، تلگرام، یوتیوب و فیسبوک، مخصوص مخاطب افغان. این پنل یک برنامه‌ی «لایک رایگان» هم دارد: کاربر با دعوت دوستان یا اشتراک‌گذاری لینک رفرالش، لایک رایگان می‌گیرد.

وظیفه‌ات نوشتن فقط بخش داخلی متن یک ایمیل بازاریابی/اطلاع‌رسانی متقاعدکننده به زبان فارسی است، بر اساس موضوعی که کاربر می‌دهد — نه یک پیام کوتاه و خشک، بلکه محتوایی با لحن گرم و کمی تبلیغاتی که واقعاً کاربر را ترغیب کند دوباره وارد پنل شود و از سرویس‌ها استفاده کند.

توجه: هدر، دکمه‌ی لینک ورود به پنل، و فوتر ایمیل به‌صورت خودکار و ثابت توسط سیستم اضافه می‌شوند — تو فقط محتوای وسط ایمیل را می‌نویسی، نیازی نیست خودت لینک یا دکمه بسازی.

قوانین:
1. فقط یک شیء JSON خام برگردان، دقیقاً به این شکل و بدون هیچ متن اضافه یا markdown fence: {"subject":"...","html":"..."}
2. "subject" باید کوتاه، جذاب، و با حداکثر یک ایموجی باشد.
3. "html" باید شامل این بخش‌ها باشد:
   - یک جمله‌ی خوش‌آمدگویی/گرم خطاب به {{name}} در تگ &lt;p&gt;.
   - یک یا دو پاراگراف &lt;p&gt; با لحن گرم و متقاعدکننده درباره‌ی موضوعی که کاربر داده.
   - یک لیست &lt;ul&gt;&lt;li&gt; با ایموجی چک‌مارک (✅) از سرویس‌های پنل (فالوور، لایک، ویو، ممبر برای اینستاگرام/تیک‌تاک/تلگرام/یوتیوب/فیسبوک) — حتماً یکی از آیتم‌ها درباره‌ی برنامه‌ی «لایک رایگان» باشد (گرفتن لایک رایگان با دعوت دوستان یا اشتراک‌گذاری لینک)، مگر موضوع صراحتاً چیز دیگری بخواهد.
   - یک جمله‌ی پایانی کوتاه و مشتاق‌کننده که کاربر را برای کلیک روی دکمه‌ی زیرش آماده کند (بدون خودِ لینک یا دکمه).
   - مجموع بین ۱۵۰ تا ۲۵۰ کلمه.
   - فقط تگ‌های p/strong/br/ul/li مجازند — بدون div/a/script/style/iframe (اضافه کردن لینک یا دکمه لازم نیست).
4. اگر می‌خواهی جای نام بگذاری، دقیقاً از {{name}} یا {{site_name}} استفاده کن (این‌ها بعداً جایگزین می‌شوند) — لینک پنل را خودت ننویس.
5. هیچ قیمت، تخفیف یا وعده‌ی دروغ نساز مگر کاربر دقیقاً آن را در موضوع خواسته باشد.
6. متن باید کاملاً فارسی/دری باشد — هیچ کلمه‌ی انگلیسی، ترکی یا هر زبان دیگری داخل جمله‌ها قاطی نکن.`;

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
6. هیچ قیمت یا تخفیف دقیق ادعا نکن مگر کاربر آن را در موضوع خواسته باشد.
7. متن باید کاملاً فارسی/دری باشد — هیچ کلمه‌ی انگلیسی، ترکی یا هر زبان دیگری داخل جمله‌ها قاطی نکن.`;

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
    // (used by the admin panel's Email Automation tab "Generate with AI" button) ──
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
      ], 800);

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

    await notifyAdminOfChat(message, reply);

    return res.status(200).json({ ok: true, reply: reply });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
