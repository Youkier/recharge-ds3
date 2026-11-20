// Génère site/vehicules.json (marque → modèle → version → capacité utile) à partir
// d'Open EV Data (https://github.com/KilowattApp/open-ev-data, licence MIT, citation obligatoire).
//
// Usage : node tools/gen-vehicules.mjs <ev-data.json téléchargé> [tools/vehicules-corrections.json] [tools/vehicules-ajouts.json]
//
// Le fichier source est une donnée externe : on n'en garde que des chaînes courtes et
// des nombres plausibles, tout le reste est ignoré. Aucune exécution de son contenu.

import { readFileSync, writeFileSync } from "node:fs";

const [src, corrFile = "tools/vehicules-corrections.json", ajoutsFile = "tools/vehicules-ajouts.json"] = process.argv.slice(2);
if (!src) { console.error("Usage : node tools/gen-vehicules.mjs <ev-data.json> [corrections.json] [ajouts.json]"); process.exit(1); }

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
const renommer = new Map((corr.renommer || []).map((r) => [r.marque + "|" + r.de, r]));
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
  // Renommage manuel (orthographes multiples d'un même modèle) ; « version » éventuelle placée en tête.
  const ren = renommer.get(marque + "|" + modele);
  if (ren) { modele = ren.vers; if (ren.version) version = (ren.version + (version ? " " + version : "")).trim(); }
  lignes.push({ marque, modele, version, an: v.release_year, cap: Math.round(v.usable_battery_size * 10) / 10 });
}
// Ajouts manuels : chacun doit citer sa source (vérifié ici, refus sinon).
for (const a of corr.ajouter) {
  if (!texte(a.marque) || !texte(a.modele) || typeof a.version !== "string" || !anOk(a.an) || !capOk(a.cap) || !/^https:\/\//.test(a.source || "")) {
    throw new Error("Ajout invalide ou sans source : " + JSON.stringify(a));
  }
  lignes.push({ marque: a.marque, modele: a.modele, version: a.version, an: a.an, cap: a.cap });
}

// Ajouts de la liste fournie par Mathieu (sans année, source non officielle déclarée dans le fichier).
const ajouts = JSON.parse(readFileSync(ajoutsFile, "utf8"));
if (typeof ajouts.source !== "string" || !ajouts.source) throw new Error("tools/vehicules-ajouts.json : « source » obligatoire");
for (const a of ajouts.ajouter) {
  if (!texte(a.marque) || !texte(a.modele) || typeof a.version !== "string" || a.version.length > 60 || !capOk(a.cap)) {
    throw new Error("Ajout invalide : " + JSON.stringify(a));
  }
  lignes.push({ marque: a.marque, modele: a.modele, version: a.version, an: null, cap: a.cap });
}

// Doublons de nom : « Zoe R110 » devient « Zoe » + version « R110 » quand « Zoe » existe
// pour la même marque (préfixe le plus court) ; « E-Traveller » et « e-Traveller » fusionnent
// sous l'orthographe la plus fréquente.
const parMarque = new Map();
for (const l of lignes) {
  const m = parMarque.get(l.marque) || new Map();
  const k = l.modele.toLowerCase();
  const c = m.get(k) || new Map();
  c.set(l.modele, (c.get(l.modele) || 0) + 1);
  m.set(k, c); parMarque.set(l.marque, m);
}
let renommes = 0;
for (const l of lignes) {
  const m = parMarque.get(l.marque), bas = l.modele.toLowerCase();
  let base = null;
  for (const k of m.keys()) if (bas.startsWith(k + " ") && (!base || k.length < base.length)) base = k;
  if (base) {
    l.version = (l.modele.slice(base.length).trim() + (l.version ? " " + l.version : "")).trim();
    l.modele = base; renommes++;
  }
  const c = m.get(l.modele.toLowerCase());
  l.modele = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
// Version comparée sans casse, ponctuation ni ordre des mots (« Q 210 » = « Q210 », « ZE40 R110 » = « R110 ZE40 »).
const cleVersion = (v) => v.toLowerCase().replace(/([a-z]+)\s+(\d)/g, "$1$2").split(/[^a-z0-9+.]+/).filter(Boolean).sort().join(" ");

// Regroupe les années d'une même version (même libellé, même capacité).
const groupes = new Map();
for (const l of lignes) {
  const k = [l.marque, l.modele.toLowerCase(), cleVersion(l.version), l.cap].join("|");
  const g = groupes.get(k);
  if (g) { if (l.an !== null) { g.de = g.de === null ? l.an : Math.min(g.de, l.an); g.a = g.a === null ? l.an : Math.max(g.a, l.an); } }
  else groupes.set(k, { marque: l.marque, modele: l.modele, version: l.version, cap: l.cap, de: l.an, a: l.an });
}
// Même modèle, même année, même capacité : « EV40 » absorbé par « EV40 130hp » (nom le plus précis gardé).
const motsDe = (g) => cleVersion(g.version).split(" ").filter(Boolean);
const liste = [...groupes.values()];
for (const g of liste) {
  const mots = motsDe(g);
  const plusPrecis = liste.find((h) => h !== g && !h.absorbe && h.marque === g.marque && h.modele.toLowerCase() === g.modele.toLowerCase() &&
    h.cap === g.cap && h.de === g.de && h.a === g.a && motsDe(h).length > mots.length && mots.every((w) => motsDe(h).includes(w)));
  if (plusPrecis) g.absorbe = true;
}
const fr = (x) => String(x).replace(".", ",");
const sortie = liste.filter((g) => !g.absorbe)
  .map((g) => [g.marque, g.modele, [g.version, g.de === null ? "" : g.de === g.a ? String(g.de) : g.de + "–" + g.a, fr(g.cap) + " kWh utiles"].filter(Boolean).join(" · "), g.cap, g.de ?? 0])
  .sort((x, y) => x[0].localeCompare(y[0], "fr") || x[1].localeCompare(y[1], "fr", { numeric: true }) || y[4] - x[4] || x[2].localeCompare(y[2], "fr"))
  .map((r) => r.slice(0, 4));

const doc = {
  _source: "Open EV Data (https://github.com/KilowattApp/open-ev-data), licence MIT, données du " + String(brut.meta?.updated_at || "").slice(0, 10) + ", nettoyées par tools/gen-vehicules.mjs et corrigées par tools/vehicules-corrections.json. Versions ajoutées d'après une liste fournie par Mathieu (tools/vehicules-ajouts.json) : " + ajouts.source,
  _licence: "Données Open EV Data (https://github.com/KilowattApp/open-ev-data). Copyright (c) 2024 Tijs Teulings. MIT License with Attribution Requirement : texte complet dans site/LICENCE-open-ev-data.txt.",
  v: sortie,
};
writeFileSync("site/vehicules.json", JSON.stringify(doc) + "\n");
const marques = new Set(sortie.map((r) => r[0]));
console.log(`site/vehicules.json : ${sortie.length} versions, ${marques.size} marques, ${renommes} noms de modèle ramenés à leur base. Écartés : ${JSON.stringify(ecartes)}`);
