// Relecture de sécurité du mode Local (lot C4, 2026-11-21) : connexion coupée APRÈS l'envoi de l'écriture.
// Cas réels : écran éteint ou appli quittée pendant la relecture (onStop ferme la connexion du pont), plafond de 30 s
// du pont, câble qui ferme la connexion après une commande. L'écriture a pu être appliquée : le message ne doit pas
// affirmer « Rien n'a été modifié » et doit demander de vérifier dans Smart Life (incertain).
// Faux câble et client simulés, clé factice, aucune connexion réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programmerLocal } from '../site/local.js';
import { programmer } from '../local/tuya-local.js';
import { fauxCable } from './tuya-local-faux-cable.mjs';

const CLE = 'CLE-FACTICE-0000';
const plage = (m, ss, se) => JSON.stringify({ m, dt: 0, ss, se });

function clientCoupeApresEcriture(dps) {
  const vus = [];
  return {
    vus,
    async cable() { return { ok: true, configure: true, deviceId: 'factice_0000', cle: CLE, adresse: '192.168.1.48' }; },
    async prefixeWifi() { return { ok: true, prefixe: '192.168.1' }; },
    async appeler() { return { ok: true }; },
    creerTransport() {
      const f = fauxCable({ cle: CLE, dps });
      vus.push(f);
      const t = f.transport;
      return {
        ouvrir: (...a) => t.ouvrir(...a),
        envoyer: (o) => t.envoyer(o),
        async recevoir(ms) {
          if (f.journal.ecritures.length > 0) { const e = new Error('x'); e.code = 'ferme'; throw e; } // pont fermé (onStop)
          return t.recevoir(ms);
        },
        fermer: () => t.fermer(),
      };
    },
  };
}

for (const [nom, demande] of [['allumage', { allumage: '23:45' }], ['desactiver', { desactiver: true }]]) {
  test(`connexion coupée après l'écriture (${nom}) : pas de « Rien n'a été modifié », vérification demandée`, async () => {
    const dps = { 101: 202, 109: 'WAIT', 150: 16, 151: plage(2, '03:30', '06:00'), 152: 16 };
    const c = clientCoupeApresEcriture(dps);
    const r = await programmerLocal(demande, { client: c, programmer }, '06:00');
    assert.notEqual(JSON.parse(c.vus[0].dps[151]).ss, '03:30', 'précondition : l\'écriture a bien été appliquée par le faux câble');
    assert.equal(r.etat, 'ko');
    assert.ok(r.manuel.includes('Smart Life'), 'heure manuelle toujours donnée');
    assert.ok(!/Rien n'a été modifié/.test(r.message), `message trompeur : ${r.code} « ${r.message} »`);
    assert.equal(r.incertain, true, `code ${r.code} non marqué incertain`);
  });
}
