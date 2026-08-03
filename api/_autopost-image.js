// Renders the daily auto-post image: overlays the Groq-generated post text
// onto one of the three platform template PNGs using a rich SVG overlay
// (dark vignette + platform-colored accent divider + styled text card with
// glow border + corner bracket accents + decorative dots).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

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
  const sizes = [64, 56, 48, 42, 36, 32, 28];
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

  // Dark vignette stops at BOX bottom so the template's "afghanfollowers.online"
  // footer (which starts ~y:1010) stays on the original template background.
  const vigH = BOX.y + BOX.height - 530; // from y:530 to bottom of card

  return `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>

    <!-- Dark vignette that darkens the lower portion of the template -->
    <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#04080f" stop-opacity="0"/>
      <stop offset="22%"  stop-color="#04080f" stop-opacity="0.80"/>
      <stop offset="100%" stop-color="#020508" stop-opacity="0.97"/>
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
      <stop offset="0%"   stop-color="#18213f"/>
      <stop offset="100%" stop-color="#0b1028"/>
    </linearGradient>

    <!-- Glow behind the card (uses primary platform colour) -->
    <filter id="cardGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="blur"/>
      <feFlood flood-color="${clrs.p}" flood-opacity="0.28" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="shadow"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Subtle white glow behind text for legibility -->
    <filter id="textGlow" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="blur"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.12" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="shadow"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

  </defs>

  <!-- ① Dark vignette over lower half (stops before the footer) -->
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
        fill="url(#cardBg)" fill-opacity="0.97"
        stroke="${clrs.p}" stroke-width="1.5" stroke-opacity="0.50"
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

module.exports = { renderPostImage, pickTemplate, TEMPLATE_ORDER };
