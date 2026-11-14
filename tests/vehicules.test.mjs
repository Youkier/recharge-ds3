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
