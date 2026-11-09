// Génère les icônes PNG de la page (site/icons/) sans aucune dépendance.
// Usage : node tools/gen-icons.mjs
// Motif : éclair ambre sur fond bleu (couleurs de la page : --charge et --accent sombre).

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "icons");

const BG = [0x24, 0x57, 0xc5];   // bleu de charge
const BOLT = [0xf0, 0xa6, 0x3a]; // ambre heures creuses

// Éclair dans un carré unité (x, y entre 0 et 1).
const BOLT_POLY = [
  [0.52, 0.05], [0.70, 0.05], [0.56, 0.40], [0.78, 0.40],
  [0.36, 0.95], [0.46, 0.55], [0.24, 0.55],
];

// --- PNG ---
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // profondeur
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre : aucun
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Dessin ---
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x, y, r) {
  // carré unité aux coins arrondis de rayon r
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// radius : arrondi des coins du fond (0 = carré plein) ; scale : taille de l'éclair.
function render(size, { radius, scale }) {
  const SS = 4; // suréchantillonnage 4x4 pour l'anticrénelage
  const rgba = Buffer.alloc(size * size * 4);
  // éclair centré : on centre sa boîte englobante
  const bx0 = 0.24, bx1 = 0.78, by0 = 0.05, by1 = 0.95;
  const bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2;
  const poly = BOLT_POLY.map(([x, y]) => [0.5 + (x - bcx) * scale, 0.5 + (y - bcy) * scale]);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, bolt = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (radius === 0 || inRoundRect(x, y, radius)) {
            bg++;
            if (inPoly(x, y, poly)) bolt++;
          }
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const t = bg ? bolt / bg : 0;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - t) + BOLT[c] * t);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(size, rgba);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  // purpose "any" : fond arrondi, éclair grand
  ["icon-192.png", 192, { radius: 0.22, scale: 0.72 }],
  ["icon-512.png", 512, { radius: 0.22, scale: 0.72 }],
  // purpose "maskable" : fond plein, éclair dans le cercle de sécurité (rayon 40 %)
  // demi-diagonale de l'éclair = 0,525 x scale <= 0,40  =>  scale <= 0,76
  ["icon-maskable-512.png", 512, { radius: 0, scale: 0.6 }],
  // écran d'accueil iOS : opaque, iOS arrondit lui-même
  ["apple-touch-icon.png", 180, { radius: 0, scale: 0.68 }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log("écrit", join("site", "icons", name), `${size}x${size}`);
}
