// Auto-post image generator v5
// TikTok: 1080×1920 (9:16 portrait), all others: 1080×1080 square
// Platform SVG icons removed — identified by colour + badge only
// Logo: actual AfghanFollower PNG, prominent at top
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

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function pickTemplate(dayIndex) {
  return TEMPLATE_ORDER[((dayIndex % TEMPLATE_ORDER.length) + TEMPLATE_ORDER.length) % TEMPLATE_ORDER.length];
}

// ─────────────────────────────────────────────────────────────────────────────
//  TIKTOK — 1080 × 1920  (9:16 portrait, standard TikTok feed format)
// ─────────────────────────────────────────────────────────────────────────────
function buildTikTokSvg(logoB64) {
  const W = 1080, H = 1920, CX = W / 2;
  const c1 = '#00f2ea', c2 = '#ff0050';

  const checkItems = [
    'افزایش فالوور واقعی و هدفمند',
    'افزایش لایک، ویو و کامنت',
    'افزایش بازدید ویدیو و لایو',
    'بدون نیاز به رمز عبور',
    'کاملاً امن و بدون ریزش',
    'تحویل فوری با ضمانت کیفیت',
  ];
  const CLH = 76;
  const CY0 = 1092;

  const checks = checkItems.map((item, i) => {
    const cy = CY0 + i * CLH;
    return `
<circle cx="998" cy="${cy}" r="22" fill="#000000" fill-opacity="0.50"
        stroke="${c1}" stroke-width="2.8"/>
<path d="M989,${cy} L995,${cy+9} L1009,${cy-11}"
      fill="none" stroke="${c1}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="964" y="${cy+11}" font-family="Vazirmatn" font-size="30" font-weight="700"
      fill="#ffffff" text-anchor="end" direction="rtl">${escapeXml(item)}</text>`;
  }).join('');

  const starPts = '0,-11 2.6,-3.8 10.5,-3.4 4.2,1.4 6.5,9 0,4.6 -6.5,9 -4.2,1.4 -10.5,-3.4 -2.6,-3.8';
  const stars = [-104,-52,0,52,104].map(dx =>
    `<polygon points="${starPts}" transform="translate(${CX+dx+60},1800)" fill="#FFD700" opacity="0.88"/>`
  ).join('');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>
  <radialGradient id="tOrb1" cx="72%" cy="8%" r="58%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.72"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="tOrb2" cx="14%" cy="92%" r="56%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.68"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="tOrb3" cx="88%" cy="52%" r="34%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.26"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="tOrb4" cx="10%" cy="32%" r="28%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.22"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="tLogoHalo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.80"/><stop offset="65%" stop-color="${c1}" stop-opacity="0.15"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="tH2" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="tCta" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="tDiv" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0"/><stop offset="28%" stop-color="${c1}"/>
    <stop offset="72%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </linearGradient>
  <filter id="tGlowLogo">
    <feGaussianBlur in="SourceAlpha" stdDeviation="36" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.75" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="tGlowH2">
    <feGaussianBlur in="SourceAlpha" stdDeviation="28" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.65" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="tGlowCta">
    <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.60" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<!-- Background -->
<rect width="${W}" height="${H}" fill="#050810"/>
<rect width="${W}" height="${H}" fill="url(#tOrb1)"/>
<rect width="${W}" height="${H}" fill="url(#tOrb2)"/>
<rect width="${W}" height="${H}" fill="url(#tOrb3)"/>
<rect width="${W}" height="${H}" fill="url(#tOrb4)"/>

<!-- Diagonal laser lines -->
<line x1="-80" y1="500" x2="${W+80}" y2="140" stroke="${c1}" stroke-width="2" stroke-opacity="0.20"/>
<line x1="-80" y1="540" x2="${W+80}" y2="180" stroke="${c1}" stroke-width="0.8" stroke-opacity="0.10"/>
<line x1="-80" y1="${H-400}" x2="${W+80}" y2="${H-120}" stroke="${c2}" stroke-width="1.8" stroke-opacity="0.18"/>
<line x1="-80" y1="${H-360}" x2="${W+80}" y2="${H-80}" stroke="${c2}" stroke-width="0.6" stroke-opacity="0.08"/>

<!-- Floating geometric accents -->
<circle cx="130" cy="420" r="320" fill="none" stroke="${c1}" stroke-width="1.5" stroke-opacity="0.12"/>
<circle cx="130" cy="420" r="260" fill="none" stroke="${c1}" stroke-width="0.8" stroke-opacity="0.07"/>
<circle cx="${W-90}" cy="${H-420}" r="360" fill="none" stroke="${c2}" stroke-width="1.5" stroke-opacity="0.12"/>
<circle cx="${W-90}" cy="${H-420}" r="290" fill="none" stroke="${c2}" stroke-width="0.8" stroke-opacity="0.07"/>

<!-- Particles -->
<circle cx="${W-160}" cy="240" r="10" fill="${c1}" opacity="0.75"/>
<circle cx="${W-120}" cy="310" r="5"  fill="#ffffff"   opacity="0.50"/>
<circle cx="${W-210}" cy="180" r="7"  fill="${c2}"     opacity="0.65"/>
<circle cx="145" cy="${H-240}" r="9"  fill="${c1}" opacity="0.60"/>
<circle cx="100" cy="${H-180}" r="4"  fill="${c2}"     opacity="0.55"/>
<rect x="${W-220}" y="570" width="24" height="5" rx="2.5" fill="${c1}" opacity="0.60"/>
<rect x="${W-208}" y="558" width="5"  height="24" rx="2.5" fill="${c1}" opacity="0.60"/>
<rect x="160" cy="720" x="148" y="712" width="20" height="4" rx="2" fill="${c2}" opacity="0.50"/>
<rect x="156" y="704" width="4" height="20" rx="2" fill="${c2}" opacity="0.50"/>

<!-- Corner brackets -->
<rect x="40" y="40" width="80" height="7" rx="3.5" fill="${c1}" opacity="0.85"/>
<rect x="40" y="40" width="7"  height="80" rx="3.5" fill="${c1}" opacity="0.85"/>
<rect x="${W-120}" y="40" width="80" height="7" rx="3.5" fill="${c1}" opacity="0.85"/>
<rect x="${W-47}" y="40" width="7"  height="80" rx="3.5" fill="${c1}" opacity="0.85"/>
<rect x="40" y="${H-47}" width="80" height="7" rx="3.5" fill="${c2}" opacity="0.85"/>
<rect x="40" y="${H-120}" width="7"  height="80" rx="3.5" fill="${c2}" opacity="0.85"/>
<rect x="${W-120}" y="${H-47}" width="80" height="7" rx="3.5" fill="${c2}" opacity="0.85"/>
<rect x="${W-47}" y="${H-120}" width="7"  height="80" rx="3.5" fill="${c2}" opacity="0.85"/>

<!-- ── LOGO ──────────────────────────────────────────────────────────────── -->
<circle cx="${CX}" cy="210" r="184" fill="url(#tLogoHalo)"/>
<circle cx="${CX}" cy="210" r="148" fill="#ffffff" fill-opacity="0.97"/>
<circle cx="${CX}" cy="210" r="152" fill="none" stroke="${c1}" stroke-width="5" stroke-opacity="0.90"/>
<circle cx="${CX+5}" cy="215" r="157" fill="none" stroke="${c2}" stroke-width="2.5" stroke-opacity="0.40"/>
<image href="${logoB64}" xlink:href="${logoB64}"
       x="${CX-112}" y="98" width="224" height="224" filter="url(#tGlowLogo)"/>

<!-- ── BADGE ─────────────────────────────────────────────────────────────── -->
<rect x="${CX-290}" y="380" width="580" height="62" rx="31"
      fill="#000000" fill-opacity="0.60" stroke="${c1}" stroke-width="2.2" stroke-opacity="0.75"/>
<text x="${CX}" y="420" font-family="Vazirmatn" font-weight="700" font-size="28"
      fill="${c1}" text-anchor="middle">افزایش دیده شدن واقعی در تیک‌تاک</text>

<!-- ── HEADLINES ─────────────────────────────────────────────────────────── -->
<text x="${CX}" y="514" font-family="Vazirmatn" font-weight="800" font-size="80"
      fill="#ffffff" text-anchor="middle" direction="rtl">حساب تیک‌تاکت رو</text>
<text x="${CX}" y="636" font-family="Vazirmatn" font-weight="900" font-size="114"
      fill="url(#tH2)" text-anchor="middle" direction="rtl"
      filter="url(#tGlowH2)">متفاوت کن!</text>

<!-- ── FEATURE CARDS 2 × 2 ──────────────────────────────────────────────── -->
<!-- Row 1 -->
<rect x="42" y="680" width="476" height="126" rx="22"
      fill="#000000" fill-opacity="0.48" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.85"/>
<rect x="42" y="680" width="476" height="48" rx="22 22 0 0" fill="${c1}" fill-opacity="0.14"/>
<text x="280" y="724" font-family="Vazirmatn" font-weight="800" font-size="32"
      fill="${c1}" text-anchor="middle">ضمانت کیفیت</text>
<text x="280" y="775" font-family="Vazirmatn" font-weight="700" font-size="26"
      fill="#ffffff" fill-opacity="0.88" text-anchor="middle">بالاترین کیفیت خدمات</text>

<rect x="562" y="680" width="476" height="126" rx="22"
      fill="#000000" fill-opacity="0.48" stroke="${c2}" stroke-width="2.5" stroke-opacity="0.85"/>
<rect x="562" y="680" width="476" height="48" rx="22 22 0 0" fill="${c2}" fill-opacity="0.14"/>
<text x="800" y="724" font-family="Vazirmatn" font-weight="800" font-size="32"
      fill="${c2}" text-anchor="middle">تحویل سریع</text>
<text x="800" y="775" font-family="Vazirmatn" font-weight="700" font-size="26"
      fill="#ffffff" fill-opacity="0.88" text-anchor="middle">شروع فوری پس از سفارش</text>

<!-- Row 2 -->
<rect x="42" y="826" width="476" height="126" rx="22"
      fill="#000000" fill-opacity="0.48" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.85"/>
<rect x="42" y="826" width="476" height="48" rx="22 22 0 0" fill="${c1}" fill-opacity="0.14"/>
<text x="280" y="870" font-family="Vazirmatn" font-weight="800" font-size="32"
      fill="${c1}" text-anchor="middle">فالوور واقعی</text>
<text x="280" y="921" font-family="Vazirmatn" font-weight="700" font-size="26"
      fill="#ffffff" fill-opacity="0.88" text-anchor="middle">بدون فالوور فیک</text>

<rect x="562" y="826" width="476" height="126" rx="22"
      fill="#000000" fill-opacity="0.48" stroke="${c2}" stroke-width="2.5" stroke-opacity="0.85"/>
<rect x="562" y="826" width="476" height="48" rx="22 22 0 0" fill="${c2}" fill-opacity="0.14"/>
<text x="800" y="870" font-family="Vazirmatn" font-weight="800" font-size="32"
      fill="${c2}" text-anchor="middle">پشتیبانی ۲۴ ساعته</text>
<text x="800" y="921" font-family="Vazirmatn" font-weight="700" font-size="26"
      fill="#ffffff" fill-opacity="0.88" text-anchor="middle">همیشه در کنار شما</text>

<!-- ── SECTION DIVIDER ─────────────────────────────────────────────────── -->
<rect x="60" y="978" width="${W-120}" height="3" rx="1.5" fill="url(#tDiv)" opacity="0.75"/>

<!-- ── CHECKLIST ────────────────────────────────────────────────────────── -->
<rect x="42" y="1000" width="${W-84}" height="${checkItems.length * CLH + 120}" rx="24"
      fill="#000000" fill-opacity="0.50"/>

<text x="1014" y="1056" font-family="Vazirmatn" font-weight="900" font-size="36"
      fill="${c1}" text-anchor="end" direction="rtl">خدمات ویژه ما</text>
<rect x="64" y="1060" width="420" height="3" rx="1.5" fill="${c2}" fill-opacity="0.40"/>

${checks}

<!-- ── DIVIDER BEFORE CTA ─────────────────────────────────────────────── -->
<rect x="60" y="1568" width="${W-120}" height="3" rx="1.5" fill="url(#tDiv)" opacity="0.50"/>

<!-- ── CTA ───────────────────────────────────────────────────────────────── -->
<rect x="52" y="1588" width="${W-104}" height="110" rx="55"
      fill="url(#tCta)" filter="url(#tGlowCta)"/>
<rect x="54" y="1590" width="${W-108}" height="44" rx="54"
      fill="#ffffff" fill-opacity="0.12"/>
<text x="${CX}" y="1654" font-family="Vazirmatn" font-weight="900" font-size="44"
      fill="#ffffff" text-anchor="middle" direction="rtl">سفارش بده و رشد کن!</text>

<!-- ── FOOTER ────────────────────────────────────────────────────────────── -->
<!-- Logo small (left) -->
<circle cx="108" cy="1756" r="58" fill="#ffffff" fill-opacity="0.92"/>
<image href="${logoB64}" xlink:href="${logoB64}" x="56" y="1704" width="104" height="104"/>

<!-- Stars -->
${stars}

<!-- Tagline + URL -->
<text x="${W-70}" y="1744" font-family="Vazirmatn" font-size="30" fill="${c1}" fill-opacity="0.88"
      text-anchor="end">afghanfollowers.online</text>
<text x="${W-70}" y="1780" font-family="Vazirmatn" font-size="22" fill="#ffffff" fill-opacity="0.48"
      text-anchor="end" direction="rtl">پرداخت امن | ضمانت کیفیت</text>
<text x="${W-70}" y="1845" font-family="Vazirmatn" font-size="24" fill="#ffffff" fill-opacity="0.55"
      text-anchor="end" direction="rtl">هزاران مشتری راضی</text>

<!-- Bottom accent bar -->
<rect x="0" y="${H-10}" width="${W}" height="10" fill="url(#tDiv)" opacity="0.92"/>
</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE (1080×1080) — shared builder for Instagram, YouTube, Facebook
//  No platform icon — platform identified by colour-scheme + badge text
// ─────────────────────────────────────────────────────────────────────────────
function buildSquareSvg({ badge, h1, h2, ctaText, c1, c2, bgBase, featItems, checkItems, logoB64, decorSvg }) {
  const W = 1080, H = 1080, CX = W / 2;
  const CLH = 28;
  const CY0 = 638;

  const FW = 228, FH = 88, FGAP = 16, FY = 494;
  const featCards = featItems.map(([lbl, sub], i) => {
    const fx  = 60 + i * (FW + FGAP);
    const col = i % 2 === 0 ? c1 : c2;
    return `
<rect x="${fx}" y="${FY}" width="${FW}" height="${FH}" rx="18"
      fill="#000000" fill-opacity="0.48" stroke="${col}" stroke-opacity="0.88" stroke-width="2.2"/>
<rect x="${fx}" y="${FY}" width="${FW}" height="34" rx="18 18 0 0"
      fill="${col}" fill-opacity="0.16"/>
<text x="${fx + FW/2}" y="${FY + 26}" font-family="Vazirmatn" font-weight="800" font-size="22"
      fill="${col}" text-anchor="middle">${escapeXml(lbl)}</text>
<text x="${fx + FW/2}" y="${FY + 66}" font-family="Vazirmatn" font-weight="700" font-size="19"
      fill="#ffffff" fill-opacity="0.90" text-anchor="middle">${escapeXml(sub)}</text>`;
  }).join('');

  const checks = checkItems.map((item, i) => {
    const cy = CY0 + i * CLH + 14;
    return `
<circle cx="970" cy="${cy}" r="15" fill="#000000" fill-opacity="0.50"
        stroke="${c1}" stroke-width="2.2"/>
<path d="M963,${cy} L968.5,${cy+7} L978,${cy-8}"
      fill="none" stroke="${c1}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<text x="940" y="${cy+7}" font-family="Vazirmatn" font-size="22" font-weight="700"
      fill="#ffffff" text-anchor="end" direction="rtl">${escapeXml(item)}</text>`;
  }).join('');

  const starPts = '0,-9 2.2,-3.1 8.6,-2.8 3.5,1.1 5.2,7.3 0,3.7 -5.2,7.3 -3.5,1.1 -8.6,-2.8 -2.2,-3.1';
  const stars = [-44,-22,0,22,44].map(dx =>
    `<polygon points="${starPts}" transform="translate(${CX+dx-52},956)" fill="#FFD700" opacity="0.88"/>`
  ).join('');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>
  <radialGradient id="sqOrb1" cx="78%" cy="6%" r="58%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.72"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="sqOrb2" cx="12%" cy="94%" r="56%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.68"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="sqOrb3" cx="90%" cy="55%" r="32%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.24"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="sqLogoHalo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.80"/><stop offset="60%" stop-color="${c1}" stop-opacity="0.12"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="sqH2" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="sqCta" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="sqDiv" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0"/><stop offset="26%" stop-color="${c1}"/>
    <stop offset="74%" stop-color="${c2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </linearGradient>
  <filter id="sqGlowLogo">
    <feGaussianBlur in="SourceAlpha" stdDeviation="28" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.75" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="sqGlowH2">
    <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.60" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="sqGlowCta">
    <feGaussianBlur in="SourceAlpha" stdDeviation="18" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.55" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<!-- Background -->
<rect width="${W}" height="${H}" fill="${bgBase}"/>
<rect width="${W}" height="${H}" fill="url(#sqOrb1)"/>
<rect width="${W}" height="${H}" fill="url(#sqOrb2)"/>
<rect width="${W}" height="${H}" fill="url(#sqOrb3)"/>

<!-- Diagonal lines -->
<line x1="-60" y1="310" x2="${W+60}" y2="80" stroke="${c1}" stroke-width="1.8" stroke-opacity="0.18"/>
<line x1="-60" y1="340" x2="${W+60}" y2="110" stroke="${c1}" stroke-width="0.6" stroke-opacity="0.08"/>
<line x1="-60" y1="${H-220}" x2="${W+60}" y2="${H-60}" stroke="${c2}" stroke-width="1.5" stroke-opacity="0.16"/>

<!-- Decorative rings -->
<circle cx="90" cy="280" r="248" fill="none" stroke="${c1}" stroke-width="1.2" stroke-opacity="0.12"/>
<circle cx="${W-80}" cy="${H-270}" r="270" fill="none" stroke="${c2}" stroke-width="1.2" stroke-opacity="0.12"/>

<!-- Platform-specific decorative element -->
${decorSvg}

<!-- Particles -->
<circle cx="${W-145}" cy="165" r="8"  fill="${c1}" opacity="0.72"/>
<circle cx="${W-105}" cy="210" r="4"  fill="#ffffff" opacity="0.48"/>
<circle cx="${W-192}" cy="130" r="5.5" fill="${c2}" opacity="0.62"/>
<circle cx="110" cy="${H-155}" r="7"  fill="${c1}" opacity="0.58"/>
<circle cx="78"  cy="${H-115}" r="3.5" fill="${c2}" opacity="0.52"/>
<rect x="${W-175}" y="285" width="18" height="4"  rx="2" fill="${c1}" opacity="0.58"/>
<rect x="${W-166}" y="276" width="4"  height="18" rx="2" fill="${c1}" opacity="0.58"/>

<!-- Corner brackets -->
<rect x="28" y="28" width="58" height="6" rx="3" fill="${c1}" opacity="0.80"/>
<rect x="28" y="28" width="6"  height="58" rx="3" fill="${c1}" opacity="0.80"/>
<rect x="${W-86}" y="28" width="58" height="6" rx="3" fill="${c1}" opacity="0.80"/>
<rect x="${W-34}" y="28" width="6"  height="58" rx="3" fill="${c1}" opacity="0.80"/>
<rect x="28" y="${H-34}" width="58" height="6" rx="3" fill="${c2}" opacity="0.80"/>
<rect x="28" y="${H-86}" width="6"  height="58" rx="3" fill="${c2}" opacity="0.80"/>
<rect x="${W-86}" y="${H-34}" width="58" height="6" rx="3" fill="${c2}" opacity="0.80"/>
<rect x="${W-34}" y="${H-86}" width="6"  height="58" rx="3" fill="${c2}" opacity="0.80"/>

<!-- ── LOGO ──────────────────────────────────────────────────────────────── -->
<circle cx="${CX}" cy="114" r="136" fill="url(#sqLogoHalo)"/>
<circle cx="${CX}" cy="114" r="108" fill="#ffffff" fill-opacity="0.97"/>
<circle cx="${CX}" cy="114" r="112" fill="none" stroke="${c1}" stroke-width="4.5" stroke-opacity="0.88"/>
<circle cx="${CX+4}" cy="118" r="117" fill="none" stroke="${c2}" stroke-width="2" stroke-opacity="0.38"/>
<image href="${logoB64}" xlink:href="${logoB64}"
       x="${CX-82}" y="32" width="164" height="164" filter="url(#sqGlowLogo)"/>

<!-- ── BADGE ─────────────────────────────────────────────────────────────── -->
<rect x="${CX-224}" y="238" width="448" height="52" rx="26"
      fill="#000000" fill-opacity="0.58" stroke="${c1}" stroke-width="2" stroke-opacity="0.72"/>
<text x="${CX}" y="272" font-family="Vazirmatn" font-weight="700" font-size="22"
      fill="${c1}" text-anchor="middle">${escapeXml(badge)}</text>

<!-- ── HEADLINES ─────────────────────────────────────────────────────────── -->
<text x="${CX}" y="354" font-family="Vazirmatn" font-weight="800" font-size="64"
      fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(h1)}</text>
<text x="${CX}" y="446" font-family="Vazirmatn" font-weight="900" font-size="84"
      fill="url(#sqH2)" text-anchor="middle" direction="rtl"
      filter="url(#sqGlowH2)">${escapeXml(h2)}</text>

<!-- ── FEATURE CARDS ─────────────────────────────────────────────────────── -->
${featCards}

<!-- ── DIVIDER ────────────────────────────────────────────────────────────── -->
<rect x="60" y="596" width="${W-120}" height="2.5" rx="1.25" fill="url(#sqDiv)" opacity="0.75"/>

<!-- ── CHECKLIST ─────────────────────────────────────────────────────────── -->
<rect x="50" y="612" width="${W-100}" height="${checkItems.length * CLH + 26}" rx="16"
      fill="#000000" fill-opacity="0.50"/>
<text x="968" y="646" font-family="Vazirmatn" font-weight="900" font-size="26"
      fill="${c1}" text-anchor="end" direction="rtl">خدمات ویژه ما</text>
<rect x="68" y="648" width="360" height="2.2" rx="1.1" fill="${c2}" fill-opacity="0.38"/>

${checks}

<!-- ── DIVIDER BEFORE CTA ─────────────────────────────────────────────── -->
<rect x="60" y="836" width="${W-120}" height="2" rx="1" fill="url(#sqDiv)" opacity="0.42"/>

<!-- ── CTA ───────────────────────────────────────────────────────────────── -->
<rect x="56" y="850" width="${W-112}" height="74" rx="37"
      fill="url(#sqCta)" filter="url(#sqGlowCta)"/>
<rect x="58" y="852" width="${W-116}" height="30" rx="36"
      fill="#ffffff" fill-opacity="0.12"/>
<text x="${CX}" y="896" font-family="Vazirmatn" font-weight="900" font-size="32"
      fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(ctaText)}</text>

<!-- ── FOOTER ────────────────────────────────────────────────────────────── -->
<circle cx="82" cy="962" r="44" fill="#ffffff" fill-opacity="0.92"/>
<image href="${logoB64}" xlink:href="${logoB64}" x="46" y="926" width="72" height="72"/>

${stars}

<text x="${CX+40}" y="976" font-family="Vazirmatn" font-size="17" fill="#ffffff" fill-opacity="0.52"
      text-anchor="middle" direction="rtl">هزاران مشتری راضی</text>
<text x="${W-52}" y="948" font-family="Vazirmatn" font-size="19" fill="${c1}" fill-opacity="0.82"
      text-anchor="end">afghanfollowers.online</text>
<text x="${W-52}" y="970" font-family="Vazirmatn" font-size="14" fill="#ffffff" fill-opacity="0.40"
      text-anchor="end" direction="rtl">پرداخت امن | ضمانت کیفیت</text>

<!-- Bottom accent bar -->
<rect x="0" y="${H-8}" width="${W}" height="8" fill="url(#sqDiv)" opacity="0.88"/>
</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PER-PLATFORM SQUARE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

// Instagram: concentric gradient rings (purple → pink → orange) as decorative accent
function buildInstagramSvg(logoB64) {
  const c1 = '#E1306C', c2 = '#F77737';
  const CX = 540;
  const decorSvg = `
<circle cx="${CX}" cy="306" r="130" fill="#833ab4" fill-opacity="0.06"/>
<circle cx="${CX}" cy="306" r="100" fill="#E1306C" fill-opacity="0.07"/>
<circle cx="${CX}" cy="306" r="70"  fill="#F77737" fill-opacity="0.08"/>
<circle cx="${CX}" cy="306" r="40"  fill="#FCAF45" fill-opacity="0.10"/>
<circle cx="${CX}" cy="306" r="130" fill="none" stroke="#833ab4" stroke-width="1.5" stroke-opacity="0.22"/>
<circle cx="${CX}" cy="306" r="100" fill="none" stroke="#E1306C" stroke-width="1.5" stroke-opacity="0.22"/>
<circle cx="${CX}" cy="306" r="70"  fill="none" stroke="#F77737" stroke-width="1.5" stroke-opacity="0.22"/>`;

  return buildSquareSvg({
    badge: 'رشد واقعی اینستاگرام',
    h1: 'پیجت رو', h2: 'ستاره کن!',
    ctaText: 'همین حالا شروع کنید!',
    c1, c2, bgBase: '#0a0010',
    featItems: [
      ['فالوور فعال', 'واقعی و هدفمند'],
      ['لایک واقعی', 'بدون فیک'],
      ['ریچ بالا', 'بیشتر دیده شو'],
      ['پشتیبانی', '۲۴ ساعته'],
    ],
    checkItems: [
      'افزایش فالوور فعال و واقعی',
      'افزایش لایک و کامنت ارگانیک',
      'افزایش ریچ پست‌های شما',
      'افزایش بازدید استوری و ریلز',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, decorSvg,
  });
}

// YouTube: concentric red rings + dark centre
function buildYoutubeSvg(logoB64) {
  const c1 = '#FF3333', c2 = '#FFAA00';
  const CX = 540;
  const decorSvg = `
<circle cx="${CX}" cy="306" r="140" fill="#FF0000" fill-opacity="0.06"/>
<circle cx="${CX}" cy="306" r="105" fill="#FF3333" fill-opacity="0.08"/>
<circle cx="${CX}" cy="306" r="70"  fill="#CC0000" fill-opacity="0.10"/>
<circle cx="${CX}" cy="306" r="140" fill="none" stroke="#FF3333" stroke-width="1.5" stroke-opacity="0.20"/>
<circle cx="${CX}" cy="306" r="105" fill="none" stroke="#FF0000" stroke-width="1.5" stroke-opacity="0.20"/>
<circle cx="${CX}" cy="306" r="70"  fill="none" stroke="#FFAA00" stroke-width="1.2" stroke-opacity="0.20"/>
<polygon points="0,-28 0,28 46,0" transform="translate(${CX},306)" fill="#FF3333" fill-opacity="0.18"/>`;

  return buildSquareSvg({
    badge: 'رشد کانال یوتیوب',
    h1: 'کانالت رو', h2: 'وایرال کن!',
    ctaText: 'رشد کانالت رو شروع کن!',
    c1, c2, bgBase: '#080000',
    featItems: [
      ['ساب واقعی', 'مخاطب هدفمند'],
      ['ویو بالا', 'بازدید واقعی'],
      ['لایک واقعی', 'بدون فیک'],
      ['پشتیبانی', '۲۴ ساعته'],
    ],
    checkItems: [
      'افزایش ساب‌اسکرایبر واقعی',
      'افزایش بازدید ویدیوها',
      'افزایش لایک و کامنت',
      'افزایش بازدید لایو',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, decorSvg,
  });
}

// Facebook: deep blue concentric rings
function buildFacebookSvg(logoB64) {
  const c1 = '#1877F2', c2 = '#FF9F1A';
  const CX = 540;
  const decorSvg = `
<circle cx="${CX}" cy="306" r="140" fill="#1877F2" fill-opacity="0.07"/>
<circle cx="${CX}" cy="306" r="105" fill="#1877F2" fill-opacity="0.09"/>
<circle cx="${CX}" cy="306" r="70"  fill="#00A3FF" fill-opacity="0.11"/>
<circle cx="${CX}" cy="306" r="140" fill="none" stroke="#1877F2" stroke-width="1.5" stroke-opacity="0.22"/>
<circle cx="${CX}" cy="306" r="105" fill="none" stroke="#4599F4" stroke-width="1.5" stroke-opacity="0.22"/>
<circle cx="${CX}" cy="306" r="70"  fill="none" stroke="#00A3FF" stroke-width="1.2" stroke-opacity="0.22"/>`;

  return buildSquareSvg({
    badge: 'رشد صفحه فیسبوک',
    h1: 'صفحه‌ات رو', h2: 'محبوب کن!',
    ctaText: 'صفحه‌ات رو رشد بده!',
    c1, c2, bgBase: '#040E28',
    featItems: [
      ['لایک واقعی', 'صفحه و پست'],
      ['فالوور فعال', 'هدفمند'],
      ['ریچ بالا', 'بیشتر دیده شو'],
      ['پشتیبانی', '۲۴ ساعته'],
    ],
    checkItems: [
      'افزایش لایک صفحه و پست',
      'افزایش فالوور صفحه فیسبوک',
      'افزایش کامنت و ریکشن',
      'افزایش ریچ پست‌های شما',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت',
    ],
    logoB64, decorSvg,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

async function getLogoB64() {
  const buf = await sharp(LOGO_PATH).resize(220, 220).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function renderTikTokPostImage(_text) {
  ensureFontconfig();
  const logo = await getLogoB64();
  return sharp(Buffer.from(buildTikTokSvg(logo))).png().toBuffer();
}
async function renderInstagramPostImage(_text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildInstagramSvg(await getLogoB64()))).png().toBuffer();
}
async function renderYoutubePostImage(_text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildYoutubeSvg(await getLogoB64()))).png().toBuffer();
}
async function renderFacebookPostImage(_text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildFacebookSvg(await getLogoB64()))).png().toBuffer();
}

module.exports = {
  renderFacebookPostImage,
  renderTikTokPostImage,
  renderInstagramPostImage,
  renderYoutubePostImage,
  pickTemplate,
  TEMPLATE_ORDER,
};
