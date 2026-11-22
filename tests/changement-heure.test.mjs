// Tests du changement d'heure dans le calcul (décision de Mathieu du 2026-11-22, règle 4).
// Les cas de tests/golden-cases.json (nuits ordinaires) ne changent pas : voir calc.test.mjs.
// La nuit du dernier dimanche de mars dure 7 h (02:00 -> 03:00), celle d'octobre 9 h (03:00 -> 02:00).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { plan, fmt, dernierDimanche, nuitChangementHeure, soirDe, soirSimule, texteChangementHeure } from "../site/calc.js";

const DEFAUT = { cap: 46, soh: 92, target: 80, dep: "07:30", hcStart: "22:00", hcEnd: "06:00", amp: 16, volt: 230, eff: 90, pre: 0, deduct: false, pHC: 0.146688, pHP: 0.196476, mode: "end", soc: 38 };
const MARS = nuitChangementHeure("2027-03-27");
const OCT = nuitChangementHeure("2027-10-30");

describe("Dates du changement d'heure (calculées, jamais écrites en dur)", () => {
  test("dernier dimanche de mars et d'octobre, 2026 à 2030", () => {
    const attendu = { 2026: [29, 25], 2027: [28, 31], 2028: [26, 29], 2029: [25, 28], 2030: [31, 27] };
    for (const [an, [m, o]] of Object.entries(attendu)) {
      assert.equal(dernierDimanche(Number(an), 2), m, `mars ${an}`);
      assert.equal(dernierDimanche(Number(an), 9), o, `octobre ${an}`);
    }
  });
  test("seul le samedi soir qui précède est une nuit de changement d'heure", () => {
    assert.deepEqual(MARS, { sens: "ete", decalage: -60, minute: 120 });
    assert.deepEqual(OCT, { sens: "hiver", decalage: 60, minute: 180 });
    for (const j of ["2027-03-26", "2027-03-28", "2027-03-29", "2027-04-03", "2027-10-29", "2027-10-31", "2027-11-06", "2027-02-27", "2027-07-31"]) {
      assert.equal(nuitChangementHeure(j), null, j);
    }
  });
  test("accepte une date locale et refuse les entrées invalides", () => {
    assert.deepEqual(nuitChangementHeure(new Date(2027, 2, 27, 21, 0)), MARS);
    assert.deepEqual(nuitChangementHeure(new Date(2027, 9, 30, 8, 0)), OCT);
    for (const x of [null, undefined, "", "27/03/2027", "2027-02-30", "2027-13-01", new Date(NaN), 42]) assert.equal(nuitChangementHeure(x), null);
  });
  test("soirDe : après minuit, la nuit en cours appartient à la veille", () => {
    assert.deepEqual(nuitChangementHeure(soirDe(new Date(2027, 2, 27, 21, 0), "22:00", "06:00")), MARS); // samedi 21:00
    assert.deepEqual(nuitChangementHeure(soirDe(new Date(2027, 2, 28, 0, 30), "22:00", "06:00")), MARS); // dimanche 00:30, nuit en cours
    assert.equal(nuitChangementHeure(soirDe(new Date(2027, 2, 28, 8, 0), "22:00", "06:00")), null); // dimanche matin : le soir est dimanche
    assert.equal(nuitChangementHeure(soirDe(new Date(2027, 2, 28, 21, 0), "22:00", "06:00")), null);
  });
  test("date simulée : seulement en local", () => {
    assert.equal(soirSimule("?soir=2027-03-27", "127.0.0.1"), "2027-03-27");
    assert.equal(soirSimule("?a=1&soir=2027-10-30", "localhost"), "2027-10-30");
    assert.equal(soirSimule("?soir=2027-03-27", "exemple.github.io"), null);
    assert.equal(soirSimule("?soir=2027-03-27", ""), null);
    assert.equal(soirSimule("?soir=demain", "127.0.0.1"), null);
  });
  test("textes des bandeaux", () => {
    assert.match(texteChangementHeure(MARS), /heure d'été.*1 h de moins/);
    assert.match(texteChangementHeure(OCT), /heure d'hiver.*1 h de plus/);
    assert.equal(texteChangementHeure(null), "");
  });
});

// Cas chiffrés. 38 % -> 80 % à 16 A, 230 V, SOH 92 %, rendement 90 % : 42 % à charger = 325 min (5 h 25 min).
// Nuit ordinaire (référence) : allumage 00:35, extinction 06:00.
const CAS = [
  // [nom, entrée, nuit, allumage, extinction, durée min, statut]
  ["nuit ordinaire (référence)", { soc: 38 }, null, "00:35", "06:00", 325, "ok"],
  ["27-28/03/2027, début avant 02:00 : décalé d'1 h plus tôt", { soc: 38 }, MARS, "23:35", "06:00", 325, "ok"],
  ["30-31/10/2027, début avant 03:00 : décalé d'1 h plus tard", { soc: 38 }, OCT, "01:35", "06:00", 325, "ok"],
  ["mars, plage qui commence après 03:00 : inchangée", { soc: 60 }, MARS, "03:25", "06:00", 155, "ok"],
  ["octobre, plage qui commence après 03:00 : inchangée", { soc: 60 }, OCT, "03:25", "06:00", 155, "ok"],
  ["mars, 3 h exactes : commence à 03:00", { soc: 57 }, MARS, "03:00", "06:00", 180, "ok"],
  ["mars, 3 h 05 : commence avant le saut", { soc: 56 }, MARS, "01:55", "06:00", 185, "ok"],
  ["octobre, 4 h exactes : l'heure doublée, commence à 02:55 (5 min de plus, jamais moins)", { soc: 48.7 }, OCT, "02:55", "06:00", 245, "ok"],
  ["octobre, 5 h : 02:00", { soc: 41.2 }, OCT, "02:00", "06:00", 300, "ok"],
  ["mars, départ 05:30 : la charge finit au départ, décalée avant le saut", { soc: 38, dep: "05:30" }, MARS, "23:05", "05:30", 325, "ok"],
  ["octobre, départ 05:30 : la charge finit au départ, décalée après le saut", { soc: 38, dep: "05:30" }, OCT, "01:05", "05:30", 325, "ok"],
  ["mars, départ 09:00 : les HC finissent à 06:00", { soc: 38, dep: "09:00" }, MARS, "23:35", "06:00", 325, "ok"],
  ["mars, début des heures creuses (mode commencer à)", { soc: 38, mode: "start" }, MARS, "22:00", "04:25", 325, "ok"],
  ["octobre, mode commencer à : la fin tombe dans l'heure doublée, reportée à 03:00 (35 min de plus)", { soc: 38, mode: "start" }, OCT, "22:00", "03:00", 360, "ok"],
  ["mars, HC insuffisantes : démarre avant les HC", { soc: 5 }, MARS, "19:25", "06:00", 575, "short"],
  ["octobre, HC insuffisantes : démarre avant les HC", { soc: 5 }, OCT, "21:25", "06:00", 575, "short"],
  ["mars, pas de charge", { soc: 85 }, MARS, null, null, 0, "none"],
  ["octobre, pas de charge", { soc: 85 }, OCT, null, null, 0, "none"],
];

describe("Nuits de changement d'heure : cas chiffrés", () => {
  for (const [nom, delta, nuit, allumage, extinction, duree, statut] of CAS) {
    test(nom, () => {
      const r = plan({ ...DEFAUT, ...delta, ...(nuit ? { nuit } : {}) });
      assert.equal(r.status, statut);
      assert.equal(r.chargeMin, duree, "durée réelle de charge");
      if (statut !== "none") {
        assert.equal(fmt(r.start), allumage, "allumage (heure murale)");
        assert.equal(fmt(r.end), extinction, "extinction (heure murale)");
      }
    });
  }
});

// Vérification indépendante : on rejoue la nuit sur l'horloge murale (heure réelle écoulée) et on compare.
// minutes depuis le samedi 00:00 ; le saut est le dimanche à 02:00 (mars) ou 03:00 (octobre).
function dureeReelle(nuit, allumage, extinction) {
  const hm = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const abs = (t) => (hm(t) >= 12 * 60 ? hm(t) : 1440 + hm(t)); // le soir : samedi ; après minuit : dimanche
  const reel = (t) => {
    const w = abs(t);
    if (nuit.sens === "ete") { assert.ok(!(w >= 1560 && w < 1620), `${t} n'existe pas la nuit du passage à l'heure d'été`); return w >= 1620 ? w - 60 : w; }
    return w >= 1620 ? w + 60 : w; // octobre : l'heure 02:00-03:00 se lit deux fois, la première compte
  };
  return reel(extinction) - reel(allumage);
}

describe("Nuits de changement d'heure : propriétés sur tous les % de départ", () => {
  for (const [nom, nuit] of [["mars", MARS], ["octobre", OCT]]) {
    for (const mode of ["end", "start"]) {
      for (const dep of ["05:30", "07:30", "09:00"]) {
        test(`${nom}, mode ${mode}, départ ${dep} : la durée réelle entre l'allumage et l'extinction est celle qu'il faut`, () => {
          for (let soc = 0; soc < 80; soc++) {
            const sans = plan({ ...DEFAUT, soc, mode, dep });
            const r = plan({ ...DEFAUT, soc, mode, dep, nuit });
            assert.equal(r.status === "none", sans.status === "none", `pas de charge à ${soc} %`); // le reste peut passer de ok à short : la nuit de mars est plus courte
            assert.equal(r.needMin, sans.needMin, `besoin à ${soc} %`);
            if (r.status === "none") continue;
            const reel = dureeReelle(nuit, fmt(r.start), fmt(r.end));
            assert.equal(reel, r.chargeMin, `durée réelle à ${soc} % (${fmt(r.start)} -> ${fmt(r.end)})`);
            if (r.status === "ok") {
              assert.ok(r.chargeMin >= r.needMin, `charge trop courte à ${soc} %`);
              assert.ok(r.chargeMin - r.needMin <= 60, `charge trop longue à ${soc} %`);
              assert.ok(r.arrival >= DEFAUT.target - 1e-9, `cible non atteinte à ${soc} %`);
            }
            if (mode === "end" && dep !== "05:30") assert.equal(fmt(r.end), "06:00", "fin des heures creuses");
          }
        });
      }
    }
  }
  test("une nuit ordinaire donne exactement le même plan avec ou sans nuit nulle", () => {
    for (let soc = 0; soc <= 100; soc += 3) assert.deepEqual({ ...plan({ ...DEFAUT, soc }), versMurale: 0 }, { ...plan({ ...DEFAUT, soc, nuit: null }), versMurale: 0 });
  });
  test("une valeur de décalage inconnue est ignorée", () => {
    assert.equal(plan({ ...DEFAUT, nuit: { decalage: 30, minute: 120 } }).start, plan(DEFAUT).start);
  });
});
