// Génère site/vehicules.json (marque → modèle → version → capacité utile) à partir
// d'Open EV Data (https://github.com/KilowattApp/open-ev-data, licence MIT, citation obligatoire).
//
// Usage : node tools/gen-vehicules.mjs <ev-data.json téléchargé> [tools/vehicules-corrections.json]
//
// Le fichier source est une donnée externe : on n'en garde que des chaînes courtes et
// des nombres plausibles, tout le reste est ignoré. Aucune exécution de son contenu.

import { readFileSync, writeFileSync } from "node:fs";

const [src, corrFile = "tools/vehicules-corrections.json"] = process.argv.slice(2);
if (!src) { console.error("Usage : node tools/gen-vehicules.mjs <ev-data.json> [corrections.json]"); process.exit(1); }

const brut = JSON.parse(readFileSync(src, "utf8"));
const corr = JSON.parse(readFileSync(corrFile, "utf8"));

// Noms de modèle réellement en minuscules. Les autres noms tout en minuscules de la base
// ont perdu leur nom de base à l'import (Tesla « 3 long range », Peugeot « suv »…) : écartés.
const MINUSCULES_OK = new Set(["e-208", "e-308", "e-2008", "e-3008", "i3", "i4", "i5", "i7", "500e", "600e", "e-up", "#1", "#3", "6e"]);

const texte = (s) => typeof s === "string" && s.length <= 60 && !/[<>]/.test(s) ? s.replace(/\s+/g, " ").trim() : null;
const capOk = (x) => typeof x === "number" && isFinite(x) && x >= 5 && x <= 250;
const anOk = (x) => Number.isInteger(x) && x >= 2008 && x <= 2030;

let ecartes = { type: 0, nom: 0, valeur: 0, correction: 0 };
const exclus = new Set(corr.exclure.map((e) => [e.marque, e.modele].join("|")));
const lignes = [];
for (const v of brut.data || []) {
  if (v.vehicle_type !== "car") { ecartes.type++; continue; }
  let marque = texte(v.brand), modele = texte(v.model), version = texte(v.variant ?? "") ?? "";
  if (!marque || !modele || !capOk(v.usable_battery_size) || !anOk(v.release_year)) { ecartes.valeur++; continue; }
  if (modele === modele.toLowerCase() && !MINUSCULES_OK.has(modele)) { ecartes.nom++; continue; }
  if (exclus.has(marque + "|" + modele)) { ecartes.correction++; continue; }
  // « e-208 51 kWh » : la capacité va dans la version, le modèle reste « e-208 ».
  const m = modele.match(/^(.+?)\s+(\d+(?:[.,]\d+)?\s*kWh.*)$/i);
  if (m) { modele = m[1]; version = (m[2] + (version ? " " + version : "")).trim(); }
  lignes.push({ marque, modele, version, an: v.release_year, cap: Math.round(v.usable_battery_size * 10) / 10 });
}
for (const a of corr.ajouter) lignes.push({ marque: a.marque, modele: a.modele, version: a.version, an: a.an, cap: a.cap });

// Regroupe les années d'une même version (même libellé, même capacité).
const groupes = new Map();
for (const l of lignes) {
  const k = [l.marque, l.modele.toLowerCase(), l.version.toLowerCase(), l.cap].join("|");
  const g = groupes.get(k);
  if (g) { g.de = Math.min(g.de, l.an); g.a = Math.max(g.a, l.an); }
  else groupes.set(k, { marque: l.marque, modele: l.modele, version: l.version, cap: l.cap, de: l.an, a: l.an });
}
const fr = (x) => String(x).replace(".", ",");
const sortie = [...groupes.values()]
  .map((g) => [g.marque, g.modele, [g.version, g.de === g.a ? String(g.de) : g.de + "–" + g.a].filter(Boolean).join(" · ") + " · " + fr(g.cap) + " kWh utiles", g.cap, g.de])
  .sort((x, y) => x[0].localeCompare(y[0], "fr") || x[1].localeCompare(y[1], "fr", { numeric: true }) || y[4] - x[4] || x[2].localeCompare(y[2], "fr"))
  .map((r) => r.slice(0, 4));

const doc = {
  _source: "Open EV Data (https://github.com/KilowattApp/open-ev-data), licence MIT, données du " + String(brut.meta?.updated_at || "").slice(0, 10) + ", nettoyées par tools/gen-vehicules.mjs et corrigées par tools/vehicules-corrections.json.",
  _licence: "Données Open EV Data (https://github.com/KilowattApp/open-ev-data). Copyright (c) 2024 Tijs Teulings. MIT License with Attribution Requirement : texte complet dans site/LICENCE-open-ev-data.txt.",
  v: sortie,
};
writeFileSync("site/vehicules.json", JSON.stringify(doc) + "\n");
const marques = new Set(sortie.map((r) => r[0]));
console.log(`site/vehicules.json : ${sortie.length} versions, ${marques.size} marques. Écartés : ${JSON.stringify(ecartes)}`);
