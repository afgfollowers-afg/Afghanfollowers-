// Renders the daily auto-post image: overlays the Groq-generated post text
// (white, centered, word-wrapped, auto-shrunk to fit) onto one of the three
// platform template PNGs, inside the pre-marked placeholder box each
// template already has baked in ("[Post text will be overlaid here]",
// bordered, same position on all three: x:40-1040, y:242-800 of the
// 1080x1080 canvas).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const TEMPLATES = {
  instagram: path.join(__dirname, '_assets', 'instagram-template.png'),
  tiktok: path.join(__dirname, '_assets', 'tiktok-template.png'),
  youtube: path.join(__dirname, '_assets', 'youtube-template.png')
};
const TEMPLATE_ORDER = ['instagram', 'tiktok', 'youtube'];

const FONT_PATH = path.join(__dirname, '_assets', 'Vazirmatn-Bold.ttf');
// Read once per warm function instance, not once per request.
let fontBase64Cache = null;
function getFontBase64() {
  if (!fontBase64Cache) fontBase64Cache = fs.readFileSync(FONT_PATH).toString('base64');
  return fontBase64Cache;
}

const BOX = { x: 40, y: 242, width: 1000, height: 558 };
const PADDING = { x: 70, y: 50 };

// The image only needs the core sentence(s) — hashtags and the bare URL are
// redundant here (every template already has "afghanfollowers.online" baked
// into its own footer) and, left in, were long enough to overflow the
// placeholder box and collide with that footer. The full text (hashtags,
// URL and all) still goes out as the actual Telegram/Facebook caption —
// this trimming only affects what gets drawn on the image itself.
function coreTextForImage(text) {
  return text
    .replace(/#\S+/g, '')
    .replace(/afghanfollowers\.online/gi, '')
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/).map(l => l.trim()).filter(Boolean).join(' ')
    .trim();
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Greedy word-wrap using a rough average-character-width heuristic — there's
// no real font-metrics access at this layer, so this is tuned by eye against
// Vazirmatn Bold rather than computed exactly. Good enough for a template
// graphic, not pixel-perfect.
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

// Picks the largest font size (from a fixed descending list) whose wrapped
// line count still fits the box height, so a short post renders big and a
// long one shrinks instead of overflowing the placeholder box.
function fitText(text, boxWidth, boxHeight) {
  const sizes = [64, 56, 48, 42, 36, 32, 28];
  for (const fontSize of sizes) {
    const lineHeight = fontSize * 1.5;
    const maxLines = Math.floor(boxHeight / lineHeight);
    const avgCharWidth = fontSize * 0.62; // tuned by eye for Vazirmatn Bold
    const maxCharsPerLine = Math.max(4, Math.floor(boxWidth / avgCharWidth));
    const lines = wrapText(text, maxCharsPerLine);
    if (lines.length <= maxLines) {
      return { fontSize, lineHeight, lines };
    }
  }
  // Fallback for unusually long text: smallest size, hard-capped line count
  // (a slightly overflowing render beats silently producing no lines).
  const fontSize = 28;
  const lineHeight = fontSize * 1.5;
  const maxLines = Math.floor(boxHeight / lineHeight);
  const avgCharWidth = fontSize * 0.62;
  const maxCharsPerLine = Math.max(4, Math.floor(boxWidth / avgCharWidth));
  return { fontSize, lineHeight, lines: wrapText(text, maxCharsPerLine).slice(0, maxLines) };
}

function buildOverlaySvg(text, canvasWidth, canvasHeight) {
  const innerWidth = BOX.width - PADDING.x * 2;
  const innerHeight = BOX.height - PADDING.y * 2;
  const { fontSize, lineHeight, lines } = fitText(coreTextForImage(text), innerWidth, innerHeight);

  const centerX = BOX.x + BOX.width / 2;
  const blockHeight = lines.length * lineHeight;
  // + lineHeight*0.75 shifts from "top of block" to the first line's
  // baseline (SVG <text> y is a baseline, not a top-of-glyph position).
  const startY = BOX.y + BOX.height / 2 - blockHeight / 2 + lineHeight * 0.75;

  const fontBase64 = getFontBase64();
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.06));
  const tspans = lines
    .map((line, i) => `<tspan x="${centerX}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  // SVG's default paint order is fill-then-stroke, so a semi-transparent
  // dark stroke on top of the white fill gives a soft outline for free —
  // needed for legibility since the template's background is a mid-tone
  // blue, not a solid dark surface behind the whole box.
  //
  // The dark backdrop rect (painted before the text, so it sits behind it)
  // isn't just cosmetic: the template's own "[Post text will be overlaid
  // here]" placeholder ghost text lives at this exact position, and gaps
  // between glyphs (especially around Latin words, whose ascender/descender
  // metrics differ from the Farsi lines around them) let it show through
  // without a solid panel underneath.
  return `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        @font-face {
          font-family: 'Vazirmatn';
          src: url(data:font/truetype;base64,${fontBase64}) format('truetype');
          font-weight: bold;
        }
      </style>
    </defs>
    <rect x="${BOX.x + 16}" y="${BOX.y + 16}" width="${BOX.width - 32}" height="${BOX.height - 32}" rx="20" fill="#0b1220" />
    <text
      font-family="Vazirmatn"
      font-weight="bold"
      font-size="${fontSize}"
      fill="#ffffff"
      stroke="#0b1220"
      stroke-width="${strokeWidth}"
      stroke-opacity="0.45"
      text-anchor="middle"
      direction="rtl"
    >${tspans}</text>
  </svg>`;
}

function pickTemplate(dayIndex) {
  return TEMPLATE_ORDER[((dayIndex % TEMPLATE_ORDER.length) + TEMPLATE_ORDER.length) % TEMPLATE_ORDER.length];
}

// Renders one composited PNG buffer: template + white centered wrapped text
// in the pre-marked placeholder box. `templateKey` must be one of
// TEMPLATE_ORDER ('instagram' | 'tiktok' | 'youtube').
async function renderPostImage(templateKey, text) {
  const templatePath = TEMPLATES[templateKey];
  if (!templatePath) throw new Error('Unknown template key: ' + templateKey);
  const templateBuffer = fs.readFileSync(templatePath);
  const meta = await sharp(templateBuffer).metadata();
  const svg = buildOverlaySvg(text, meta.width, meta.height);
  return sharp(templateBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

module.exports = { renderPostImage, pickTemplate, TEMPLATE_ORDER };
