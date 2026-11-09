// Tests du calcul de recharge (node --test tests/). Aucune dépendance.
// 1. Rejoue les cas de référence de tests/golden-cases.json (ne jamais modifier les valeurs attendues).
// 2. Cas limites sans référence : seules des propriétés de bon sens sont vérifiées.
// 3. Comportements douteux du code d'origine, conservés tels quels : tests marqués « todo ».

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plan, fmt } from "../site/calc.js";

const golden = JSON.parse(readFileSync(new URL("./golden-cases.json", import.meta.url), "utf8"));
const TOL_KWH = golden._tolerances.energie_kwh;
const TOL_EUR = golden._tolerances.cout_eur;
const EPS = 1e-9; // marge pour les erreurs d'arrondi en virgule flottante

// Sorties telles que la page les affiche (mêmes conventions que golden-cases.json).
function sorties(r) {
  const charge = r.status === "ok" || r.status === "short";
  return {
    statut: r.status,
    allumage: charge ? fmt(r.start) : null,
    extinction: charge ? fmt(r.end) : null,
    duree_min: r.chargeMin,
    hors_hc_min: r.offMin,
    batterie_estimee_pct: Math.round(r.arrival),
    energie_kwh: r.kwh,
    cout_eur: r.cost,
    preconditionnement: fmt(r.preS) + "-" + fmt(r.dep),
  };
}

describe("Cas de référence (golden-cases.json)", () => {
  for (const c of golden.cas) {
    test(c.nom, () => {
      const got = sorties(plan({ ...c.entree }));
      const exp = c.attendu;
      for (const k of Object.keys(exp)) {
        if (k === "energie_kwh") {
          assert.ok(Math.abs(got[k] - exp[k]) <= TOL_KWH + EPS, `${k} : obtenu ${got[k]}, attendu ${exp[k]} ± ${TOL_KWH}`);
        } else if (k === "cout_eur") {
          assert.ok(Math.abs(got[k] - exp[k]) <= TOL_EUR + EPS, `${k} : obtenu ${got[k]}, attendu ${exp[k]} ± ${TOL_EUR}`);
        } else {
          assert.equal(got[k], exp[k], `${k}`);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Cas limites : propriétés de bon sens uniquement.

const DEFAUT = { cap: 46, soh: 92, target: 80, dep: "07:30", hcStart: "22:00", hcEnd: "06:00", amp: 16, volt: 230, eff: 90, pre: 30, pHC: 0.146688, pHP: 0.196476, mode: "end", deduct: false, soc: 38 };
const STATUTS = ["ok", "short", "none", "err"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function bonSens(p, r) {
  assert.ok(STATUTS.includes(r.status), `statut inconnu : ${r.status}`);
  if (r.status === "err") return;
  const nums = ["usable", "P", "pctPerHour", "preGain", "hcLen", "preRel", "depRel", "startRel", "endRel",
    "chargeMin", "offMin", "charged", "arrival", "kwh", "kwhHP", "kwhHC", "cost", "start", "end", "preS", "dep"];
  for (const k of nums) assert.ok(Number.isFinite(r[k]), `${k} n'est pas un nombre fini : ${r[k]}`);
  for (const k of ["start", "end", "preS", "dep"]) assert.match(fmt(r[k]), HHMM, `${k} mal formaté`);
  assert.ok(r.chargeMin >= 0 && r.chargeMin % 5 === 0, `durée ${r.chargeMin}`);
  assert.ok(r.offMin >= 0 && r.offMin <= r.chargeMin, `hors HC ${r.offMin}`);
  assert.ok(r.kwh >= 0 && r.kwhHP >= 0 && r.kwhHC >= -EPS, `énergie ${r.kwh} / ${r.kwhHC} / ${r.kwhHP}`);
  assert.ok(r.cost >= 0, `coût ${r.cost}`);
  assert.ok(r.arrival >= 0 && r.arrival <= 100, `batterie estimée ${r.arrival}`);
  assert.ok(r.arrival >= p.soc - EPS, "la batterie estimée ne peut pas baisser");
  if (r.status === "none") {
    assert.equal(r.chargeMin, 0);
  } else {
    // La charge s'arrête au plus tard à la fin des HC ou au rallumage pour le préconditionnement.
    assert.ok(r.endRel <= Math.min(r.preRel, r.hcLen), `fin ${r.endRel} après la limite`);
    // Elle ne commence pas avant le départ précédent + 30 min.
    assert.ok(r.startRel >= r.depRel + 30 - 1440, `début ${r.startRel} avant le départ précédent`);
  }
  if (r.status === "ok") {
    assert.equal(r.offMin, 0, "statut ok mais charge hors HC");
    assert.ok(r.arrival >= p.target - EPS, "statut ok mais cible non atteinte");
  }
}

const LIMITES = [
  ["Cible 100 % depuis 38 % (fin des HC)", { target: 100 }, "ok"],
  ["Cible 100 % depuis 38 % (début des HC)", { target: 100, mode: "start" }, "ok"],
  ["Cible 100 % depuis 0 %", { target: 100, soc: 0 }, "short"],
  ["Cible 100 % déjà atteinte", { target: 100, soc: 100 }, "none"],
  ["HC 01:00–07:00 (fin des HC)", { hcStart: "01:00", hcEnd: "07:00" }, "ok"],
  ["HC 01:00–07:00 (début des HC)", { hcStart: "01:00", hcEnd: "07:00", mode: "start" }, "ok"],
  ["HC 01:00–07:00 insuffisantes : 5 % → 80 %", { hcStart: "01:00", hcEnd: "07:00", soc: 5 }, "short"],
  ["HC 12:00–14:00, petit besoin (fin des HC)", { hcStart: "12:00", hcEnd: "14:00", soc: 75 }, "ok"],
  ["HC 12:00–14:00, petit besoin (début des HC)", { hcStart: "12:00", hcEnd: "14:00", soc: 75, mode: "start" }, "ok"],
  ["HC 12:00–14:00, 38 % → 80 %", { hcStart: "12:00", hcEnd: "14:00" }, "short"],
  ["Départ à 03:00, pendant les HC", { dep: "03:00" }, "short"],
  ["Début et fin des HC identiques (24 h)", { hcStart: "22:00", hcEnd: "22:00" }, "ok"],
  ["Courant à 0 A", { amp: 0 }, "err"],
  ["Capacité à 0 kWh", { cap: 0 }, "err"],
];

describe("Cas limites (propriétés de bon sens)", () => {
  for (const [nom, delta, statut] of LIMITES) {
    test(nom, () => {
      const p = { ...DEFAUT, ...delta };
      const r = plan(p);
      assert.equal(r.status, statut);
      bonSens(p, r);
    });
  }
});

// ---------------------------------------------------------------------------
// Comportements douteux du code d'origine (non corrigés, décision à prendre par Mathieu).
// Chaque test décrit le comportement attendu ; il échoue aujourd'hui et est donc marqué « todo ».

describe("Comportements douteux (todo)", () => {
  test("Cible vide (NaN) : devrait être refusée, pas « ok » avec des heures NaN:NaN",
    { todo: "target = NaN donne statut ok, allumage NaN:NaN, durée/énergie/coût NaN" }, () => {
      const p = { ...DEFAUT, target: NaN };
      const r = plan(p);
      assert.equal(r.status, "err");
    });

  test("Préconditionnement vide (NaN) : devrait être refusé, pas « ok » avec un rallumage NaN:NaN",
    { todo: "pre = NaN donne statut ok et préconditionnement « NaN:NaN-07:30 »" }, () => {
      const p = { ...DEFAUT, pre: NaN };
      const r = plan(p);
      if (r.status !== "err") bonSens(p, r);
    });

  test("Prix vides (NaN) : le coût ne devrait pas valoir 0 € sans avertissement",
    { todo: "pHC = pHP = NaN donne un coût de 0 € avec statut ok (|| 0 dans plan)" }, () => {
      const p = { ...DEFAUT, pHC: NaN, pHP: NaN };
      const r = plan(p);
      assert.ok(r.status === "err" || r.cost > 0, `coût ${r.cost} avec statut ${r.status}`);
    });

  test("Cible inatteignable même en démarrant au plus tôt : le statut devrait le distinguer",
    { todo: "amp 6 A, 5 % → 80 % : statut short, batterie estimée 69,6 % < 80 %, et la page ne dit pas que la cible ne sera pas atteinte" }, () => {
      const p = { ...DEFAUT, amp: 6, soc: 5 };
      const r = plan(p);
      bonSens(p, r);
      if (r.status === "short") assert.ok(r.arrival >= p.target - EPS, `short mais batterie estimée ${r.arrival} < ${p.target}`);
    });
});
