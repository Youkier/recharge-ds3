// Cas communs au module JS (local/tuya-local.js) et au module Kotlin de la coque (android/.../cable/Plage.kt).
// tests/tuya-local-cas.json est lu ici contre le JS, et par CasCommunsTest.kt contre le Kotlin : les deux
// implémentations doivent donner EXACTEMENT les mêmes résultats (lot E1, 2026-11-21).
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
  `${source}\nexport const __interne = { lirePlage, decider, moinsUneMinute, autresPointsModifies };\n`, 'utf8').toString('base64')}`);
const { lirePlage, decider, moinsUneMinute, autresPointsModifies } = interne.__interne;

describe('Fichier de cas', () => {
  test('toutes les sections sont présentes et non vides', () => {
    for (const k of ['decider', 'moinsUneMinute', 'plages', 'autresPointsModifies']) {
      assert.ok(Array.isArray(CAS[k]) && CAS[k].length > 0, k);
    }
    assert.ok(CAS.decider.length >= 20);
  });
  test('le module JS exporte toujours seulement lireEtat et programmer', async () => {
    const m = await import('../local/tuya-local.js');
    assert.deepEqual(Object.keys(m).sort(), ['lireEtat', 'programmer']);
  });
});

describe('decider (heure de Paris, passage de minuit, changements d\'heure)', () => {
  for (const c of CAS.decider) {
    test(c.nom, () => {
      const r = decider(c.allumage, c.fin, new Date(c.maintenant));
      assert.deepEqual(r, c.attendu);
    });
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
