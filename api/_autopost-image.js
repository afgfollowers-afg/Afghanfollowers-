// Auto-post image generator v4 — professional per-platform design.
// Logo: real AfghanFollower logo on white ring (visible on dark bg).
// Platform icons: SVG-drawn TikTok note, IG camera, YT play-btn, FB f.
// Text: white on dark panels, high contrast throughout.
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
    .split(/\n+/).map(l => l.trim()).filter(Boolean).join(' ').trim();
}
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
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
//  PLATFORM ICON SVG STRINGS (drawn geometrically for librsvg compatibility)
// ─────────────────────────────────────────────────────────────────────────────

// TikTok: musical-note "d" shape with cyan + pink chromatic-aberration effect
function iconTikTok(cx, cy) {
  // All coordinates relative, then translate to cx,cy
  // Oval body center: (-10, +26) from icon center
  // Stem: x=+18 from oval center, going up to -52 from icon center
  const ox = cx - 10, oy = cy + 26;
  const sx = ox + 28, sy = cy - 52;          // stem top
  const stemH = oy - sy + 18;               // stem height (reaches bottom of oval)
  const barW = 46, barH = 10, endH = 28;    // top bar + end drop
  return `
<g opacity="1">
  <!-- Pink shadow offset (+6,+4) -->
  <ellipse cx="${ox+6}" cy="${oy+4}" rx="28" ry="20" fill="#ff0050" fill-opacity="0.60"/>
  <rect x="${sx+6}" y="${sy+4}" width="10" height="${stemH}" rx="5" fill="#ff0050" fill-opacity="0.60"/>
  <rect x="${sx+6}" y="${sy+4}" width="${barW}" height="${barH}" rx="5" fill="#ff0050" fill-opacity="0.60"/>
  <rect x="${sx+6+barW-10}" y="${sy+4}" width="10" height="${endH}" rx="5" fill="#ff0050" fill-opacity="0.60"/>
  <!-- Cyan main shape -->
  <ellipse cx="${ox}" cy="${oy}" rx="28" ry="20" fill="#00f2ea"/>
  <rect x="${sx}" y="${sy}" width="10" height="${stemH}" rx="5" fill="#00f2ea"/>
  <rect x="${sx}" y="${sy}" width="${barW}" height="${barH}" rx="5" fill="#00f2ea"/>
  <rect x="${sx+barW-10}" y="${sy}" width="10" height="${endH}" rx="5" fill="#00f2ea"/>
</g>`;
}

// Instagram: camera outline with gradient stroke
function iconInstagram(cx, cy) {
  const W2 = 88, H2 = 72, rx = 18;
  const x0 = cx - W2/2, y0 = cy - H2/2;
  // Hump at top-center
  const hx = cx - 16, hy = y0 - 1;
  return `
<g opacity="1">
  <!-- Gradient glow behind camera -->
  <rect x="${x0-4}" y="${y0-4}" width="${W2+8}" height="${H2+8}" rx="${rx+4}"
        fill="#833ab4" fill-opacity="0.22"/>
  <!-- Camera body outline -->
  <rect x="${x0}" y="${y0}" width="${W2}" height="${H2}" rx="${rx}"
        fill="none" stroke="url(#igCamGrad)" stroke-width="4.5"/>
  <!-- Hump (viewfinder bump at top) -->
  <path d="M${hx},${hy} L${hx+8},${hy-12} Q${hx+16},${hy-16} ${hx+24},${hy-12} L${hx+32},${hy}"
        fill="none" stroke="url(#igCamGrad)" stroke-width="4.5" stroke-linejoin="round"/>
  <!-- Lens outer ring -->
  <circle cx="${cx}" cy="${cy+4}" r="24" fill="none" stroke="url(#igCamGrad)" stroke-width="3.5"/>
  <!-- Lens inner fill -->
  <circle cx="${cx}" cy="${cy+4}" r="14" fill="url(#igCamGrad)" fill-opacity="0.25"/>
  <!-- Lens shine -->
  <circle cx="${cx+8}" cy="${cy-4}" r="5" fill="#ffffff" fill-opacity="0.55"/>
  <!-- Flash dot -->
  <circle cx="${cx+32}" cy="${y0+16}" r="6" fill="url(#igCamGrad)"/>
</g>`;
}

// YouTube: rounded red rectangle + white play triangle
function iconYouTube(cx, cy) {
  const W2 = 100, H2 = 70, rx = 16;
  const x0 = cx - W2/2, y0 = cy - H2/2;
  // Play triangle points (equilateral, centered)
  const tx = cx - 14, ty = cy - 20;
  return `
<g opacity="1">
  <!-- Shadow behind rect -->
  <rect x="${x0+4}" y="${y0+6}" width="${W2}" height="${H2}" rx="${rx}" fill="#000000" fill-opacity="0.40"/>
  <!-- Red button -->
  <rect x="${x0}" y="${y0}" width="${W2}" height="${H2}" rx="${rx}" fill="#FF0000"/>
  <!-- White highlight at top -->
  <rect x="${x0}" y="${y0}" width="${W2}" height="${H2/2}" rx="${rx}" fill="#ffffff" fill-opacity="0.08"/>
  <!-- Play triangle -->
  <polygon points="${tx},${ty} ${tx},${ty+40} ${tx+36},${ty+20}" fill="#ffffff"/>
  <!-- Triangle shine -->
  <polygon points="${tx},${ty} ${tx+18},${ty+10} ${tx+36},${ty+20} ${tx},${ty+40} ${tx},${ty}"
           fill="#ffffff" fill-opacity="0.15"/>
</g>`;
}

// Facebook: blue circle + white "f" text (system fonts always have ASCII)
function iconFacebook(cx, cy) {
  return `
<g opacity="1">
  <!-- Glow ring -->
  <circle cx="${cx}" cy="${cy}" r="56" fill="#1877F2" fill-opacity="0.28"/>
  <!-- Blue circle -->
  <circle cx="${cx}" cy="${cy}" r="46" fill="#1877F2"/>
  <!-- Inner highlight -->
  <circle cx="${cx-12}" cy="${cy-14}" r="20" fill="#ffffff" fill-opacity="0.10"/>
  <!-- "f" — use Arial which is always on Linux -->
  <text x="${cx+5}" y="${cy+22}" font-family="Arial,Helvetica,sans-serif" font-weight="900"
        font-size="64" fill="#ffffff" text-anchor="middle">f</text>
</g>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERIC PLATFORM POST SVG BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildPlatformSvg({ badge, h1, h2, ctaText, c1, c2, bgBase, featItems, checkItems, logoB64, postText, platformIconFn, extraDefs }) {
  const W = 1080, H = 1080, CX = W / 2;
  // ── Feature cards ─────────────────────────────────────────────────────────
  const FW = 228, FH = 88, FGAP = 16, FY = 490;
  const featCards = featItems.map((lbl, i) => {
    const fx = 60 + i * (FW + FGAP);
    const [l1, l2] = lbl.split('\n');
    const cc = i % 2 === 0 ? c1 : c2;
    return `
<rect x="${fx}" y="${FY}" width="${FW}" height="${FH}" rx="18"
      fill="#000000" fill-opacity="0.42" stroke="${cc}" stroke-opacity="0.75" stroke-width="2.2"/>
<text x="${fx + FW/2}" y="${FY + 32}" font-family="Vazirmatn" font-weight="800" font-size="24"
      fill="${cc}" text-anchor="middle" direction="rtl">${escapeXml(l1 || '')}</text>
${l2 ? `<text x="${fx + FW/2}" y="${FY + 62}" font-family="Vazirmatn" font-weight="700" font-size="21"
      fill="#ffffff" fill-opacity="0.90" text-anchor="middle" direction="rtl">${escapeXml(l2)}</text>` : ''}`;
  }).join('');

  // ── Checklist ─────────────────────────────────────────────────────────────
  const CY0 = 630, CLH = 28;
  const checks = checkItems.map((item, i) => {
    const cy  = CY0 + i * CLH + 15;
    const cxR = 968;
    return `
<circle cx="${cxR}" cy="${cy}" r="14" fill="#000000" fill-opacity="0.45" stroke="${c1}" stroke-width="2.0"/>
<path d="M${cxR-7},${cy} L${cxR-1},${cy+6} L${cxR+8},${cy-7}"
      fill="none" stroke="${c1}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${cxR-30}" y="${cy+7}" font-family="Vazirmatn" font-size="23" font-weight="700"
      fill="#ffffff" text-anchor="end" direction="rtl">${escapeXml(item)}</text>`;
  }).join('');

  // ── Stars ─────────────────────────────────────────────────────────────────
  const starPts = '0,-10 2.4,-3.3 9.5,-3.1 3.8,1.2 5.9,8.1 0,4 -5.9,8.1 -3.8,1.2 -9.5,-3.1 -2.4,-3.3';
  const starRow = [-52,-26,0,26,52].map(dx =>
    `<polygon points="${starPts}" transform="translate(${CX+dx-80},948) scale(0.78)" fill="#FFD700" opacity="0.90"/>`
  ).join('');

  // ── Platform icon ─────────────────────────────────────────────────────────
  const platformIcon = platformIconFn ? platformIconFn(CX, 282) : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>
  <!-- Scan lines -->
  <pattern id="pgScan" x="0" y="0" width="1" height="4" patternUnits="userSpaceOnUse">
    <rect x="0" y="0" width="1" height="1" fill="#000000" fill-opacity="0.14"/>
  </pattern>
  <!-- Diagonal grid -->
  <pattern id="pgGrid" x="0" y="0" width="58" height="58" patternUnits="userSpaceOnUse">
    <line x1="0" y1="58" x2="58" y2="0" stroke="#ffffff" stroke-width="0.5" stroke-opacity="0.030"/>
  </pattern>
  <!-- Colour orbs -->
  <radialGradient id="pgOrb1" cx="82%" cy="4%" r="56%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.60"/>
    <stop offset="55%" stop-color="${c1}" stop-opacity="0.12"/>
    <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pgOrb2" cx="16%" cy="97%" r="52%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.54"/>
    <stop offset="58%" stop-color="${c2}" stop-opacity="0.10"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pgOrb3" cx="4%" cy="52%" r="36%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.24"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <!-- Logo halo -->
  <radialGradient id="pgLogoHalo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <!-- Gradients -->
  <linearGradient id="pgH2" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="pgCta" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="pgDiv" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0"/>
    <stop offset="25%" stop-color="${c1}"/>
    <stop offset="75%" stop-color="${c2}"/>
    <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </linearGradient>
  <!-- Instagram camera gradient (used only by IG icon) -->
  <linearGradient id="igCamGrad" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0%" stop-color="#FCAF45"/>
    <stop offset="35%" stop-color="#F77737"/>
    <stop offset="65%" stop-color="#E1306C"/>
    <stop offset="100%" stop-color="#833ab4"/>
  </linearGradient>
  <!-- Filters -->
  <filter id="pgLogoG" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="24" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.70" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgH2G" x="-20%" y="-35%" width="140%" height="170%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.55" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgCtaG" x="-5%" y="-25%" width="110%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.45" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgIconG" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.45" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="pgTextShadow" x="-10%" y="-20%" width="120%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/>
    <feFlood flood-color="#000000" flood-opacity="0.70" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  ${extraDefs || ''}
</defs>

<!-- ① Background layers -->
<rect width="${W}" height="${H}" fill="${bgBase}"/>
<rect width="${W}" height="${H}" fill="url(#pgOrb1)"/>
<rect width="${W}" height="${H}" fill="url(#pgOrb2)"/>
<rect width="${W}" height="${H}" fill="url(#pgOrb3)"/>
<rect width="${W}" height="${H}" fill="url(#pgGrid)"/>
<rect width="${W}" height="${H}" fill="url(#pgScan)"/>

<!-- Decorative rings -->
<circle cx="65"  cy="185" r="160" fill="none" stroke="${c1}" stroke-width="1.4" stroke-opacity="0.14"/>
<circle cx="${W-65}" cy="${H-185}" r="182" fill="none" stroke="${c2}" stroke-width="1.4" stroke-opacity="0.14"/>

<!-- Diagonal laser lines -->
<line x1="-50" y1="320" x2="${W+50}" y2="90"  stroke="${c1}" stroke-width="1.4" stroke-opacity="0.22"/>
<line x1="-50" y1="345" x2="${W+50}" y2="115" stroke="${c1}" stroke-width="0.5" stroke-opacity="0.10"/>
<line x1="-50" y1="${H-200}" x2="${W+50}" y2="${H-50}" stroke="${c2}" stroke-width="1.2" stroke-opacity="0.18"/>

<!-- Floating particles -->
<circle cx="${W-115}" cy="152" r="5"   fill="${c1}" opacity="0.62"/>
<circle cx="${W-80}"  cy="192" r="2.5" fill="#ffffff"  opacity="0.40"/>
<circle cx="${W-148}" cy="122" r="3.2" fill="${c2}"    opacity="0.52"/>
<circle cx="110" cy="${H-155}" r="4.2" fill="${c1}" opacity="0.48"/>
<circle cx="78"  cy="${H-118}" r="2"   fill="${c2}"    opacity="0.44"/>
<rect x="${W-152}" y="295" width="13" height="2.8" rx="1.4" fill="${c1}" opacity="0.52"/>
<rect x="${W-146}" y="289" width="2.8" height="13" rx="1.4" fill="${c1}" opacity="0.52"/>
<rect x="125" y="468" width="11" height="2.2" rx="1.1" fill="${c2}" opacity="0.44"/>
<rect x="130" y="462" width="2.2" height="11" rx="1.1" fill="${c2}" opacity="0.44"/>

<!-- Viewfinder corner brackets -->
<rect x="28" y="28" width="50" height="5" rx="2.5" fill="${c1}" opacity="0.70"/>
<rect x="28" y="28" width="5"  height="50" rx="2.5" fill="${c1}" opacity="0.70"/>
<rect x="${W-78}" y="28" width="50" height="5" rx="2.5" fill="${c1}" opacity="0.70"/>
<rect x="${W-33}" y="28" width="5"  height="50" rx="2.5" fill="${c1}" opacity="0.70"/>
<rect x="28" y="${H-33}" width="50" height="5" rx="2.5" fill="${c2}" opacity="0.70"/>
<rect x="28" y="${H-78}" width="5"  height="50" rx="2.5" fill="${c2}" opacity="0.70"/>
<rect x="${W-78}" y="${H-33}" width="50" height="5" rx="2.5" fill="${c2}" opacity="0.70"/>
<rect x="${W-33}" y="${H-78}" width="5"  height="50" rx="2.5" fill="${c2}" opacity="0.70"/>

<!-- ② AfghanFollower logo — white ring for visibility on dark bg -->
<circle cx="${CX}" cy="98" r="100" fill="url(#pgLogoHalo)"/>
<!-- White background ring so blue logo is visible -->
<circle cx="${CX}" cy="98" r="78" fill="#ffffff" fill-opacity="0.96"/>
<!-- Thin coloured border -->
<circle cx="${CX}" cy="98" r="80" fill="none" stroke="${c1}" stroke-width="3" stroke-opacity="0.80"/>
<!-- Actual logo image (always the real PNG) -->
<image href="${logoB64}" xlink:href="${logoB64}"
       x="${CX - 62}" y="36" width="124" height="124"
       filter="url(#pgLogoG)"/>

<!-- ③ Badge -->
<rect x="${CX-210}" y="192" width="420" height="48" rx="24"
      fill="#000000" fill-opacity="0.50" stroke="${c1}" stroke-width="1.8" stroke-opacity="0.65"/>
<text x="${CX}" y="224" font-family="Vazirmatn" font-weight="700" font-size="22"
      fill="${c1}" text-anchor="middle">${escapeXml(badge)}</text>

<!-- ④ Platform icon (social network logo) -->
<g filter="url(#pgIconG)">
  ${platformIcon}
</g>

<!-- ⑤ Headline 1 -->
<text x="${CX}" y="384" font-family="Vazirmatn" font-weight="800" font-size="60"
      fill="#ffffff" text-anchor="middle" direction="rtl"
      filter="url(#pgTextShadow)">${escapeXml(h1)}</text>

<!-- ⑥ Headline 2 — large gradient + neon glow -->
<text x="${CX}" y="464" font-family="Vazirmatn" font-weight="900" font-size="78"
      fill="url(#pgH2)" text-anchor="middle" direction="rtl"
      filter="url(#pgH2G)">${escapeXml(h2)}</text>

<!-- ⑦ Feature cards -->
${featCards}

<!-- ⑧ Divider -->
<rect x="60" y="592" width="${W-120}" height="2.5" rx="1.25" fill="url(#pgDiv)" opacity="0.78"/>

<!-- ⑨ Checklist section — dark bg panel -->
<rect x="50" y="606" width="${W-100}" height="${checkItems.length * CLH + 24}" rx="14"
      fill="#000000" fill-opacity="0.48"/>

<!-- Checklist header -->
<text x="966" y="636" font-family="Vazirmatn" font-weight="800" font-size="26"
      fill="${c1}" text-anchor="end" direction="rtl">خدمات ویژه ما</text>
<rect x="60" y="636" width="340" height="2" rx="1" fill="${c2}" fill-opacity="0.35"/>

<!-- Checklist items -->
${checks}

<!-- ⑩ Accent line above CTA -->
<rect x="60" y="818" width="${W-120}" height="1.5" rx="0.75" fill="url(#pgDiv)" opacity="0.40"/>

<!-- ⑪ CTA button -->
<rect x="60" y="826" width="${W-120}" height="68" rx="34"
      fill="url(#pgCta)" filter="url(#pgCtaG)"/>
<!-- Inner highlight -->
<rect x="62" y="828" width="${W-124}" height="30" rx="31"
      fill="#ffffff" fill-opacity="0.10"/>
<text x="${CX}" y="870" font-family="Vazirmatn" font-weight="800" font-size="30"
      fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(ctaText)}</text>

<!-- ⑫ Footer -->
<!-- Logo small (bottom-left) -->
<circle cx="82" cy="942" r="36" fill="#ffffff" fill-opacity="0.90"/>
<image href="${logoB64}" xlink:href="${logoB64}" x="50" y="910" width="64" height="64"/>

<!-- Stars + tagline -->
${starRow}
<text x="${CX+20}" y="968" font-family="Vazirmatn" font-size="17" fill="#ffffff" fill-opacity="0.55"
      text-anchor="middle" direction="rtl">هزاران مشتری راضی</text>

<!-- Website URL -->
<text x="${W-52}" y="932" font-family="Vazirmatn" font-size="19" fill="${c1}" fill-opacity="0.75"
      text-anchor="end">afghanfollowers.online</text>
<text x="${W-52}" y="956" font-family="Vazirmatn" font-size="15" fill="#ffffff" fill-opacity="0.40"
      text-anchor="end" direction="rtl">پرداخت امن | ضمانت کیفیت</text>

<!-- Bottom gradient border -->
<rect x="0" y="${H-7}" width="${W}" height="7" fill="url(#pgDiv)" opacity="0.85"/>

</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PER-PLATFORM BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildTikTokSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:   'افزایش دیده شدن واقعی در تیک‌تاک',
    h1:      'حساب تیک‌تاکت رو',
    h2:      'متفاوت کن!',
    ctaText: 'سفارش بده و رشد کن!',
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
    platformIconFn: iconTikTok,
  });
}

function buildInstagramSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:   'رشد واقعی اینستاگرام',
    h1:      'پیجت رو',
    h2:      'ستاره کن!',
    ctaText: 'همین حالا شروع کنید!',
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
    platformIconFn: iconInstagram,
  });
}

function buildYoutubeSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:   'رشد کانال یوتیوب',
    h1:      'کانالت رو',
    h2:      'وایرال کن!',
    ctaText: 'رشد کانالت رو شروع کن!',
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
    platformIconFn: iconYouTube,
  });
}

function buildFacebookSvg(text, logoB64) {
  return buildPlatformSvg({
    badge:   'رشد صفحه فیسبوک',
    h1:      'صفحه‌ات رو',
    h2:      'محبوب کن!',
    ctaText: 'صفحه‌ات رو رشد بده!',
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
    platformIconFn: iconFacebook,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

async function getLogoB64() {
  const buf = await sharp(LOGO_PATH).resize(160, 160).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function renderTikTokPostImage(text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildTikTokSvg(text, await getLogoB64()))).png().toBuffer();
}
async function renderInstagramPostImage(text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildInstagramSvg(text, await getLogoB64()))).png().toBuffer();
}
async function renderYoutubePostImage(text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildYoutubeSvg(text, await getLogoB64()))).png().toBuffer();
}
async function renderFacebookPostImage(text) {
  ensureFontconfig();
  return sharp(Buffer.from(buildFacebookSvg(text, await getLogoB64()))).png().toBuffer();
}

module.exports = {
  renderFacebookPostImage,
  renderTikTokPostImage,
  renderInstagramPostImage,
  renderYoutubePostImage,
  pickTemplate,
  TEMPLATE_ORDER,
};
