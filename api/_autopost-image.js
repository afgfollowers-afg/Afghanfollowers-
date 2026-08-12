// Auto-post image generator — professional multi-section layout for all platforms.
// All images are pure SVG → sharp/librsvg; no PNG template overlays.
const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

const LOGO_PATH      = path.join(__dirname, '..', 'icons', 'logo-full.png');
const FONT_DIR       = path.join(__dirname, '_assets');
const FC_CACHE       = '/tmp/fontconfig-cache';
const FC_FILE        = '/tmp/afghfollowers-fonts.conf';
const TEMPLATE_ORDER = ['tiktok', 'instagram', 'youtube'];

let fontconfigReady = false;
function ensureFontconfig() {
  if (fontconfigReady) return;
  try {
    fs.mkdirSync(FC_CACHE, { recursive: true });
    fs.writeFileSync(FC_FILE,
      `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${FONT_DIR}</dir>\n  <cachedir>${FC_CACHE}</cachedir>\n</fontconfig>`);
    process.env.FONTCONFIG_FILE = FC_FILE;
  } catch (_) {}
  fontconfigReady = true;
}

const FARSI_RE = /[؀-ۿ\s!.,:;\-–—()"']/g;

function coreTextForImage(text) {
  const s = text.replace(/#\S+/g, '').replace(/afghanfollowers\.online/gi, '');
  return ((s.match(FARSI_RE) || []).join(''))
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/).map(l => l.trim()).filter(Boolean).join(' ')
    .trim();
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const c = cur ? cur + ' ' + w : w;
    if (c.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = c;
  }
  if (cur) lines.push(cur);
  return lines;
}

function pickTemplate(dayIndex) {
  return TEMPLATE_ORDER[((dayIndex % TEMPLATE_ORDER.length) + TEMPLATE_ORDER.length) % TEMPLATE_ORDER.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC PLATFORM POST SVG
// Professional multi-section layout: logo → badge → headline → subtitle →
// 4 feature cards → divider → 6-item checklist → CTA button → footer.
// ─────────────────────────────────────────────────────────────────────────────
function buildPlatformSvg({ badge, h1, h2, ctaText, c1, c2, bgBase, featItems, checkItems, logoB64, postText }) {
  const W = 1080, H = 1080, CX = W / 2;
  const subtitle = coreTextForImage(postText);
  const subLines  = wrapText(subtitle, 34).slice(0, 2);

  // ── Feature cards (4 in 1 row) ────────────────────────────────────────────
  const FW = 228, FH = 92, FGAP = 16, FY = 482;
  const featCards = featItems.map((lbl, i) => {
    const fx = 60 + i * (FW + FGAP);
    const [l1, l2] = lbl.split('\n');
    const cc = i % 2 === 0 ? c1 : c2;
    return `
<rect x="${fx}" y="${FY}" width="${FW}" height="${FH}" rx="20"
      fill="${cc}" fill-opacity="0.13" stroke="${cc}" stroke-opacity="0.50" stroke-width="1.8"/>
<text x="${fx + FW/2}" y="${FY + 36}" font-family="Vazirmatn" font-weight="700" font-size="23"
      fill="${cc}" text-anchor="middle" direction="rtl">${escapeXml(l1 || '')}</text>
${l2 ? `<text x="${fx + FW/2}" y="${FY + 67}" font-family="Vazirmatn" font-weight="600" font-size="20"
      fill="${cc}" fill-opacity="0.86" text-anchor="middle" direction="rtl">${escapeXml(l2)}</text>` : ''}`;
  }).join('');

  // ── Checklist items ────────────────────────────────────────────────────────
  const CY0 = 650, CLH = 29;
  const checks = checkItems.map((item, i) => {
    const cy  = CY0 + i * CLH + 14;
    const cxR = 970;
    return `
<circle cx="${cxR}" cy="${cy}" r="13" fill="${c1}" fill-opacity="0.14" stroke="${c1}" stroke-width="1.8"/>
<path d="M${cxR-6},${cy} L${cxR-1},${cy+5} L${cxR+7},${cy-6}"
      fill="none" stroke="${c1}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${cxR-28}" y="${cy+7}" font-family="Vazirmatn" font-size="22" font-weight="600"
      fill="#ffffff" fill-opacity="0.92" text-anchor="end" direction="rtl">${escapeXml(item)}</text>`;
  }).join('');

  // ── Subtitle block ─────────────────────────────────────────────────────────
  const subBlock = subLines.map((l, i) =>
    `<text x="${CX}" y="${430 + i * 36}" font-family="Vazirmatn" font-size="25" font-weight="600"
      fill="${c1}" fill-opacity="0.80" text-anchor="middle" direction="rtl">${escapeXml(l)}</text>`
  ).join('\n');

  // ── Stars row ─────────────────────────────────────────────────────────────
  const starPts = '0,-10 2.4,-3.3 9.5,-3.1 3.8,1.2 5.9,8.1 0,4 -5.9,8.1 -3.8,1.2 -9.5,-3.1 -2.4,-3.3';
  const starRow = [-48,-24,0,24,48].map(dx =>
    `<polygon points="${starPts}" transform="translate(${CX+dx},968) scale(0.72)" fill="#FFD700" opacity="0.82"/>`
  ).join('');

  // ── Scan-line pattern ──────────────────────────────────────────────────────
  const scan = `<pattern id="pgScan" x="0" y="0" width="1" height="4" patternUnits="userSpaceOnUse">
    <rect x="0" y="0" width="1" height="1" fill="#000000" fill-opacity="0.13"/>
  </pattern>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>
  ${scan}
  <radialGradient id="pgOrb1" cx="80%" cy="5%" r="55%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.56"/>
    <stop offset="58%" stop-color="${c1}" stop-opacity="0.10"/>
    <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pgOrb2" cx="18%" cy="96%" r="50%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.50"/>
    <stop offset="60%" stop-color="${c2}" stop-opacity="0.09"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pgOrb3" cx="5%" cy="50%" r="36%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pgHalo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.40"/>
    <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="pgH2" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="pgCta" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="pgDiv" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0"/>
    <stop offset="28%" stop-color="${c1}"/>
    <stop offset="72%" stop-color="${c2}"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="pgBadgeBg" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.18"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0.18"/>
  </linearGradient>
  <pattern id="pgDiag" x="0" y="0" width="56" height="56" patternUnits="userSpaceOnUse">
    <line x1="0" y1="56" x2="56" y2="0" stroke="#ffffff" stroke-width="0.4" stroke-opacity="0.032"/>
  </pattern>
  <filter id="pgLogoG" x="-45%" y="-45%" width="190%" height="190%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.65" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgH2G" x="-18%" y="-32%" width="136%" height="164%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="20" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.52" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgBadgeG" x="-25%" y="-40%" width="150%" height="180%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.40" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgCtaG" x="-5%" y="-20%" width="110%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.38" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<!-- ① Background layers -->
<rect width="${W}" height="${H}" fill="${bgBase}"/>
<rect width="${W}" height="${H}" fill="url(#pgOrb1)"/>
<rect width="${W}" height="${H}" fill="url(#pgOrb2)"/>
<rect width="${W}" height="${H}" fill="url(#pgOrb3)"/>
<rect width="${W}" height="${H}" fill="url(#pgDiag)"/>
<rect width="${W}" height="${H}" fill="url(#pgScan)"/>

<!-- Decorative rings -->
<circle cx="72"  cy="176" r="155" fill="none" stroke="${c1}" stroke-width="1.2" stroke-opacity="0.11"/>
<circle cx="${W-72}" cy="${H-176}" r="175" fill="none" stroke="${c2}" stroke-width="1.2" stroke-opacity="0.11"/>
<circle cx="${CX}" cy="96" r="340" fill="none" stroke="#ffffff" stroke-width="0.6" stroke-opacity="0.03"/>

<!-- Floating particles -->
<circle cx="${W-100}" cy="148" r="4.5" fill="${c1}" opacity="0.58"/>
<circle cx="${W-68}"  cy="188" r="2.2" fill="#ffffff"  opacity="0.38"/>
<circle cx="${W-134}" cy="118" r="3.0" fill="${c2}"    opacity="0.48"/>
<circle cx="110" cy="${H-140}" r="3.8" fill="${c1}" opacity="0.44"/>
<circle cx="148" cy="${H-110}" r="2.0" fill="#ffffff"  opacity="0.34"/>
<rect x="${W-145}" y="292" width="12" height="2.5" rx="1.2" fill="${c1}" opacity="0.50"/>
<rect x="${W-140}" y="287" width="2.5" height="12" rx="1.2" fill="${c1}" opacity="0.50"/>
<rect x="128" y="460" width="10" height="2" rx="1" fill="${c2}" opacity="0.42"/>
<rect x="133" y="455" width="2" height="10" rx="1" fill="${c2}" opacity="0.42"/>

<!-- ② Logo circle -->
<circle cx="${CX}" cy="96" r="90" fill="${c1}" fill-opacity="0.07"/>
<circle cx="${CX}" cy="96" r="72" fill="${bgBase}" fill-opacity="0.92" stroke="${c1}" stroke-width="2.4" stroke-opacity="0.60"/>
<image href="${logoB64}" xlink:href="${logoB64}" x="${CX-54}" y="42" width="108" height="108" filter="url(#pgLogoG)"/>

<!-- ③ Badge -->
<rect x="${CX-190}" y="182" width="380" height="48" rx="24"
      fill="url(#pgBadgeBg)" stroke="${c1}" stroke-width="1.6" stroke-opacity="0.58"
      filter="url(#pgBadgeG)"/>
<text x="${CX}" y="214" font-family="Vazirmatn" font-weight="700" font-size="22"
      fill="${c1}" text-anchor="middle">${escapeXml(badge)}</text>

<!-- ④ Headline line 1 -->
<text x="${CX}" y="285" font-family="Vazirmatn" font-weight="800" font-size="64"
      fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(h1)}</text>

<!-- ⑤ Headline line 2 — gradient + neon glow -->
<text x="${CX}" y="378" font-family="Vazirmatn" font-weight="900" font-size="82"
      fill="url(#pgH2)" text-anchor="middle" direction="rtl"
      filter="url(#pgH2G)">${escapeXml(h2)}</text>

<!-- ⑥ AI post subtitle (1–2 lines) -->
${subBlock}

<!-- ⑦ Feature cards -->
${featCards}

<!-- ⑧ Horizontal divider -->
<rect x="60" y="590" width="${W-120}" height="2" rx="1" fill="url(#pgDiv)" opacity="0.72"/>

<!-- ⑨ Checklist header -->
<text x="970" y="628" font-family="Vazirmatn" font-weight="700" font-size="25"
      fill="#ffffff" text-anchor="end" direction="rtl">خدمات ویژه ما</text>
<rect x="60" y="628" width="360" height="1.8" rx="0.9" fill="${c2}" fill-opacity="0.28"/>

<!-- ⑩ Checklist items -->
${checks}

<!-- ⑪ Decorative accent line above CTA -->
<rect x="60" y="828" width="${W-120}" height="1" rx="0.5" fill="url(#pgDiv)" opacity="0.35"/>

<!-- ⑫ CTA button -->
<rect x="60" y="840" width="${W-120}" height="66" rx="33"
      fill="url(#pgCta)" filter="url(#pgCtaG)"/>
<text x="${CX}" y="882" font-family="Vazirmatn" font-weight="800" font-size="28"
      fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(ctaText)}</text>

<!-- ⑬ Footer -->
<image href="${logoB64}" xlink:href="${logoB64}" x="52" y="928" width="54" height="54" opacity="0.52"/>

<!-- Stars rating -->
${starRow}

<!-- Tagline + website -->
<text x="${W-52}" y="944" font-family="Vazirmatn" font-size="16" fill="#ffffff" fill-opacity="0.45"
      text-anchor="end" direction="rtl">هزاران مشتری راضی</text>
<text x="${W-52}" y="968" font-family="Vazirmatn" font-size="16" fill="${c1}" fill-opacity="0.55"
      text-anchor="end">afghanfollowers.online</text>

<!-- Bottom border accent -->
<rect x="0" y="${H-6}" width="${W}" height="6" fill="url(#pgDiv)" opacity="0.80"/>

</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PER-PLATFORM BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildTikTokSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:    'افزایش دیده شدن واقعی در تیک‌تاک',
    h1:       'حساب تیک‌تاکت رو',
    h2:       'متفاوت کن!',
    ctaText:  'سفارش بده و رشد کن!',
    c1: '#00f2ea', c2: '#ff0050', bgBase: '#050810',
    featItems:  ['ضمانت\nکیفیت', 'تحویل\nسریع', 'فالوور\nواقعی', 'پشتیبانی\n۲۴ ساعته'],
    checkItems: [
      'افزایش فالوور واقعی و هدفمند',
      'افزایش لایک، ویو و کامنت',
      'افزایش بازدید ویدیو و لایو',
      'بدون نیاز به رمز عبور',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, postText: text,
  });
}

function buildInstagramSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:    'رشد واقعی اینستاگرام',
    h1:       'پیجت رو',
    h2:       'ستاره کن!',
    ctaText:  'همین حالا شروع کنید!',
    c1: '#E1306C', c2: '#F77737', bgBase: '#0a0010',
    featItems:  ['فالوور\nفعال', 'لایک\nواقعی', 'ریچ\nبالا', 'پشتیبانی\n۲۴ ساعته'],
    checkItems: [
      'افزایش فالوور فعال و واقعی',
      'افزایش لایک و کامنت ارگانیک',
      'افزایش ریچ پست‌های شما',
      'افزایش بازدید استوری و ریلز',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, postText: text,
  });
}

function buildYoutubeSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:    'رشد کانال یوتیوب',
    h1:       'کانالت رو',
    h2:       'وایرال کن!',
    ctaText:  'رشد کانالت رو شروع کن!',
    c1: '#FF3333', c2: '#FFAA00', bgBase: '#080000',
    featItems:  ['ساب\nواقعی', 'ویو\nبالا', 'لایک\nواقعی', 'پشتیبانی\n۲۴ ساعته'],
    checkItems: [
      'افزایش ساب‌اسکرایبر واقعی',
      'افزایش بازدید ویدیوها',
      'افزایش لایک و کامنت',
      'افزایش بازدید لایو',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, postText: text,
  });
}

function buildFacebookSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:    'رشد صفحه فیسبوک',
    h1:       'صفحه‌ات رو',
    h2:       'محبوب کن!',
    ctaText:  'صفحه‌ات رو رشد بده!',
    c1: '#1877F2', c2: '#FF9F1A', bgBase: '#040E28',
    featItems:  ['لایک\nواقعی', 'فالوور\nصفحه', 'ریچ\nبالا', 'پشتیبانی\n۲۴ ساعته'],
    checkItems: [
      'افزایش لایک صفحه و پست',
      'افزایش فالوور صفحه فیسبوک',
      'افزایش کامنت و ریکشن',
      'افزایش ریچ پست‌های شما',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, postText: text,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERERS — load logo once, build SVG, convert to PNG via sharp
// ─────────────────────────────────────────────────────────────────────────────

async function getLogoB64() {
  const buf = await sharp(LOGO_PATH).resize(150, 150).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function renderTikTokPostImage(text) {
  ensureFontconfig();
  const svg = buildTikTokSvg(text, await getLogoB64());
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderInstagramPostImage(text) {
  ensureFontconfig();
  const svg = buildInstagramSvg(text, await getLogoB64());
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderYoutubePostImage(text) {
  ensureFontconfig();
  const svg = buildYoutubeSvg(text, await getLogoB64());
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderFacebookPostImage(text) {
  ensureFontconfig();
  const svg = buildFacebookSvg(text, await getLogoB64());
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  renderFacebookPostImage,
  renderTikTokPostImage,
  renderInstagramPostImage,
  renderYoutubePostImage,
  pickTemplate,
  TEMPLATE_ORDER,
};
