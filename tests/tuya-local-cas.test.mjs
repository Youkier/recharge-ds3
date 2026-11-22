// Cas communs au module JS (local/tuya-local.js) et au module Kotlin de la coque (android/.../cable/Plage.kt).
// tests/tuya-local-cas.json (plages, moinsUneMinute, autresPointsModifies) est lu ici contre le JS, et par CasCommunsTest.kt contre le
// Kotlin : les deux implémentations doivent donner EXACTEMENT les mêmes résultats (lot E1, 2026-11-21).
// La règle du démarrage tardif (décision du 2026-11-22) a UN SEUL fichier de cas, tests/plage-tardif-cas.json, lu par le Worker
// (plage-tardif-cas.test.mjs), par la coque (PlageTardifTest.kt) et ici par local/tuya-local.js (revue d'architecture, constat n°9).
//
// local/tuya-local.js n'exporte que lireEtat et programmer (règle n°9). Les fonctions internes sont atteintes sans
// toucher au module : on importe son source augmenté d'une ligne d'export, par une adresse « data: ». Le source n'a
// aucune importation, donc rien d'autre à résoudre. Rien n'est écrit sur le disque.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CAS = JSON.parse(readFileSync(new URL('./tuya-local-cas.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../local/tuya-local.js', import.meta.url), 'utf8');

const interne = await import(`data:text/javascript;base64,${Buffer.from(
  `${source}\nexport const __interne = { lirePlage, deciderPlage, moinsUneMinute, autresPointsModifies };\n`, 'utf8').toString('base64')}`);
const { lirePlage, deciderPlage, moinsUneMinute, autresPointsModifies } = interne.__interne;
const TARDIF = JSON.parse(readFileSync(new URL('./plage-tardif-cas.json', import.meta.url), 'utf8'));

describe('Fichier de cas', () => {
  test('toutes les sections sont présentes et non vides', () => {
    for (const k of ['moinsUneMinute', 'plages', 'autresPointsModifies']) {
      assert.ok(Array.isArray(CAS[k]) && CAS[k].length > 0, k);
    }
    assert.ok(!('decider' in CAS), 'la règle de décision n\'a qu\'un fichier de cas : plage-tardif-cas.json');
    assert.ok(TARDIF.decider.length >= 30);
  });
  test('le module JS exporte toujours seulement lireEtat et programmer', async () => {
    const m = await import('../local/tuya-local.js');
    assert.deepEqual(Object.keys(m).sort(), ['lireEtat', 'programmer']);
  });
});

describe('deciderPlage (démarrage tardif) sur le fichier de cas commun au Worker, à la coque et à local/', () => {
  for (const c of TARDIF.decider) {
    test(c.nom, () => {
      const r = deciderPlage({ allumage: c.allumage, fin: c.fin, duree_min: c.duree_min, depart: c.depart }, new Date(c.maintenant));
      assert.deepEqual(r, c.attendu);
    });
  }
  for (const c of TARDIF.desactiver) {
    test('désactiver : ' + c.nom, () => assert.deepEqual({ debut: moinsUneMinute(c.fin), fin: c.fin }, c.attendu));
  }
});

describe('moinsUneMinute', () => {
  for (const c of CAS.moinsUneMinute) {
    test(`${c.entree} -> ${c.attendu}`, () => assert.equal(moinsUneMinute(c.entree), c.attendu));
  }
});

describe('lirePlage (valeur du dp 151)', () => {
  for (const c of CAS.plages) {
    test(JSON.stringify(c.valeur), () => {
      if (c.attendu === null) {
        assert.throws(() => lirePlage(c.valeur), (e) => e.code === 'format');
      } else {
        assert.deepEqual(lirePlage(c.valeur), c.attendu);
      }
    });
  }
});

describe('autresPointsModifies', () => {
  for (const c of CAS.autresPointsModifies) {
    test(c.nom, () => assert.equal(autresPointsModifies(c.avant, c.apres), c.attendu));
  }
});
