// Draws the tray icon in code so it can reflect the pinned agent's usage.
// macOS: a template ring gauge (the number goes in the menu bar title).
// Windows and Linux have no tray title, so the number is drawn into the icon.
const zlib = require('zlib');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const COLORS = {
  calm: null, // uses the foreground colour
  warn: [240, 169, 59],
  crit: [255, 107, 87],
};

// Ring that fills clockwise from the top.
function ring(size, pct, fg, accent) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const rOut = size * 0.42;
  const rIn = size * 0.27;
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let on = 0;
      let dim = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - c;
          const dy = y + (sy + 0.5) / SS - c;
          const r = Math.hypot(dx, dy);
          if (r < rIn || r > rOut) continue;
          let a = Math.atan2(dx, -dy);
          if (a < 0) a += Math.PI * 2;
          if (frac > 0 && a / (Math.PI * 2) <= frac) on++; else dim++;
        }
      }
      const total = SS * SS;
      const alpha = (on + dim * (pct == null ? 0.55 : 0.3)) / total;
      const useAccent = accent && on >= dim;
      const col = useAccent ? accent : fg;
      const i = (y * size + x) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2];
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}

const DIGITS = [
  '.###.#...##..###.#.###..##...#.###.',
  '..#...##....#....#....#....#...###.',
  '.###.#...#....#...#...#...#...#####',
  '.###.#...#....#..##.....##...#.###.',
  '...#...##..#.#.#..#.#####...#....#.',
  '######....####.....#....##...#.###.',
  '.###.#....#....####.#...##...#.###.',
  '#####....#...#...#...#....#....#...',
  '.###.#...##...#.###.#...##...#.###.',
  '.###.#...##...#.####....#....#.###.',
];

// Two digits over a thin bar, for trays that can't show text.
function digits(size, pct, fg, accent) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 16; // 16 logical px
  const put = (x, y, w, h, col, a = 255) => {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const i = (yy * size + xx) * 4;
        buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = a;
      }
    }
  };
  const text = String(Math.min(99, Math.max(0, Math.round(pct))));
  const cell = s * 1.25; // one font pixel
  const width = text.length * 5 * cell + (text.length - 1) * cell * 1.2;
  let x0 = (size - width) / 2;
  for (const ch of text) {
    const glyph = DIGITS[Number(ch)];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (glyph[r * 5 + c] === '#') put(x0 + c * cell, s * 1 + r * cell, cell, cell, fg);
    }
    x0 += 5 * cell + cell * 1.2;
  }
  const barY = s * 12;
  const barH = s * 2.5;
  put(s, barY, s * 14, barH, fg, 80);
  put(s, barY, s * 14 * Math.min(1, pct / 100), barH, accent || fg);
  return buf;
}

function makeIcon({ pct, level, platform, dark }) {
  const { nativeImage } = require('electron');
  const accent = COLORS[level] || null;
  if (platform === 'darwin') {
    const size = 36;
    const img = nativeImage.createFromBuffer(png(size, size, ring(size, pct, [0, 0, 0], null)), { scaleFactor: 2 });
    img.setTemplateImage(true);
    return img;
  }
  const size = 32;
  const fg = dark ? [255, 255, 255] : [23, 33, 43];
  const pixels = pct == null ? ring(size, null, fg, null) : digits(size, pct, fg, accent);
  return nativeImage.createFromBuffer(png(size, size, pixels), { scaleFactor: 2 });
}

module.exports = { makeIcon, png, ring, digits };
