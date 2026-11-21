// Journal de trames facultatif (cfg.trace de local/tuya-local.js, option --trace de tools/tuya-local.mjs).
// Faux câble, clé factice : aucune connexion réelle.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { programmer, lireEtat } from '../local/tuya-local.js';
import { formaterTrace } from '../tools/tuya-local.mjs';
import { fauxCable, hex } from './tuya-local-faux-cable.mjs';

const CLE = 'CLE-FACTICE-0000';
const ID = 'factice_identifiant_du_cable_9876';
const plage = JSON.stringify({ m: 2, dt: 0, ss: '03:30', se: '06:00' });
const dps = { 101: 202, 109: 'WAIT', 151: plage };
const cfg = (extra = {}) => ({ ip: '192.0.2.10', deviceId: ID, cleLocale: CLE, version: '3.5', pause: async () => {}, maintenant: () => new Date('2026-11-21T14:00:00Z'), ...extra });

describe('cfg.trace', () => {
  test('absente : aucun appel, résultat inchangé', async () => {
    const f = fauxCable({ cle: CLE, dps });
    const r = await programmer(cfg(), f.transport, { allumage: '00:15' });
    assert.equal(r.ok, true);
  });

  test('présente : sens, commande, séquence, longueur, texte de session ; jamais la clé, l\'identifiant ni les octets chiffrés', async () => {
    const f = fauxCable({ cle: CLE, dps });
    const evts = [];
    const bruts = [];
    const envoyer = f.transport.envoyer;
    f.transport.envoyer = async (o) => { bruts.push(hex(o)); return envoyer(o); };
    const r = await programmer(cfg({ trace: (e) => evts.push(e) }), f.transport, { allumage: '00:15' });
    assert.equal(r.ok, true);
    const envoyes = evts.filter((e) => e.sens === '->');
    const recus = evts.filter((e) => e.sens === '<-');
    assert.deepEqual(envoyes.map((e) => e.cmd), [3, 5, 0x10, 0x0d, 0x10]);
    assert.deepEqual(envoyes.map((e) => e.seq), [1, 2, 3, 4, 5]);
    assert.ok(recus.length >= 3 && recus.every((e) => Number.isInteger(e.retcode) && Number.isInteger(e.longueur)));
    const ecriture = envoyes.find((e) => e.cmd === 0x0d);
    assert.match(ecriture.texte, /^\{"protocol":5,"t":\d+,"data":\{"dps":\{"151":"\{\\"m\\":2,\\"dt\\":0,\\"ss\\":\\"00:15\\",\\"se\\":\\"06:00\\"\}"\}\}\}$/);
    assert.equal(envoyes[0].texte, undefined); // négociation : pas de texte
    assert.ok(recus.some((e) => typeof e.texte === 'string' && e.texte.includes('"dps"')));
    // rien de secret ni de chiffré dans tout ce qui est sorti
    const sortie = JSON.stringify(evts) + evts.map(formaterTrace).join('\n');
    assert.ok(!sortie.includes(CLE) && !sortie.includes(ID));
    for (const b of bruts) assert.ok(!sortie.includes(b.slice(36, 60)));
    assert.ok(evts.some((e) => e.note === 'connexion fermée'));
  });

  test('l\'identifiant et la clé qui apparaîtraient dans un texte reçu sont masqués', async () => {
    const f = fauxCable({ cle: CLE, dps: { ...dps, 188: `${ID}/${CLE}` } });
    const evts = [];
    const r = await lireEtat(cfg({ trace: (e) => evts.push(e) }), f.transport);
    assert.equal(r.ok, true);
    const sortie = JSON.stringify(evts);
    assert.ok(!sortie.includes(CLE) && !sortie.includes(ID));
    assert.ok(sortie.includes('***/***'));
  });

  test('une fonction de journal qui échoue ne perturbe pas le protocole', async () => {
    const f = fauxCable({ cle: CLE, dps });
    const r = await lireEtat(cfg({ trace: () => { throw new Error('boum'); } }), f.transport);
    assert.equal(r.ok, true);
  });

  test('formaterTrace : ligne lisible, sans secret', () => {
    assert.equal(formaterTrace({ ms: 12, sens: '->', cmd: 0x0d, seq: 4, longueur: 99, texte: '{"a":1}' }),
      '[+   12 ms] -> cmd=0x0d CONTROL_NEW seq=4 long=99 {"a":1}');
    assert.equal(formaterTrace({ ms: 3, note: 'session établie' }), '[+    3 ms] session établie');
    assert.match(formaterTrace({ ms: 5, sens: '<-', cmd: 8, seq: 7, longueur: 44, retcode: 0 }), /STATUS seq=7 long=44 retcode=0$/);
  });
});
