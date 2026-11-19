// Tests de la liste des véhicules (site/vehicules.js et site/vehicules.json).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lignesValides, marques, modeles, versions, trouver } from "../site/vehicules.js";

const doc = JSON.parse(readFileSync(new URL("../site/vehicules.json", import.meta.url), "utf8"));
const L = lignesValides(doc);

test("le fichier publié est entièrement valide et cite sa source", () => {
  assert.equal(L.length, doc.v.length);
  assert.ok(L.length > 500);
  assert.match(doc._source, /Open EV Data/);
  assert.match(doc._licence, /Tijs Teulings/);
});

test("aucune version en double pour un même modèle", () => {
  const vus = new Set();
  for (const r of L) { const k = r.slice(0, 3).join("|"); assert.ok(!vus.has(k), k); vus.add(k); }
});

test("la DS 3 Crossback E-Tense de Mathieu est trouvée à 46 kWh utiles", () => {
  assert.ok(marques(L).includes("DS"));
  assert.ok(modeles(L, "DS").includes("3 Crossback E-Tense"));
  const v = versions(L, "DS", "3 Crossback E-Tense");
  assert.ok(v.some((x) => x.cap === 46));
  const t = trouver(L, { marque: "DS", modele: "3 Crossback E-Tense", version: v.find((x) => x.cap === 46).libelle });
  assert.equal(t.cap, 46);
});

test("lignes mal formées écartées, choix inconnu ou vide sans erreur", () => {
  const bad = { v: [["A", "B", "C", 40], ["A", "B", "", 40], ["A", "B", "C", "40"], ["A", "B", "C", 0], ["A", "B", "C", 999], "x", null, ["A", "B", "C"]] };
  assert.deepEqual(lignesValides(bad), [["A", "B", "C", 40]]);
  assert.deepEqual(lignesValides(null), []);
  assert.equal(trouver(L, null), null);
  assert.equal(trouver(L, { marque: "DS", modele: "inconnu", version: "x" }), null);
});

test("aucune valeur aberrante : capacités plausibles, libellés non vides, un libellé = une capacité", () => {
  // Exceptions connues d'Open EV Data hors 15–150 kWh : petites batteries anciennes et Roadster.
  const HORS_PLAGE = new Set(["Artega|Karo", "Citroën|C-Zero", "Mitsubishi|i-MiEV", "Peugeot|iOn", "Tesla|Roadster"]);
  const caps = new Map();
  for (const [m, mo, l, c] of doc.v) {
    assert.ok(m.trim() && mo.trim() && l.trim(), `libellé vide : ${m}|${mo}|${l}`);
    assert.ok(Number.isFinite(c), `capacité non numérique : ${m}|${mo}|${l}`);
    if (c < 15 || c > 150) assert.ok(HORS_PLAGE.has(m + "|" + mo), `capacité aberrante : ${m} ${mo} ${c}`);
    const k = [m, mo, l].join("|");
    assert.ok(!caps.has(k) || caps.get(k) === c, `même libellé, deux capacités : ${k}`);
    caps.set(k, c);
  }
});

test("les ajouts manuels sont valides, sourcés et présents dans le fichier publié", () => {
  const aj = JSON.parse(readFileSync(new URL("../tools/vehicules-ajouts.json", import.meta.url), "utf8"));
  assert.ok(aj.source && aj.ajouter.length > 0);
  assert.ok(doc._source.includes(aj.source));
  for (const a of aj.ajouter) {
    assert.ok(a.marque && a.modele && typeof a.version === "string" && a.cap >= 15 && a.cap <= 150, JSON.stringify(a));
  }
  // Chaque ajout (ou une version équivalente absorbée) laisse au moins le modèle dans la liste.
  const modelesPublies = new Set(doc.v.map((r) => r[0] + "|" + r[1].toLowerCase()));
  for (const a of aj.ajouter) assert.ok(modelesPublies.has(a.marque + "|" + a.modele.toLowerCase()), `modèle absent : ${a.marque} ${a.modele}`);
});
