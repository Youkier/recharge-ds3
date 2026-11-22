// Relecture de sécurité du mode Local (lot C4, 2026-11-21) : connexion coupée APRÈS l'envoi de l'écriture.
// Cas réels : écran éteint ou appli quittée pendant la relecture (onStop coupe la connexion), échéance de l'opération,
// câble qui ferme la connexion après une commande. L'écriture a pu être appliquée : le message ne doit pas affirmer
// « Rien n'a été modifié » et doit demander de vérifier dans Smart Life (incertain).
// Depuis le lot E2, c'est le code natif qui écrit : il rend { ok:false, erreur:'delai', ecrit:true } (testé en JUnit,
// ClientCableTest) ; ici, on vérifie ce que la page en fait. Client du pont simulé, aucune connexion réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programmerLocal } from '../site/local.js';

function clientCoupeApresEcriture(reponse) {
  const vus = [];
  return {
    vus,
    async cable() { return { ok: true, configure: true, adresse: '192.168.1.48' }; },
    async prefixeWifi() { return { ok: true, prefixe: '192.168.1' }; },
    async programmer(action, params, delai) { vus.push({ action, params, delai }); return reponse; },
  };
}

const COUPURES = [
  ['connexion coupée (delai, ecrit)', { ok: false, erreur: 'delai', ecrit: true }],
  ['relecture différente (ecrit)', { ok: false, erreur: 'relecture_differente', ecrit: true }],
  ['pont muet pendant l\'écriture', { ok: false, erreur: 'pont_muet' }],
];

for (const [nom, demande] of [['allumage', { allumage: '23:45' }], ['desactiver', { desactiver: true }]]) {
  for (const [cas, reponse] of COUPURES) {
    test(`${cas}, ${nom} : pas de « Rien n'a été modifié », vérification demandée, jamais relancée`, async () => {
      const c = clientCoupeApresEcriture(reponse);
      const r = await programmerLocal(demande, { client: c }, '06:00');
      assert.equal(r.etat, 'ko');
      assert.ok(r.manuel.includes('Smart Life'), 'heure manuelle toujours donnée');
      assert.ok(!/Rien n'a été modifié/.test(r.message), `message trompeur : ${r.code} « ${r.message} »`);
      assert.equal(r.incertain, true, `code ${r.code} non marqué incertain`);
      assert.equal(c.vus.length, 1, 'une écriture peut-être appliquée n\'est pas relancée');
    });
  }
}
