// Génère les icônes PNG de la page (site/icons/) sans aucune dépendance.
// Usage : node tools/gen-icons.mjs
// Motif « Quand charger ? » (2026-11-21) : croissant de lune et éclair ambre sur un ciel de nuit bleu.
// Même dessin que l'icône de l'appli Android (android/src/main/res/drawable/ic_lanceur_*.xml), repère 108 x 108.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "icons");

const CIEL_HAUT = [0x16, 0x29, 0x5e], CIEL_BAS = [0x24, 0x57, 0xc5];
const LUNE = [0xff, 0xe7, 0xa3], ECLAIR = [0xf0, 0xa6, 0x3a], CONTOUR = [0x16, 0x29, 0x5e], ETOILE = [0xcf, 0xdc, 0xff];

// Repère 108 x 108 (celui des icônes adaptatives d'Android).
const DISQUE_LUNE = [50, 54, 25], DISQUE_OMBRE = [62, 46, 21];
const ECLAIR_POLY = [[66, 31], [76, 31], [69, 46], [79, 46], [60, 77], [64, 54], [55, 54]];
const ETOILES = [[30, 30, 1.4], [80, 26, 1.1], [84, 78, 1.2], [26, 74, 0.9]];
const EPAISSEUR_CONTOUR = 1.0;

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

const dansDisque = (x, y, [cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const DIRECTIONS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

// Couleur du point (x, y) du repère 108 (fond compris).
function couleur(x, y) {
  if (inPoly(x, y, ECLAIR_POLY)) return ECLAIR;
  if (DIRECTIONS.some(([dx, dy]) => inPoly(x + dx * EPAISSEUR_CONTOUR, y + dy * EPAISSEUR_CONTOUR, ECLAIR_POLY))) return CONTOUR;
  if (dansDisque(x, y, DISQUE_LUNE) && !dansDisque(x, y, DISQUE_OMBRE)) return LUNE;
  if (ETOILES.some((e) => dansDisque(x, y, e))) return ETOILE;
  const t = y / 108;
  return CIEL_HAUT.map((c, i) => c + (CIEL_BAS[i] - c) * t);
}

// radius : arrondi des coins du fond (0 = carré plein) ; scale : taille du dessin (1 = repère 108 en entier).
function render(size, { radius, scale }) {
  const SS = 4; // suréchantillonnage 4x4 pour l'anticrénelage
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let n = 0;
      const somme = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (radius !== 0 && !inRoundRect(x, y, radius)) continue;
          n++;
          // le dessin est centré et mis à l'échelle (le dégradé du ciel suit)
          const c = couleur(54 + (x - 0.5) * 108 / scale, 54 + (y - 0.5) * 108 / scale);
          for (let k = 0; k < 3; k++) somme[k] += c[k];
        }
      }
      const i = (py * size + px) * 4;
      for (let k = 0; k < 3; k++) rgba[i + k] = n ? Math.round(somme[k] / n) : 0;
      rgba[i + 3] = Math.round((n / (SS * SS)) * 255);
    }
  }
  return encodePNG(size, rgba);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  // purpose "any" : fond arrondi, dessin agrandi
  ["icon-192.png", 192, { radius: 0.22, scale: 1.3 }],
  ["icon-512.png", 512, { radius: 0.22, scale: 1.3 }],
  // purpose "maskable" : fond plein, dessin dans le cercle de sécurité (rayon 40 %) : échelle 1 (zone sûre 66/108)
  ["icon-maskable-512.png", 512, { radius: 0, scale: 1.0 }],
  // écran d'accueil iOS : opaque, iOS arrondit lui-même
  ["apple-touch-icon.png", 180, { radius: 0, scale: 1.2 }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log("écrit", join("site", "icons", name), `${size}x${size}`);
}
