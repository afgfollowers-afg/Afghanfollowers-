// Auto-post image generator v6
// TikTok: 1080×1920 (9:16 portrait), all others: 1080×1080 square.
//
// Everything is drawn as pure SVG and rasterised by sharp — no template PNGs,
// no browser, no AI image call at post time (this runs inside a Vercel
// serverless function on the daily cron).
//
// ── RTL TEXT RULES (read before touching any <text>) ──────────────────────
// 1. NEVER combine text-anchor="end" with direction="rtl". Under an RTL base
//    direction "end" resolves to the LEFT edge, so the string flows rightwards
//    off the canvas — that is what clipped every checklist row and footer line
//    in v5.
// 2. A single all-Persian run is strong-RTL, so the bidi algorithm shapes it
//    correctly with no `direction` at all. Those use plain LTR anchors:
//    right-aligned → "end", centred → "middle", left-aligned → "start".
// 3. A line built from SEVERAL runs (a coloured <tspan> beside plain text) is
//    different: without a declared base direction the runs are laid out
//    left-to-right in document order, so "خدمات ویژه <tspan>تیک‌تاک</tspan>"
//    renders as "تیک‌تاک خدمات ویژه". Multi-run lines therefore DO set
//    direction="rtl", paired with text-anchor="start" to anchor the RIGHT
//    edge (or "middle" to centre) — never "end", per rule 1.
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
//  ICONS — all drawn around a 0,0 origin so they can be dropped anywhere with
//  a single translate(). Scale via the `s` argument.
// ─────────────────────────────────────────────────────────────────────────────
const ICON_PATHS = {
  // Shield with a tick — quality guarantee
  shield: 'M0,-25 L21,-15 L21,2 C21,17 0,27 0,27 C0,27 -21,17 -21,2 L-21,-15 Z',
  shieldTick: 'M-9,0 L-3,7 L10,-8',
  // Rocket — fast delivery
  rocket: 'M0,-28 C10,-17 15,-4 15,10 L15,17 L-15,17 L-15,10 C-15,-4 -10,-17 0,-28 Z',
  rocketFinL: 'M-15,3 L-26,20 L-15,17 Z',
  rocketFinR: 'M15,3 L26,20 L15,17 Z',
  rocketFlame: 'M-7,19 L0,32 L7,19 Z',
  // Person bust — real followers
  personHead: 'M0,-16 m-10,0 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0',
  personBody: 'M-18,24 C-18,8 -10,1 0,1 C10,1 18,8 18,24 Z',
  // Headset — 24h support
  headBand: 'M-19,6 L-19,-3 A19,19 0 0,1 19,-3 L19,6',
  earL: 'M-22,4 h7 a3,3 0 0,1 3,3 v12 a3,3 0 0,1 -3,3 h-7 a3,3 0 0,1 -3,-3 v-12 a3,3 0 0,1 3,-3 Z',
  earR: 'M22,4 h-7 a3,3 0 0,0 -3,3 v12 a3,3 0 0,0 3,3 h7 a3,3 0 0,0 3,-3 v-12 a3,3 0 0,0 -3,-3 Z'
};

function iconSvg(kind, x, y, color, s) {
  const t = `translate(${x},${y}) scale(${s})`;
  const stroke = `fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'shield':
      return `<g transform="${t}">
  <path d="${ICON_PATHS.shield}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="${ICON_PATHS.shieldTick}" ${stroke}/>
</g>`;
    case 'rocket':
      return `<g transform="${t}">
  <path d="${ICON_PATHS.rocketFinL}" fill="${color}" fill-opacity="0.32" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="${ICON_PATHS.rocketFinR}" fill="${color}" fill-opacity="0.32" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="${ICON_PATHS.rocket}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="0" cy="-5" r="5.5" fill="none" stroke="${color}" stroke-width="2.6"/>
  <path d="${ICON_PATHS.rocketFlame}" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
</g>`;
    case 'person':
      return `<g transform="${t}">
  <path d="${ICON_PATHS.personHead}" fill="${color}"/>
  <path d="${ICON_PATHS.personBody}" fill="${color}" fill-opacity="0.55"/>
</g>`;
    case 'headset':
      return `<g transform="${t}">
  <path d="${ICON_PATHS.headBand}" ${stroke}/>
  <path d="${ICON_PATHS.earL}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="2.4"/>
  <path d="${ICON_PATHS.earR}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="2.4"/>
</g>`;
    default:
      return '';
  }
}

// The TikTok quaver, drawn once and echoed in cyan / pink / white to get the
// brand's signature chromatic split without shipping a raster asset.
const TT_NOTE = 'M22,-48 C22,-31 35,-20 52,-19 L52,0 C39,0 29,-4 21,-11 L21,23 C21,44 5,58 -13,58 C-32,58 -47,44 -47,23 C-47,3 -32,-11 -13,-11 L-13,8 C-22,8 -29,15 -29,23 C-29,31 -22,38 -13,38 C-5,38 3,31 3,23 L3,-48 Z';

function tiktokGlyph(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s})">
  <path d="${TT_NOTE}" fill="#00f2ea" transform="translate(-7,-5)" opacity="0.95"/>
  <path d="${TT_NOTE}" fill="#ff0050" transform="translate(7,5)" opacity="0.95"/>
  <path d="${TT_NOTE}" fill="#ffffff"/>
</g>`;
}

// Five-pointed star used for the social-proof rating row.
const STAR = '0,-10 2.4,-3.4 9.5,-3.1 3.8,1.3 5.9,8.2 0,4.2 -5.9,8.2 -3.8,1.3 -9.5,-3.1 -2.4,-3.4';
function starRow(cx, cy, gap, s, count) {
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) =>
    `<polygon points="${STAR}" transform="translate(${cx + (i - half) * gap},${cy}) scale(${s})" fill="#FFC93C"/>`
  ).join('\n  ');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared <defs> — gradients, glows and the ambient background wash.
// ─────────────────────────────────────────────────────────────────────────────
function sharedDefs(c1, c2, p, ctaA, ctaB) {
  return `
  <radialGradient id="${p}Orb1" cx="76%" cy="7%" r="55%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.42"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${p}Orb2" cx="14%" cy="88%" r="55%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.40"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${p}Orb3" cx="90%" cy="52%" r="34%">
    <stop offset="0%" stop-color="${c2}" stop-opacity="0.20"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${p}Halo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0.62"/><stop offset="70%" stop-color="${c1}" stop-opacity="0.10"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="${p}Accent" x1="1" y1="0" x2="0" y2="0">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient>
  <linearGradient id="${p}Cta" x1="1" y1="0" x2="0" y2="0">
    <stop offset="0%" stop-color="${ctaA}"/><stop offset="100%" stop-color="${ctaB}"/>
  </linearGradient>
  <linearGradient id="${p}Div" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${c1}" stop-opacity="0"/><stop offset="28%" stop-color="${c1}" stop-opacity="0.85"/>
    <stop offset="72%" stop-color="${c2}" stop-opacity="0.85"/><stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="${p}Card" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.07"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0.02"/>
  </linearGradient>
  <filter id="${p}Soft" x="-45%" y="-45%" width="190%" height="190%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="17" result="b"/>
    <feFlood flood-color="${c1}" flood-opacity="0.55" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="${p}Warm" x="-45%" y="-45%" width="190%" height="190%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="20" result="b"/>
    <feFlood flood-color="${c2}" flood-opacity="0.55" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="g"/>
    <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;
}

function ambientBg(W, H, bgBase, c1, c2, p) {
  return `
<rect width="${W}" height="${H}" fill="${bgBase}"/>
<rect width="${W}" height="${H}" fill="url(#${p}Orb1)"/>
<rect width="${W}" height="${H}" fill="url(#${p}Orb2)"/>
<rect width="${W}" height="${H}" fill="url(#${p}Orb3)"/>
<circle cx="${W * 0.1}" cy="${H * 0.2}" r="${W * 0.4}" fill="none" stroke="${c1}" stroke-width="1.3" stroke-opacity="0.10"/>
<circle cx="${W * 0.92}" cy="${H * 0.78}" r="${W * 0.42}" fill="none" stroke="${c2}" stroke-width="1.3" stroke-opacity="0.10"/>
<circle cx="${W - 128}" cy="${H * 0.09}" r="7" fill="${c1}" opacity="0.55"/>
<circle cx="${W - 186}" cy="${H * 0.06}" r="4" fill="${c2}" opacity="0.50"/>
<circle cx="96" cy="${H * 0.88}" r="6" fill="${c1}" opacity="0.42"/>
<circle cx="150" cy="${H * 0.93}" r="3.5" fill="${c2}" opacity="0.45"/>`;
}

// Corner brackets — a light frame that keeps the poster from bleeding away at
// the edges without boxing the whole composition in.
function cornerFrame(W, H, c1, c2) {
  const L = 58, T = 6, M = 34;
  return `
<rect x="${M}" y="${M}" width="${L}" height="${T}" rx="3" fill="${c1}" opacity="0.75"/>
<rect x="${M}" y="${M}" width="${T}" height="${L}" rx="3" fill="${c1}" opacity="0.75"/>
<rect x="${W - M - L}" y="${M}" width="${L}" height="${T}" rx="3" fill="${c1}" opacity="0.75"/>
<rect x="${W - M - T}" y="${M}" width="${T}" height="${L}" rx="3" fill="${c1}" opacity="0.75"/>
<rect x="${M}" y="${H - M - T}" width="${L}" height="${T}" rx="3" fill="${c2}" opacity="0.75"/>
<rect x="${M}" y="${H - M - L}" width="${T}" height="${L}" rx="3" fill="${c2}" opacity="0.75"/>
<rect x="${W - M - L}" y="${H - M - T}" width="${L}" height="${T}" rx="3" fill="${c2}" opacity="0.75"/>
<rect x="${W - M - T}" y="${H - M - L}" width="${T}" height="${L}" rx="3" fill="${c2}" opacity="0.75"/>`;
}

// Four-column capability strip. Index 0 sits furthest RIGHT so the row reads
// in the same direction as the Persian copy inside it.
function featureStrip({ x, y, w, h, items, c1, c2 }) {
  const colW = w / items.length;
  const cells = items.map(([icon, title, sub], i) => {
    const cx  = x + w - colW * (i + 0.5);
    const col = i % 2 === 0 ? c1 : c2;
    const divider = i < items.length - 1
      ? `<rect x="${x + w - colW * (i + 1)}" y="${y + 34}" width="1.6" height="${h - 68}" fill="#ffffff" fill-opacity="0.12"/>`
      : '';
    return `${divider}
  ${iconSvg(icon, cx, y + 52, col, 1.05)}
  <text x="${cx}" y="${y + 116}" font-family="Vazirmatn" font-size="26" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
  <text x="${cx}" y="${y + 152}" font-family="Vazirmatn" font-size="26" fill="#ffffff" fill-opacity="0.62" text-anchor="middle">${escapeXml(sub)}</text>`;
  }).join('\n  ');

  return `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" fill="url(#pCard)" stroke="${c1}" stroke-opacity="0.28" stroke-width="1.8"/>
  ${cells}`;
}

// Right-aligned tick list. The tick sits to the RIGHT of its label, matching
// the reading order of the Persian copy.
function checkList({ xRight, yStart, lineH, items, c1, fontSize }) {
  return items.map((item, i) => {
    const cy = yStart + i * lineH;
    return `
<circle cx="${xRight}" cy="${cy}" r="17" fill="${c1}" fill-opacity="0.12" stroke="${c1}" stroke-width="2.2"/>
<path d="M${xRight - 7.5},${cy + 0.5} L${xRight - 2},${cy + 6} L${xRight + 7.5},${cy - 5.5}" fill="none" stroke="${c1}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${xRight - 34}" y="${cy + 10}" font-family="Vazirmatn" font-size="${fontSize}" fill="#ffffff" fill-opacity="0.94" text-anchor="end">${escapeXml(item)}</text>`;
  }).join('');
}

// Gradient pill CTA with a circular arrow badge on the left (the direction the
// eye travels last in an RTL layout).
function ctaButton({ x, y, w, h, label, p }) {
  const cy = y + h / 2;
  return `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#${p}Cta)" filter="url(#${p}Warm)"/>
<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h * 0.42}" rx="${h / 2}" fill="#ffffff" fill-opacity="0.16"/>
<circle cx="${x + h * 0.62}" cy="${cy}" r="${h * 0.31}" fill="#ffffff"/>
<path d="M${x + h * 0.72},${cy} L${x + h * 0.5},${cy} M${x + h * 0.58},${cy - 9} L${x + h * 0.49},${cy} L${x + h * 0.58},${cy + 9}"
      fill="none" stroke="#1a1030" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${x + w / 2 + h * 0.3}" y="${cy + 15}" font-family="Vazirmatn" font-size="44" fill="#ffffff" text-anchor="middle">${escapeXml(label)}</text>`;
}

// Trust bar, laid out as three fixed cells so nothing has to be measured at
// render time (SVG gives us no text metrics): social proof on the right,
// brand lock-up in the middle, payment reassurance on the left. Cell edges —
// right 730…1030, centre 380…730, left 50…380 — are the budget every string
// below is sized to stay inside.
function footerBar({ W, y, logoB64, c1, c2 }) {
  return `
<rect x="50" y="${y}" width="${W - 100}" height="132" rx="26" fill="#ffffff" fill-opacity="0.045"/>

<!-- right cell — social proof -->
  ${starRow(946, y + 50, 30, 1.25, 5)}
<text x="1006" y="${y + 96}" font-family="Vazirmatn" font-size="24" fill="#ffffff" fill-opacity="0.66" text-anchor="end">هزاران مشتری راضی</text>

<rect x="730" y="${y + 28}" width="1.6" height="76" fill="#ffffff" fill-opacity="0.13"/>

<!-- centre cell — brand lock-up -->
<rect x="400" y="${y + 32}" width="68" height="68" rx="17" fill="#ffffff"/>
<image href="${logoB64}" xlink:href="${logoB64}" x="400" y="${y + 32}" width="68" height="68"/>
<text x="482" y="${y + 62}" font-family="Vazirmatn" font-size="26" fill="#ffffff" text-anchor="start">AfghanFollowers</text>
<text x="482" y="${y + 94}" font-family="Vazirmatn" font-size="21" fill="${c1}" fill-opacity="0.82" text-anchor="start">رشد شما، تخصص ماست</text>

<rect x="380" y="${y + 28}" width="1.6" height="76" fill="#ffffff" fill-opacity="0.13"/>

<!-- left cell — payment reassurance -->
  ${iconSvg('shield', 96, y + 66, c2, 0.88)}
<text x="136" y="${y + 58}" font-family="Vazirmatn" font-size="24" fill="#ffffff" fill-opacity="0.88" text-anchor="start">پرداخت امن</text>
<text x="136" y="${y + 92}" font-family="Vazirmatn" font-size="20" fill="#ffffff" fill-opacity="0.52" text-anchor="start">اطلاعات شما محفوظ</text>`;
}

// The URL sets ~435px wide at 38px, so the globe is parked at x=270 — clear of
// the centred string's left edge (~322) rather than sitting on top of it.
function urlBar({ W, y, c1, p }) {
  const gx = 270;
  return `
<rect x="0" y="${y + 46}" width="${W}" height="5" fill="url(#${p}Div)" opacity="0.85"/>
<circle cx="${gx}" cy="${y + 6}" r="15" fill="none" stroke="${c1}" stroke-width="2.4"/>
<line x1="${gx - 15}" y1="${y + 6}" x2="${gx + 15}" y2="${y + 6}" stroke="${c1}" stroke-width="2.2"/>
<ellipse cx="${gx}" cy="${y + 6}" rx="6.5" ry="15" fill="none" stroke="${c1}" stroke-width="2.2"/>
<text x="${W / 2}" y="${y + 19}" font-family="Vazirmatn" font-size="38" fill="#ffffff" text-anchor="middle">afghanfollowers.online</text>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TIKTOK — 1080 × 1920 (9:16 portrait)
// ─────────────────────────────────────────────────────────────────────────────
function buildTikTokSvg(logoB64) {
  const W = 1080, H = 1920;
  const c1 = '#00f2ea', c2 = '#ff2b55';
  const p  = 'p';

  const features = [
    ['headset', 'پشتیبانی ۲۴ ساعته', 'همیشه در کنار شما'],
    ['person',  'فالوور واقعی',      'و فعال'],
    ['rocket',  'تحویل سریع',        'و آنی'],
    ['shield',  'ضمانت کیفیت',       'و ماندگاری']
  ];

  const services = [
    'افزایش فالوور واقعی و هدفمند',
    'افزایش لایک و ویو و کامنت',
    'افزایش بازدید ویدیو',
    'افزایش بازدید لایو',
    'بدون نیاز به رمز عبور',
    'کاملاً امن و بدون ریزش'
  ];

  // Phone mock-up — a stylised TikTok profile with a rising trend line.
  const PH = { x: 96, y: 764, w: 300, h: 536, r: 38 };
  const phCx = PH.x + PH.w / 2;
  const phone = `
<rect x="${PH.x - 7}" y="${PH.y - 7}" width="${PH.w + 14}" height="${PH.h + 14}" rx="${PH.r + 6}"
      fill="none" stroke="${c1}" stroke-width="2" stroke-opacity="0.45"/>
<rect x="${PH.x}" y="${PH.y}" width="${PH.w}" height="${PH.h}" rx="${PH.r}" fill="#0b0e17" stroke="#2a3348" stroke-width="2.5"/>
<rect x="${phCx - 44}" y="${PH.y + 16}" width="88" height="13" rx="6.5" fill="#212a3d"/>
<text x="${phCx}" y="${PH.y + 62}" font-family="Vazirmatn" font-size="21" fill="#ffffff" fill-opacity="0.85" text-anchor="middle">TikTok</text>
<circle cx="${phCx}" cy="${PH.y + 132}" r="44" fill="#151a28" stroke="${c1}" stroke-width="2.4"/>
  ${tiktokGlyph(phCx, PH.y + 132, 0.42)}
<text x="${phCx}" y="${PH.y + 206}" font-family="Vazirmatn" font-size="19" fill="#ffffff" fill-opacity="0.55" text-anchor="middle">@your_account</text>

<text x="${phCx - 88}" y="${PH.y + 254}" font-family="Vazirmatn" font-size="25" fill="#ffffff" text-anchor="middle">۱۲۰</text>
<text x="${phCx - 88}" y="${PH.y + 278}" font-family="Vazirmatn" font-size="16" fill="#ffffff" fill-opacity="0.45" text-anchor="middle">دنبال‌شده</text>
<text x="${phCx}" y="${PH.y + 254}" font-family="Vazirmatn" font-size="25" fill="${c1}" text-anchor="middle">۲۵.۶K</text>
<text x="${phCx}" y="${PH.y + 278}" font-family="Vazirmatn" font-size="16" fill="#ffffff" fill-opacity="0.45" text-anchor="middle">دنبال‌کننده</text>
<text x="${phCx + 88}" y="${PH.y + 254}" font-family="Vazirmatn" font-size="25" fill="#ffffff" text-anchor="middle">۱.۲M</text>
<text x="${phCx + 88}" y="${PH.y + 278}" font-family="Vazirmatn" font-size="16" fill="#ffffff" fill-opacity="0.45" text-anchor="middle">پسند</text>

<rect x="${phCx - 92}" y="${PH.y + 300}" width="184" height="46" rx="10" fill="${c2}"/>
<text x="${phCx}" y="${PH.y + 331}" font-family="Vazirmatn" font-size="23" fill="#ffffff" text-anchor="middle">دنبال کردن</text>

<polyline points="${PH.x + 34},${PH.y + 476} ${PH.x + 84},${PH.y + 452} ${PH.x + 130},${PH.y + 462} ${PH.x + 178},${PH.y + 424} ${PH.x + 224},${PH.y + 436} ${PH.x + 268},${PH.y + 384}"
          fill="none" stroke="${c2}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M${PH.x + 252},${PH.y + 386} L${PH.x + 270},${PH.y + 380} L${PH.x + 266},${PH.y + 400} Z" fill="${c2}"/>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>${sharedDefs(c1, c2, p, '#ff2b55', '#ff6a3d')}</defs>
${ambientBg(W, H, '#04060e', c1, c2, p)}
${cornerFrame(W, H, c1, c2)}

<!-- ── HERO ──────────────────────────────────────────────────────────────── -->
<circle cx="212" cy="216" r="196" fill="url(#${p}Halo)"/>
<rect x="82" y="86" width="260" height="260" rx="62" fill="#0a0d16" stroke="${c1}" stroke-width="3" stroke-opacity="0.75" filter="url(#${p}Soft)"/>
<rect x="94" y="98" width="236" height="118" rx="52" fill="#ffffff" fill-opacity="0.05"/>
${tiktokGlyph(212, 216, 1.32)}

<rect x="622" y="96" width="410" height="70" rx="35" fill="#12060f" fill-opacity="0.8" stroke="${c2}" stroke-width="2.4"/>
<text x="1000" y="141" font-family="Vazirmatn" font-size="30" fill="${c2}" text-anchor="end">افزایش دیده شدن واقعی</text>

<text x="1024" y="270" font-family="Vazirmatn" font-size="74" fill="#ffffff" text-anchor="end">حساب تیک‌تاکت رو</text>
<text x="1024" y="384" font-family="Vazirmatn" font-size="102" fill="url(#${p}Accent)" text-anchor="end" filter="url(#${p}Warm)">متفاوت کن!</text>
<text x="1024" y="452" font-family="Vazirmatn" font-size="31" fill="#ffffff" fill-opacity="0.72" text-anchor="end">بیشتر دیده شو، بیشتر فالوور بگیر، بیشتر بدرخش</text>

<!-- ── CAPABILITY STRIP ──────────────────────────────────────────────────── -->
${featureStrip({ x: 50, y: 506, w: 980, h: 192, items: features, c1, c2 })}

<!-- ── PHONE + SERVICES ──────────────────────────────────────────────────── -->
${phone}

<rect x="452" y="764" width="578" height="536" rx="30" fill="url(#${p}Card)" stroke="${c1}" stroke-opacity="0.26" stroke-width="1.8"/>
<text x="990" y="836" font-family="Vazirmatn" font-size="40" fill="#ffffff" direction="rtl" text-anchor="start">خدمات ویژه <tspan fill="${c2}">تیک‌تاک</tspan></text>
<rect x="640" y="856" width="350" height="3" rx="1.5" fill="url(#${p}Div)" opacity="0.8"/>
${checkList({ xRight: 990, yStart: 918, lineH: 62, items: services, c1, fontSize: 28 })}

<!-- ── CTA ───────────────────────────────────────────────────────────────── -->
<text x="${W / 2}" y="1392" font-family="Vazirmatn" font-size="42" fill="#ffffff" direction="rtl" text-anchor="middle"><tspan fill="${c2}">همین امروز</tspan> شروع کن و نتیجه رو ببین</text>
${ctaButton({ x: 118, y: 1440, w: W - 236, h: 118, label: 'سفارش بده و رشد کن!', p })}

<!-- ── TRUST BAR + URL ───────────────────────────────────────────────────── -->
${footerBar({ W, y: 1622, logoB64, c1, c2 })}
${urlBar({ W, y: 1826, c1, p })}
</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE (1080×1080) — Instagram, YouTube, Facebook
//  Same visual language, compressed: no phone mock-up, full-width service card.
// ─────────────────────────────────────────────────────────────────────────────
function buildSquareSvg({ badge, h1, h2, tagline, sectionTitle, ctaText, c1, c2, ctaA, ctaB, bgBase, features, services, logoB64, glyph }) {
  const W = 1080, H = 1080;
  const p = 'p';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>${sharedDefs(c1, c2, p, ctaA, ctaB)}</defs>
${ambientBg(W, H, bgBase, c1, c2, p)}
${cornerFrame(W, H, c1, c2)}

<!-- ── HERO ──────────────────────────────────────────────────────────────── -->
<circle cx="176" cy="172" r="150" fill="url(#${p}Halo)"/>
<rect x="76" y="72" width="200" height="200" rx="48" fill="#0a0d16" stroke="${c1}" stroke-width="2.6" stroke-opacity="0.75" filter="url(#${p}Soft)"/>
<rect x="86" y="82" width="180" height="90" rx="40" fill="#ffffff" fill-opacity="0.05"/>
${glyph(176, 172, 1.02)}

<rect x="642" y="78" width="382" height="62" rx="31" fill="#000000" fill-opacity="0.55" stroke="${c2}" stroke-width="2.2"/>
<text x="994" y="118" font-family="Vazirmatn" font-size="27" fill="${c2}" text-anchor="end">${escapeXml(badge)}</text>

<text x="1016" y="222" font-family="Vazirmatn" font-size="60" fill="#ffffff" text-anchor="end">${escapeXml(h1)}</text>
<text x="1016" y="308" font-family="Vazirmatn" font-size="80" fill="url(#${p}Accent)" text-anchor="end" filter="url(#${p}Warm)">${escapeXml(h2)}</text>
<text x="1016" y="360" font-family="Vazirmatn" font-size="26" fill="#ffffff" fill-opacity="0.70" text-anchor="end">${escapeXml(tagline)}</text>

<!-- ── CAPABILITY STRIP ──────────────────────────────────────────────────── -->
${featureStrip({ x: 46, y: 398, w: 988, h: 184, items: features, c1, c2 })}

<!-- ── SERVICES ──────────────────────────────────────────────────────────── -->
<rect x="46" y="606" width="988" height="286" rx="28" fill="url(#${p}Card)" stroke="${c1}" stroke-opacity="0.26" stroke-width="1.8"/>
<text x="994" y="662" font-family="Vazirmatn" font-size="34" fill="#ffffff" text-anchor="end">${escapeXml(sectionTitle)}</text>
<rect x="660" y="680" width="334" height="2.6" rx="1.3" fill="url(#${p}Div)" opacity="0.8"/>

${checkList({ xRight: 994, yStart: 726, lineH: 52, items: services.slice(0, 3), c1, fontSize: 26 })}
${checkList({ xRight: 520, yStart: 726, lineH: 52, items: services.slice(3, 6), c1, fontSize: 26 })}

<!-- ── CTA ───────────────────────────────────────────────────────────────── -->
${ctaButton({ x: 92, y: 918, w: W - 184, h: 96, label: ctaText, p })}

<!-- ── URL ───────────────────────────────────────────────────────────────── -->
<!-- The mark is parked left of the centred URL (which sets ~320px wide at
     28px) so the two never overlap, and the whole row clears the 1073 bar. -->
<rect x="286" y="1006" width="48" height="48" rx="12" fill="#ffffff"/>
<image href="${logoB64}" xlink:href="${logoB64}" x="286" y="1006" width="48" height="48"/>
<text x="${W / 2}" y="1044" font-family="Vazirmatn" font-size="28" fill="#ffffff" fill-opacity="0.92" text-anchor="middle">afghanfollowers.online</text>
<rect x="0" y="${H - 7}" width="${W}" height="7" fill="url(#${p}Div)" opacity="0.9"/>
</svg>`;
}

// Platform glyphs for the square hero tile.
function instagramGlyph(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s})">
  <rect x="-52" y="-52" width="104" height="104" rx="30" fill="none" stroke="#ffffff" stroke-width="9"/>
  <circle cx="0" cy="0" r="26" fill="none" stroke="#ffffff" stroke-width="9"/>
  <circle cx="32" cy="-32" r="7.5" fill="#ffffff"/>
</g>`;
}
function youtubeGlyph(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s})">
  <rect x="-62" y="-44" width="124" height="88" rx="26" fill="#ffffff"/>
  <polygon points="-16,-24 -16,24 26,0" fill="#0a0d16"/>
</g>`;
}
function facebookGlyph(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s})">
  <path d="M14,-52 h22 v30 h-22 c-4,0 -6,2 -6,7 v13 h28 l-5,31 h-23 v46 h-32 v-46 h-22 v-31 h22 v-18 c0,-21 13,-32 38,-32 Z" fill="#ffffff"/>
</g>`;
}

const SQUARE_PLATFORMS = {
  instagram: {
    badge: 'رشد واقعی اینستاگرام',
    h1: 'پیجت رو', h2: 'ستاره کن!',
    tagline: 'بیشتر دیده شو، بیشتر فالوور بگیر',
    sectionTitle: 'خدمات ویژه اینستاگرام',
    ctaText: 'همین حالا شروع کن!',
    c1: '#ff4d8d', c2: '#ff8a3d', bgBase: '#0b0311',
    ctaA: '#ff4d8d', ctaB: '#ff8a3d',
    glyph: instagramGlyph,
    features: [
      ['headset', 'پشتیبانی ۲۴ ساعته', 'همیشه در کنار شما'],
      ['person',  'فالوور فعال',       'واقعی و هدفمند'],
      ['rocket',  'ریچ بالا',          'بیشتر دیده شو'],
      ['shield',  'لایک واقعی',        'بدون فیک']
    ],
    services: [
      'افزایش فالوور فعال و واقعی',
      'افزایش لایک و کامنت ارگانیک',
      'افزایش ریچ پست‌های شما',
      'افزایش بازدید استوری و ریلز',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت'
    ]
  },
  youtube: {
    badge: 'رشد کانال یوتیوب',
    h1: 'کانالت رو', h2: 'وایرال کن!',
    tagline: 'بیشتر دیده شو، بیشتر ساب بگیر',
    sectionTitle: 'خدمات ویژه یوتیوب',
    ctaText: 'رشد کانالت رو شروع کن!',
    c1: '#ff4444', c2: '#ffa62b', bgBase: '#0d0304',
    ctaA: '#ff4444', ctaB: '#ffa62b',
    glyph: youtubeGlyph,
    features: [
      ['headset', 'پشتیبانی ۲۴ ساعته', 'همیشه در کنار شما'],
      ['person',  'ساب واقعی',         'مخاطب هدفمند'],
      ['rocket',  'ویو بالا',          'بازدید واقعی'],
      ['shield',  'لایک واقعی',        'بدون فیک']
    ],
    services: [
      'افزایش ساب‌اسکرایبر واقعی',
      'افزایش بازدید ویدیوها',
      'افزایش لایک و کامنت',
      'افزایش بازدید لایو',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت'
    ]
  },
  facebook: {
    badge: 'رشد صفحه فیسبوک',
    h1: 'صفحه‌ات رو', h2: 'محبوب کن!',
    tagline: 'بیشتر دیده شو، بیشتر تعامل بگیر',
    sectionTitle: 'خدمات ویژه فیسبوک',
    ctaText: 'صفحه‌ات رو رشد بده!',
    c1: '#3d9bff', c2: '#ff9f1a', bgBase: '#030a1c',
    ctaA: '#2f8fff', ctaB: '#00c2ff',
    glyph: facebookGlyph,
    features: [
      ['headset', 'پشتیبانی ۲۴ ساعته', 'همیشه در کنار شما'],
      ['person',  'فالوور فعال',       'هدفمند'],
      ['rocket',  'ریچ بالا',          'بیشتر دیده شو'],
      ['shield',  'لایک واقعی',        'صفحه و پست']
    ],
    services: [
      'افزایش لایک صفحه و پست',
      'افزایش فالوور صفحه فیسبوک',
      'افزایش کامنت و ریکشن',
      'افزایش ریچ پست‌های شما',
      'کاملاً امن و بدون ریزش',
      'تحویل فوری با ضمانت کیفیت'
    ]
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERERS
// ─────────────────────────────────────────────────────────────────────────────
async function getLogoB64() {
  const buf = await sharp(LOGO_PATH).resize(220, 220, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function renderSvg(svg) {
  ensureFontconfig();
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderTikTokPostImage(_text) {
  return renderSvg(buildTikTokSvg(await getLogoB64()));
}
async function renderSquare(key) {
  const cfg = SQUARE_PLATFORMS[key];
  return renderSvg(buildSquareSvg(Object.assign({}, cfg, { logoB64: await getLogoB64() })));
}
async function renderInstagramPostImage(_text) { return renderSquare('instagram'); }
async function renderYoutubePostImage(_text)   { return renderSquare('youtube'); }
async function renderFacebookPostImage(_text)  { return renderSquare('facebook'); }

module.exports = {
  renderFacebookPostImage,
  renderTikTokPostImage,
  renderInstagramPostImage,
  renderYoutubePostImage,
  pickTemplate,
  TEMPLATE_ORDER,
};
