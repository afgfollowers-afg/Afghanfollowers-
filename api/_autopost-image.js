// Renders the daily auto-post image: overlays the Groq-generated post text
// onto one of the three platform template PNGs using a rich SVG overlay
// (dark vignette + platform-colored accent divider + styled text card with
// glow border + corner bracket accents + decorative dots).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '..', 'icons', 'logo-full.png');
const TT_ICON_PATH = path.join(__dirname, '_assets', 'tiktok-icon.jpg');

const TEMPLATES = {
  instagram: path.join(__dirname, '_assets', 'instagram-template.png'),
  tiktok: path.join(__dirname, '_assets', 'tiktok-template.png'),
  youtube: path.join(__dirname, '_assets', 'youtube-template.png')
};
const TEMPLATE_ORDER = ['instagram', 'tiktok', 'youtube'];

// Each platform gets its own two-color accent applied to the divider line,
// card border glow, and corner bracket decorations so every daily post has
// a recognisably different visual identity at a glance.
const PLATFORM_COLORS = {
  instagram: { p: '#E1306C', s: '#F77737' },
  tiktok:    { p: '#00f2ea', s: '#ff0050' },
  youtube:   { p: '#FF3333', s: '#FFAA00' }
};

// Registers the bundled Vazirmatn font via a real fontconfig config written
// to /tmp — the only writable dir in Vercel's serverless Linux runtime.
// See original file comments for the full debugging history of why an
// embedded @font-face data-URI doesn't work in this environment.
const FONT_DIR = path.join(__dirname, '_assets');
const FONTCONFIG_CACHE_DIR = '/tmp/fontconfig-cache';
const FONTCONFIG_FILE_PATH = '/tmp/afghanfollowers-fonts.conf';
let fontconfigReady = false;
function ensureFontconfig() {
  if (fontconfigReady) return;
  try {
    fs.mkdirSync(FONTCONFIG_CACHE_DIR, { recursive: true });
    const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${FONTCONFIG_CACHE_DIR}</cachedir>
</fontconfig>`;
    fs.writeFileSync(FONTCONFIG_FILE_PATH, xml);
    process.env.FONTCONFIG_FILE = FONTCONFIG_FILE_PATH;
  } catch (e) {}
  fontconfigReady = true;
}

// Text card area — sits between the platform label (ends ~y:630) and the
// template's baked-in footer URL (starts ~y:1010), with 44px clearance on
// each end so neither gets obscured by the overlay.
const BOX = { x: 56, y: 636, width: 968, height: 330 };
const PADDING = { x: 52, y: 28 };

// Only Farsi/Arabic-block characters plus safe punctuation survive onto the
// image. Everything else (emoji, Latin, digits) is stripped — librsvg on
// Vercel's Linux runtime renders unsupported codepoints as hex-code boxes,
// not blanks. The full text (emoji, hashtags, URL, brand name) still goes
// out as the Telegram/Facebook caption, which platforms render client-side.
const FARSI_ALLOWLIST = /[؀-ۿ\s!.,:;\-–—()"']/g;

function coreTextForImage(text) {
  const withoutTags = text
    .replace(/#\S+/g, '')
    .replace(/afghanfollowers\.online/gi, '');
  const farsiOnly = (withoutTags.match(FARSI_ALLOWLIST) || []).join('');
  return farsiOnly
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/).map(l => l.trim()).filter(Boolean).join(' ')
    .trim();
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? current + ' ' + w : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Picks the largest font size that fits all wrapped lines inside the box.
function fitText(text, boxWidth, boxHeight) {
  const sizes = [76, 68, 60, 52, 44, 38, 32, 28];
  for (const fontSize of sizes) {
    const lineHeight = fontSize * 1.52;
    const maxLines = Math.floor(boxHeight / lineHeight);
    const avgCharWidth = fontSize * 0.60;
    const maxCharsPerLine = Math.max(4, Math.floor(boxWidth / avgCharWidth));
    const lines = wrapText(text, maxCharsPerLine);
    if (lines.length <= maxLines) return { fontSize, lineHeight, lines };
  }
  const fontSize = 28;
  const lineHeight = fontSize * 1.52;
  const maxLines = Math.floor(boxHeight / lineHeight);
  const avgCharWidth = fontSize * 0.60;
  const maxCharsPerLine = Math.max(4, Math.floor(boxWidth / avgCharWidth));
  return { fontSize, lineHeight, lines: wrapText(text, maxCharsPerLine).slice(0, maxLines) };
}

function buildOverlaySvg(text, canvasWidth, canvasHeight, templateKey) {
  const clrs = PLATFORM_COLORS[templateKey] || PLATFORM_COLORS.instagram;
  const innerWidth  = BOX.width  - PADDING.x * 2;
  const innerHeight = BOX.height - PADDING.y * 2;
  const { fontSize, lineHeight, lines } = fitText(coreTextForImage(text), innerWidth, innerHeight);

  const centerX    = BOX.x + BOX.width / 2;
  const blockH     = lines.length * lineHeight;
  // Shift text down slightly within the card so the decorative dot-row
  // at the card's top has breathing room above the first line.
  const startY     = BOX.y + BOX.height / 2 - blockH / 2 + lineHeight * 0.78 + 14;
  const strokeW    = Math.max(2, Math.round(fontSize * 0.055));

  const tspans = lines
    .map((l, i) => `<tspan x="${centerX}" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`)
    .join('');

  // Accent divider sits 22px above the card's top edge.
  const divY = BOX.y - 22;

  // Top vignette: buries the logo area in darkness so the text card dominates.
  // Fades to fully transparent 30px above the accent divider so the divider
  // and card are unaffected.
  const topVigH = divY - 30; // from y:0 to just before the divider

  // Bottom vignette stops at BOX bottom so the "afghanfollowers.online"
  // footer stays on the original template background.
  const vigH = BOX.y + BOX.height - 530; // from y:530 to bottom of card

  return `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>

    <!-- Top vignette: darkens the logo so it visually recedes -->
    <linearGradient id="vignetteTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#010306" stop-opacity="0.92"/>
      <stop offset="38%"  stop-color="#020508" stop-opacity="0.88"/>
      <stop offset="72%"  stop-color="#04080f" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#04080f" stop-opacity="0"/>
    </linearGradient>

    <!-- Bottom vignette that darkens behind the text card -->
    <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#04080f" stop-opacity="0"/>
      <stop offset="22%"  stop-color="#04080f" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#020508" stop-opacity="0.98"/>
    </linearGradient>

    <!-- Platform-coloured left→right gradient for divider + corners -->
    <linearGradient id="accentH" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${clrs.p}" stop-opacity="0"/>
      <stop offset="25%"  stop-color="${clrs.p}"/>
      <stop offset="75%"  stop-color="${clrs.s}"/>
      <stop offset="100%" stop-color="${clrs.s}" stop-opacity="0"/>
    </linearGradient>

    <!-- Card background: deep dark gradient -->
    <linearGradient id="cardBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#1c2645"/>
      <stop offset="100%" stop-color="#0b1028"/>
    </linearGradient>

    <!-- Glow behind the card (uses primary platform colour) -->
    <filter id="cardGlow" x="-12%" y="-12%" width="124%" height="124%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="blur"/>
      <feFlood flood-color="${clrs.p}" flood-opacity="0.45" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="shadow"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- White glow behind text for legibility -->
    <filter id="textGlow" x="-18%" y="-18%" width="136%" height="136%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="blur"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.20" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="shadow"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

  </defs>

  <!-- ⓪ Top vignette — buries the logo in darkness, making text dominant -->
  <rect x="0" y="0" width="${canvasWidth}" height="${topVigH}"
        fill="url(#vignetteTop)"/>

  <!-- ① Bottom vignette over card area (stops before the footer) -->
  <rect x="0" y="530" width="${canvasWidth}" height="${vigH}"
        fill="url(#vignette)"/>

  <!-- ② Glowing accent divider -->
  <rect x="28" y="${divY}" width="${canvasWidth - 56}" height="5" rx="3"
        fill="url(#accentH)"/>
  <!-- End-cap dots -->
  <circle cx="50"                   cy="${divY + 2}" r="7" fill="${clrs.p}" opacity="0.92"/>
  <circle cx="${canvasWidth - 50}"  cy="${divY + 2}" r="7" fill="${clrs.s}" opacity="0.92"/>

  <!-- ③ Text card with glow border -->
  <rect x="${BOX.x + 6}" y="${BOX.y + 6}"
        width="${BOX.width - 12}" height="${BOX.height - 12}" rx="22"
        fill="url(#cardBg)" fill-opacity="0.98"
        stroke="${clrs.p}" stroke-width="2.5" stroke-opacity="0.85"
        filter="url(#cardGlow)"/>

  <!-- ④ Corner bracket accents — L-shaped lines at each corner -->
  <!-- Top-left -->
  <rect x="${BOX.x + 6}"                    y="${BOX.y + 6}"                     width="58" height="5"  rx="2.5" fill="${clrs.p}"/>
  <rect x="${BOX.x + 6}"                    y="${BOX.y + 6}"                     width="5"  height="46" rx="2.5" fill="${clrs.p}"/>
  <!-- Top-right -->
  <rect x="${BOX.x + BOX.width - 64}"       y="${BOX.y + 6}"                     width="58" height="5"  rx="2.5" fill="${clrs.s}"/>
  <rect x="${BOX.x + BOX.width - 11}"       y="${BOX.y + 6}"                     width="5"  height="46" rx="2.5" fill="${clrs.s}"/>
  <!-- Bottom-left -->
  <rect x="${BOX.x + 6}"                    y="${BOX.y + BOX.height - 11}"       width="58" height="5"  rx="2.5" fill="${clrs.p}" opacity="0.55"/>
  <rect x="${BOX.x + 6}"                    y="${BOX.y + BOX.height - 52}"       width="5"  height="46" rx="2.5" fill="${clrs.p}" opacity="0.55"/>
  <!-- Bottom-right -->
  <rect x="${BOX.x + BOX.width - 64}"       y="${BOX.y + BOX.height - 11}"       width="58" height="5"  rx="2.5" fill="${clrs.s}" opacity="0.55"/>
  <rect x="${BOX.x + BOX.width - 11}"       y="${BOX.y + BOX.height - 52}"       width="5"  height="46" rx="2.5" fill="${clrs.s}" opacity="0.55"/>

  <!-- ⑤ Decorative dot-row inside top of card -->
  <circle cx="${centerX - 110}" cy="${BOX.y + 38}" r="3.5" fill="${clrs.p}" opacity="0.70"/>
  <circle cx="${centerX - 40}"  cy="${BOX.y + 30}" r="2.5" fill="#ffffff"   opacity="0.45"/>
  <circle cx="${centerX}"       cy="${BOX.y + 34}" r="4.5" fill="#ffffff"   opacity="0.60"/>
  <circle cx="${centerX + 40}"  cy="${BOX.y + 30}" r="2.5" fill="#ffffff"   opacity="0.45"/>
  <circle cx="${centerX + 110}" cy="${BOX.y + 38}" r="3.5" fill="${clrs.s}" opacity="0.70"/>

  <!-- Thin horizontal separator below the dots -->
  <rect x="${centerX - 140}" y="${BOX.y + 56}" width="280" height="1.5" rx="1"
        fill="url(#accentH)" opacity="0.35"/>

  <!-- ⑥ Farsi post text — bold white with dark stroke for legibility -->
  <text
    font-family="Vazirmatn"
    font-weight="bold"
    font-size="${fontSize}"
    fill="#ffffff"
    stroke="#020508"
    stroke-width="${strokeW}"
    stroke-opacity="0.55"
    text-anchor="middle"
    direction="rtl"
    filter="url(#textGlow)"
  >${tspans}</text>

</svg>`;
}

function pickTemplate(dayIndex) {
  return TEMPLATE_ORDER[((dayIndex % TEMPLATE_ORDER.length) + TEMPLATE_ORDER.length) % TEMPLATE_ORDER.length];
}

async function renderPostImage(templateKey, text) {
  ensureFontconfig();
  const templatePath = TEMPLATES[templateKey];
  if (!templatePath) throw new Error('Unknown template key: ' + templateKey);
  const templateBuffer = fs.readFileSync(templatePath);
  const meta = await sharp(templateBuffer).metadata();
  const svg = buildOverlaySvg(text, meta.width, meta.height, templateKey);
  return sharp(templateBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// Reusable SVG shape primitives (centered at 0,0) used by both the Facebook
// and TikTok reaction-icon backgrounds. Pure SVG geometry — no emoji.
const REACT_HEART = 'M0,10 C0,10 -16,4 -16,-4 C-16,-12 -8,-14 0,-8 C8,-14 16,-12 16,-4 C16,4 0,10 0,10Z';
const REACT_STAR  = '0,-14 3.53,-4.85 13.31,-4.33 5.71,1.85 8.23,11.33 0,6 -8.23,11.33 -5.71,1.85 -13.31,-4.33 -3.53,-4.85';
const REACT_FLAME = 'M0,16 C-10,10 -13,2 -9,-8 C-7,-3 -3,1 0,4 C0,-4 4,-12 7,-16 C10,-8 11,0 8,8 C12,4 13,-2 11,-9 C15,-4 14,6 9,12 C7,16 3,17 0,16Z';

// Returns scattered reaction shapes: hearts ❤️, stars ⭐, flames 🔥,
// and 😍-style smiley faces with heart eyes.
function reactionIcons() {
  // [cx, cy, type, fill, scale, rotDeg, opacity]
  const items = [
    [85,   142, 'heart', '#FF3366', 1.30, -12, 0.13],
    [540,  70,  'heart', '#FF4477', 1.00,   8, 0.10],
    [990,  878, 'heart', '#FF3366', 1.20,  18, 0.11],
    [920,  500, 'heart', '#FF6699', 0.80,  22, 0.08],
    [200,  820, 'heart', '#FF3366', 0.75, -22, 0.07],
    [748,  980, 'heart', '#FF4477', 0.70,  10, 0.07],

    [960,  142, 'star',  '#FFD700', 1.20, -10, 0.12],
    [120,  958, 'star',  '#FFD700', 1.00,  20, 0.10],
    [820,  66,  'star',  '#FFC040', 0.75,   5, 0.09],
    [340, 1010, 'star',  '#FFD700', 0.70,  -8, 0.08],

    [62,   380, 'flame', '#FF6B00', 1.10,   5, 0.10],
    [1010, 620, 'flame', '#FF7722', 1.00,  -5, 0.09],
    [680,  970, 'flame', '#FF6B00', 0.80,   0, 0.08],
    [180,  280, 'flame', '#FF7722', 0.65,   8, 0.06],
  ];

  const simple = items.map(([cx, cy, type, fill, scale, rot, opacity]) => {
    const t  = `translate(${cx},${cy}) rotate(${rot}) scale(${scale})`;
    const op = `opacity="${opacity}"`;
    if (type === 'heart') return `<path transform="${t}" ${op} d="${REACT_HEART}" fill="${fill}"/>`;
    if (type === 'star')  return `<polygon transform="${t}" ${op} points="${REACT_STAR}" fill="${fill}"/>`;
    if (type === 'flame') return `<path transform="${t}" ${op} d="${REACT_FLAME}" fill="${fill}"/>`;
    return '';
  }).join('\n  ');

  // 😍 smiley with heart eyes (face circle + two tiny hearts + smile arc)
  const smileys = [
    [1000, 200, 1.10, -10, 0.09],
    [80,   870, 1.00,  15, 0.08],
    [600, 1010, 0.80,  -5, 0.07],
  ].map(([cx, cy, scale, rot, op]) => {
    const t = `translate(${cx},${cy}) rotate(${rot}) scale(${scale})`;
    return `<g transform="${t}" opacity="${op}">
      <circle cx="0" cy="0" r="16" fill="#FFE566"/>
      <path transform="translate(-6,-5) scale(0.48)" d="${REACT_HEART}" fill="#FF3366"/>
      <path transform="translate(6,-5) scale(0.48)" d="${REACT_HEART}" fill="#FF3366"/>
      <path d="M-8,6 C-4,11 4,11 8,6" fill="none" stroke="#CC8800" stroke-width="2.5" stroke-linecap="round"/>
    </g>`;
  }).join('\n  ');

  return simple + '\n  ' + smileys;
}

// Builds a 1080×1080 SVG for the daily Facebook auto-post.
// Fixed layout: dark navy background, radial-gradient orbs, dot grid,
// scattered social-media outline icons, centred glass card, logo box,
// Instagram camera icon, fixed heading, 4 feature labels and CTA button.
// Only the subtitle (cleaned Farsi text from the AI-generated post) changes.
function buildFacebookSvg(text, logoB64) {
  const W = 1080, H = 1080;
  const CARD = { x: 140, y: 140, w: 800, h: 800 };
  const CX = W / 2; // 540

  const subtitle = coreTextForImage(text);
  const subLines = wrapText(subtitle, 38).slice(0, 2);
  const features = ['فالوور واقعی', 'لایک و ویو', 'تحویل سریع', 'پشتیبانی ۲۴ ساعته'];

  const logoBoxY = 184;
  const igIconY  = 356;
  const h1Y1     = 450;
  const h1Y2     = 500;
  const subY1    = 538;
  const featW    = (CARD.w - 80 - 16) / 2; // 352
  const feat1X   = CARD.x + 40; // 180
  const feat2X   = feat1X + featW + 16; // 548
  const featH    = 78;
  const featY1   = 594;
  const featY2   = featY1 + featH + 14; // 648
  const accentY  = featY2 + featH + 26; // 752
  const btnY     = accentY + 26; // 778
  const footerY  = btnY + 52 + 24; // 854

  const featCards = features.map((label, i) => {
    const row = Math.floor(i / 2), col = i % 2;
    const fx = col === 0 ? feat1X : feat2X;
    const fy = row === 0 ? featY1 : featY2;
    return `<rect x="${fx}" y="${fy}" width="${featW}" height="${featH}" rx="16"
    fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>
  <text x="${fx + featW / 2}" y="${fy + featH / 2 + 7}" font-family="Vazirmatn" font-weight="700"
    font-size="17" fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(label)}</text>`;
  }).join('\n  ');

  const subBlock = subLines.length ? `<text font-family="Vazirmatn" font-size="19" fill="#9ab0cc"
    text-anchor="middle" direction="rtl">${
    subLines.map((l, i) => `<tspan x="${CX}" y="${subY1 + i * 28}">${escapeXml(l)}</tspan>`).join('')
  }</text>` : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <radialGradient id="fbOrbBlue" cx="82%" cy="12%" r="45%">
      <stop offset="0%" stop-color="#1450c8" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#0B3D91" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fbOrbOrg" cx="16%" cy="90%" r="35%">
      <stop offset="0%" stop-color="#FF9F1A" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#FF9F1A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fbOrbPurp" cx="12%" cy="50%" r="35%">
      <stop offset="0%" stop-color="#6030d8" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#5028b4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fbCenterGlow" cx="50%" cy="50%" r="42%">
      <stop offset="0%" stop-color="#1a3a8a" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#0B3D91" stop-opacity="0"/>
    </radialGradient>
    <pattern id="fbDots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="14" cy="14" r="1.3" fill="#4466cc" fill-opacity="0.38"/>
    </pattern>
    <linearGradient id="fbCardShine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.09"/>
      <stop offset="45%"  stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="fbDotMaskGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="white" stop-opacity="1"/>
      <stop offset="70%" stop-color="white" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
    <mask id="fbDotMask">
      <rect width="${W}" height="${H}" fill="url(#fbDotMaskGrad)"/>
    </mask>
    <linearGradient id="fbLogoBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B3D91"/>
      <stop offset="100%" stop-color="#132A63"/>
    </linearGradient>
    <linearGradient id="fbAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FF9F1A" stop-opacity="0"/>
      <stop offset="30%" stop-color="#FF9F1A"/>
      <stop offset="70%" stop-color="#e07800"/>
      <stop offset="100%" stop-color="#e07800" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fbBtn" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FF9F1A"/>
      <stop offset="100%" stop-color="#e07800"/>
    </linearGradient>
    <filter id="fbCardGlow" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="18" result="blur"/>
      <feFlood flood-color="#0B3D91" flood-opacity="0.28" result="c"/>
      <feComposite in="c" in2="blur" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="fbLogoGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="blur"/>
      <feFlood flood-color="#1155cc" flood-opacity="0.65" result="c"/>
      <feComposite in="c" in2="blur" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="#060E2C"/>
  <rect width="${W}" height="${H}" fill="url(#fbOrbBlue)"/>
  <rect width="${W}" height="${H}" fill="url(#fbOrbOrg)"/>
  <rect width="${W}" height="${H}" fill="url(#fbOrbPurp)"/>
  <rect width="${W}" height="${H}" fill="url(#fbCenterGlow)"/>
  <rect width="${W}" height="${H}" fill="url(#fbDots)" mask="url(#fbDotMask)"/>

  ${reactionIcons()}

  <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="48"
        fill="#ffffff" fill-opacity="0.05"
        stroke="#ffffff" stroke-opacity="0.10" stroke-width="1.5"
        filter="url(#fbCardGlow)"/>
  <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="48"
        fill="url(#fbCardShine)"/>

  <rect x="${CX - 75}" y="${logoBoxY}" width="150" height="150" rx="40"
        fill="url(#fbLogoBg)" filter="url(#fbLogoGlow)"/>
  <image href="${logoB64}" xlink:href="${logoB64}"
         x="${CX - 64}" y="${logoBoxY + 11}" width="128" height="128"/>

  <rect x="${CX - 18}" y="${igIconY}" width="36" height="36" rx="8" fill="#E1306C" fill-opacity="0.85"/>
  <rect x="${CX - 14}" y="${igIconY + 4}" width="28" height="28" rx="5"
        fill="none" stroke="#ffffff" stroke-width="2.2"/>
  <circle cx="${CX}" cy="${igIconY + 18}" r="7" fill="none" stroke="#ffffff" stroke-width="2"/>
  <circle cx="${CX + 11}" cy="${igIconY + 7}" r="2.2" fill="#ffffff"/>

  <text x="${CX}" y="${h1Y1}" font-family="Vazirmatn" font-weight="800" font-size="38"
        fill="#ffffff" text-anchor="middle" direction="rtl">رشد واقعی اینستاگرام</text>
  <text x="${CX}" y="${h1Y2}" font-family="Vazirmatn" font-weight="700" font-size="30"
        fill="#FF9F1A" text-anchor="middle">با AfghanFollower</text>

  ${subBlock}

  ${featCards}

  <rect x="${CARD.x + 80}" y="${accentY}" width="${CARD.w - 160}" height="2.5" rx="1.25"
        fill="url(#fbAccent)"/>

  <rect x="${CX - 155}" y="${btnY}" width="310" height="52" rx="26" fill="url(#fbBtn)"/>
  <text x="${CX}" y="${btnY + 34}" font-family="Vazirmatn" font-weight="700" font-size="19"
        fill="#040B28" text-anchor="middle" direction="rtl">همین حالا شروع کنید</text>

  <text x="${CX}" y="${footerY}" font-family="Vazirmatn" font-size="15"
        fill="#FF9F1A" fill-opacity="0.75" text-anchor="middle">
    afghanfollowers.online
  </text>
</svg>`;
}

async function renderFacebookPostImage(text) {
  ensureFontconfig();
  const logoBuffer = await sharp(LOGO_PATH).resize(150, 150).png().toBuffer();
  const logoB64 = 'data:image/png;base64,' + logoBuffer.toString('base64');
  const svg = buildFacebookSvg(text, logoB64);
  return sharp(Buffer.from(svg)).png().toBuffer();
}


// 1080×1080 TikTok post image — same card layout as the Facebook variant but
// with TikTok's near-black + cyan + pink colour scheme, a music-note platform
// icon, and a cyan→pink accent/CTA gradient.
function buildTikTokSvg(text, logoB64, ttIconB64) {
  const W = 1080, H = 1080;
  const CARD = { x: 140, y: 140, w: 800, h: 800 };
  const CX = W / 2; // 540

  const subtitle = coreTextForImage(text);
  const subLines = wrapText(subtitle, 38).slice(0, 2);
  const features = ['فالوور واقعی', 'لایک و ویو', 'تحویل سریع', 'پشتیبانی ۲۴ ساعته'];

  const logoBoxY = 184;
  const igIconY  = 352;  // icon 120×120 → bottom 472; gap to h1Y1 = 16px
  const h1Y1     = 488;
  const h1Y2     = 536;
  const subY1    = 572;
  const featW    = (CARD.w - 80 - 16) / 2;
  const feat1X   = CARD.x + 40;
  const feat2X   = feat1X + featW + 16;
  const featH    = 78;
  const featY1   = 628;
  const featY2   = featY1 + featH + 14;
  const accentY  = featY2 + featH + 26;
  const btnY     = accentY + 26;
  const footerY  = btnY + 52 + 24;

  const featCards = features.map((label, i) => {
    const row = Math.floor(i / 2), col = i % 2;
    const fx = col === 0 ? feat1X : feat2X;
    const fy = row === 0 ? featY1 : featY2;
    return `<rect x="${fx}" y="${fy}" width="${featW}" height="${featH}" rx="16"
    fill="#ffffff" fill-opacity="0.05" stroke="#00f2ea" stroke-opacity="0.18" stroke-width="1"/>
  <text x="${fx + featW / 2}" y="${fy + featH / 2 + 7}" font-family="Vazirmatn" font-weight="700"
    font-size="17" fill="#ffffff" text-anchor="middle" direction="rtl">${escapeXml(label)}</text>`;
  }).join('\n  ');

  const subBlock = subLines.length ? `<text font-family="Vazirmatn" font-size="19" fill="#88cccc"
    text-anchor="middle" direction="rtl">${
    subLines.map((l, i) => `<tspan x="${CX}" y="${subY1 + i * 28}">${escapeXml(l)}</tspan>`).join('')
  }</text>` : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <radialGradient id="ttOrbCyan" cx="82%" cy="12%" r="45%">
      <stop offset="0%" stop-color="#00f2ea" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#00f2ea" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ttOrbPink" cx="16%" cy="90%" r="35%">
      <stop offset="0%" stop-color="#ff0050" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#ff0050" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ttOrbPurp" cx="12%" cy="50%" r="32%">
      <stop offset="0%" stop-color="#4010a0" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#4010a0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ttCenterGlow" cx="50%" cy="50%" r="42%">
      <stop offset="0%" stop-color="#004444" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#004444" stop-opacity="0"/>
    </radialGradient>
    <pattern id="ttDots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="14" cy="14" r="1.2" fill="#00f2ea" fill-opacity="0.18"/>
    </pattern>
    <radialGradient id="ttDotMaskGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="white" stop-opacity="1"/>
      <stop offset="70%" stop-color="white" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
    <mask id="ttDotMask">
      <rect width="${W}" height="${H}" fill="url(#ttDotMaskGrad)"/>
    </mask>
    <linearGradient id="ttLogoBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d0d0d"/>
      <stop offset="100%" stop-color="#060606"/>
    </linearGradient>
    <linearGradient id="ttAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#00f2ea" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#00f2ea"/>
      <stop offset="70%"  stop-color="#ff0050"/>
      <stop offset="100%" stop-color="#ff0050" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ttBtn" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#00d4cc"/>
      <stop offset="100%" stop-color="#ff0050"/>
    </linearGradient>
    <linearGradient id="ttCardShine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="45%"  stop-color="#ffffff" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="ttCardGlow" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="18" result="blur"/>
      <feFlood flood-color="#00f2ea" flood-opacity="0.20" result="c"/>
      <feComposite in="c" in2="blur" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="ttLogoGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="blur"/>
      <feFlood flood-color="#00f2ea" flood-opacity="0.55" result="c"/>
      <feComposite in="c" in2="blur" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="#07080C"/>
  <rect width="${W}" height="${H}" fill="url(#ttOrbCyan)"/>
  <rect width="${W}" height="${H}" fill="url(#ttOrbPink)"/>
  <rect width="${W}" height="${H}" fill="url(#ttOrbPurp)"/>
  <rect width="${W}" height="${H}" fill="url(#ttCenterGlow)"/>
  <rect width="${W}" height="${H}" fill="url(#ttDots)" mask="url(#ttDotMask)"/>

  ${reactionIcons()}

  <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="48"
        fill="#ffffff" fill-opacity="0.04"
        stroke="#00f2ea" stroke-opacity="0.14" stroke-width="1.5"
        filter="url(#ttCardGlow)"/>
  <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="48"
        fill="url(#ttCardShine)"/>

  <!-- Logo box (dark with cyan glow) -->
  <rect x="${CX - 75}" y="${logoBoxY}" width="150" height="150" rx="40"
        fill="url(#ttLogoBg)" filter="url(#ttLogoGlow)"/>
  <image href="${logoB64}" xlink:href="${logoB64}"
         x="${CX - 64}" y="${logoBoxY + 11}" width="128" height="128"/>

  <!-- TikTok platform icon — real brand logo, circle-clipped -->
  <image href="${ttIconB64}" xlink:href="${ttIconB64}"
         x="${CX - 65}" y="${igIconY}" width="130" height="130"/>

  <!-- Heading -->
  <text x="${CX}" y="${h1Y1}" font-family="Vazirmatn" font-weight="800" font-size="38"
        fill="#ffffff" text-anchor="middle" direction="rtl">محتوای وایرال در تیک‌تاک</text>
  <text x="${CX}" y="${h1Y2}" font-family="Vazirmatn" font-weight="700" font-size="30"
        fill="#00f2ea" text-anchor="middle">با AfghanFollower</text>

  ${subBlock}

  ${featCards}

  <rect x="${CARD.x + 80}" y="${accentY}" width="${CARD.w - 160}" height="2.5" rx="1.25"
        fill="url(#ttAccent)"/>

  <rect x="${CX - 155}" y="${btnY}" width="310" height="52" rx="26" fill="url(#ttBtn)"/>
  <text x="${CX}" y="${btnY + 34}" font-family="Vazirmatn" font-weight="700" font-size="19"
        fill="#ffffff" text-anchor="middle" direction="rtl">همین حالا شروع کنید</text>

  <text x="${CX}" y="${footerY}" font-family="Vazirmatn" font-size="15"
        fill="#00f2ea" fill-opacity="0.75" text-anchor="middle">
    afghanfollowers.online
  </text>
</svg>`;
}

async function renderTikTokPostImage(text) {
  ensureFontconfig();
  const SZ = 130;
  const [logoBuffer, iconBuffer] = await Promise.all([
    sharp(LOGO_PATH).resize(150, 150).png().toBuffer(),
    (async () => {
      // Load at full resolution, add alpha, then erase dark/black background pixels
      const { data, info } = await sharp(TT_ICON_PATH)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // Threshold: dark pixels (background) → fully transparent
        if (r < 90 && g < 90 && b < 90) data[i + 3] = 0;
      }
      return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .resize(SZ, SZ)
        .png()
        .toBuffer();
    })(),
  ]);
  const logoB64   = 'data:image/png;base64,' + logoBuffer.toString('base64');
  const ttIconB64 = 'data:image/png;base64,' + iconBuffer.toString('base64');
  const svg = buildTikTokSvg(text, logoB64, ttIconB64);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderPostImage, renderFacebookPostImage, renderTikTokPostImage, pickTemplate, TEMPLATE_ORDER };
