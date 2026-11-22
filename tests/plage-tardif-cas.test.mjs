// Cas communs de la règle du démarrage tardif : tests/plage-tardif-cas.json est lu ici contre le Worker
// (worker/src/service.js, deciderPlage) et par PlageTardifTest.kt contre la coque Android (Plage.decider).
// Les deux implémentations doivent donner EXACTEMENT les mêmes résultats (décision du 2026-11-22).
// local/tuya-local.js (outil PC) garde l'ancienne règle : il n'est pas concerné par ce fichier.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deciderPlage, moinsUneMinute } from '../worker/src/service.js';

const CAS = JSON.parse(readFileSync(new URL('./plage-tardif-cas.json', import.meta.url), 'utf8'));

describe('Fichier de cas du démarrage tardif', () => {
  test('les sections et les statuts attendus sont présents', () => {
    assert.ok(CAS.decider.length >= 30);
    assert.ok(CAS.desactiver.length >= 3);
    const statuts = new Set(CAS.decider.map((c) => c.attendu.statut));
    for (const s of ['normal', 'tardif', 'trop_tard', 'invalide']) assert.ok(statuts.has(s), s);
    // maintenant : 21:00, 23:50, 00:20, 05:50, 07:40 et 14:00 (heure de Paris, hiver)
    const heures = new Set(CAS.decider.map((c) => new Date(new Date(c.maintenant).getTime() + 3600_000).toISOString().slice(11, 16)));
    for (const h of ['21:00', '23:50', '00:20', '05:50', '07:40', '14:00']) assert.ok(heures.has(h), h);
  });
});

describe('deciderPlage (Worker) sur le fichier de cas', () => {
  for (const c of CAS.decider) {
    test(c.nom, () => {
      const r = deciderPlage({ allumage: c.allumage, fin: c.fin, duree_min: c.duree_min, depart: c.depart }, new Date(c.maintenant));
      assert.deepEqual(r, c.attendu);
    });
  }
});

describe('désactiver : début = fin relue moins une minute', () => {
  for (const c of CAS.desactiver) {
    test(c.nom, () => assert.deepEqual({ debut: moinsUneMinute(c.fin_actuelle), fin: c.fin_actuelle }, c.attendu));
  }
});
