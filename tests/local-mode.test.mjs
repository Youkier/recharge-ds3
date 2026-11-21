// Tests du mode « Local » de la page (site/local.js, coque Android, lot C4). Client du pont simulé, faux câble pour
// l'écriture ; aucune connexion réelle, clé factice.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pontPresent, etatCable, chercherCable, programmerLocal } from '../site/local.js';
import { lireEtat, programmer } from '../local/tuya-local.js';
import { fauxCable } from './tuya-local-faux-cable.mjs';

const CLE = 'CLE-FACTICE-0000';
const plage = (m, ss, se) => JSON.stringify({ m, dt: 0, ss, se });

// Client du pont simulé. dps partagés : les écritures du faux câble persistent d'un appel à l'autre.
function client({ configure = true, adresse = '192.168.1.48', prefixe = '192.168.1', wifi = true, dps, ouvrirEchoue = false, cle = CLE } = {}) {
  const journal = { retenues: [], transports: 0 };
  const etat = dps ?? { 101: 202, 109: 'WAIT', 150: 16, 151: plage(2, '03:30', '06:00'), 152: 16 };
  return {
    journal, dps: etat,
    async cable() { return configure ? { ok: true, configure: true, deviceId: 'factice_0000', cle, ...(adresse ? { adresse } : {}) } : { ok: true, configure: false }; },
    async prefixeWifi() { return wifi ? { ok: true, prefixe } : { ok: false, erreur: 'pas_wifi' }; },
    async appeler(op, p) { if (op === 'retenirAdresse') journal.retenues.push(p.ip); return { ok: true }; },
    creerTransport() { journal.transports++; return fauxCable({ cle: CLE, dps: etat, ouvrirEchoue }).transport; },
    async sonder() { return false; },
  };
}
const sans = (x) => assert.ok(!JSON.stringify(x).includes(CLE), 'la clé n\'apparaît dans aucun résultat');

describe('Pont présent', () => {
  test('pontPresent', () => {
    assert.equal(pontPresent({}), false);
    assert.equal(pontPresent({ PontLocal: {} }), false);
    assert.equal(pontPresent({ PontLocal: { postMessage() {} } }), true);
  });
});

describe('État du câble à l\'ouverture (une lecture, jamais de recherche)', () => {
  test('câble prêt : plage lue, adresse retenue', async () => {
    const c = client();
    const r = await etatCable({ client: c, lireEtat });
    assert.deepEqual(r, { etat: 'pret', plage: { debut: '03:30', fin: '06:00', plage_active: true } });
    assert.deepEqual(c.journal.retenues, ['192.168.1.48']);
  });
  test('rien d\'enregistré : à relier ; pas d\'adresse : sans_adresse ; aucun transport ouvert', async () => {
    for (const [opts, attendu] of [[{ configure: false }, 'a_relier'], [{ adresse: null }, 'sans_adresse']]) {
      const c = client(opts);
      assert.equal((await etatCable({ client: c, lireEtat })).etat, attendu);
      assert.equal(c.journal.transports, 0);
    }
  });
  test('hors du Wi-Fi de la maison ou sans Wi-Fi : rien n\'est tenté', async () => {
    for (const opts of [{ prefixe: '10.0.0' }, { wifi: false }]) {
      const c = client(opts);
      assert.equal((await etatCable({ client: c, lireEtat })).etat, 'hors_wifi');
      assert.equal(c.journal.transports, 0);
    }
  });
  test('câble débranché : muet, rien de retenu ; clé refusée : cle', async () => {
    const c = client({ ouvrirEchoue: true });
    assert.equal((await etatCable({ client: c, lireEtat })).etat, 'muet');
    assert.deepEqual(c.journal.retenues, []);
    const k = client({ cle: 'AUTRE-CLE-000001' });
    assert.equal((await etatCable({ client: k, lireEtat })).etat, 'cle');
    assert.deepEqual(k.journal.retenues, []);
  });
});

describe('Recherche à la demande', () => {
  test('hors Wi-Fi ; introuvable ; trouvé et retenu, progression transmise', async () => {
    assert.equal((await chercherCable({ client: client({ wifi: false }), localiserCable: async () => ({ ok: true }) })).etat, 'hors_wifi');
    assert.equal((await chercherCable({ client: client(), localiserCable: async () => ({ ok: false, erreur: 'hors_ligne' }) })).etat, 'introuvable');
    const c = client({ adresse: '192.168.1.48' });
    let vu = null;
    const surProgres = () => {};
    const r = await chercherCable({ client: c, localiserCable: async (o) => { vu = o; return { ok: true, ip: '192.168.1.77', etat: { debut: '03:30', fin: '06:00', plage_active: true } }; } }, surProgres);
    assert.equal(r.ok, true);
    assert.deepEqual(vu.departs, ['192.168.1.48']);
    assert.deepEqual(vu.interfaces, ['192.168.1.1']);
    assert.equal(vu.surProgres, surProgres);
    assert.deepEqual(c.journal.retenues, ['192.168.1.77']);
  });
});

describe('Programmer en local (règle 2 : jamais d\'échec silencieux)', () => {
  test('pas de charge ce soir : plage courte écrite et relue sur le faux câble, résultat vérifié par service.js', async () => {
    const c = client();
    const r = await programmerLocal({ desactiver: true }, { client: c, programmer }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.match(r.message, /Pas de charge cette nuit : plage réduite à une minute \(05:59–06:00\)/);
    assert.deepEqual(c.journal.retenues, ['192.168.1.48']);
    sans(r);
  });
  test('programmer une heure : ok seulement si relu conforme', async () => {
    const c = client();
    const r = await programmerLocal({ allumage: '23:45' }, { client: c, programmer }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.ok(/Charge programmée : démarrage 23:45|Démarrage immédiat/.test(r.message), r.message);
  });
  test('échecs : heure manuelle toujours donnée, rien de retenu', async () => {
    const cas = [
      [client({ prefixe: '10.0.0' }), 'local_hors_wifi', false],
      [client({ configure: false }), 'local_pas_de_cle', false],
      [client({ adresse: null }), 'local_muet', false],
      [client({ ouvrirEchoue: true }), 'local_muet', false],
      [client({ cle: 'AUTRE-CLE-000001' }), 'local_cle', false],
    ];
    for (const [c, code, incertain] of cas) {
      const r = await programmerLocal({ allumage: '23:45' }, { client: c, programmer }, '06:00');
      assert.equal(r.etat, 'ko');
      assert.equal(r.code, code);
      assert.equal(r.incertain, incertain);
      assert.match(r.manuel, /À régler à la main dans Smart Life : plage de charge du câble, début 23:45/);
      assert.deepEqual(c.journal.retenues, []);
      sans(r);
    }
  });
  test('délai : incertain, « Vérifiez dans Smart Life » ; exception : ko local_format ; relu différent : ko', async () => {
    const d = await programmerLocal({ allumage: '23:45' }, { client: client(), programmer: async () => ({ ok: false, erreur: 'delai' }) }, '06:00');
    assert.deepEqual([d.code, d.incertain, d.verifier], ['local_delai', true, 'Vérifiez dans Smart Life.']);
    const x = await programmerLocal({ allumage: '23:45' }, { client: client(), programmer: async () => { throw new Error('boum'); } }, '06:00');
    assert.equal(x.code, 'local_format');
    const c = client();
    const f = await programmerLocal({ allumage: '23:45' }, { client: c, programmer: async () => ({ ok: true, debut: '23:50', fin: '06:00', plage_active: true }) }, '06:00');
    assert.deepEqual([f.etat, f.code], ['ko', 'relecture_differente']);
    assert.deepEqual(c.journal.retenues, [], 'rien de retenu sans résultat vérifié');
  });
  test('demande absente : ko, rien n\'est tenté', async () => {
    const c = client();
    assert.equal((await programmerLocal(null, { client: c, programmer }, '06:00')).etat, 'ko');
    assert.equal(c.journal.transports, 0);
  });
});

test('site/local.js : un seul import (service.js), ni stockage ni console', () => {
  const src = readFileSync(new URL('../site/local.js', import.meta.url), 'utf8');
  assert.deepEqual([...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./service.js']);
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\.|import\(/.test(code));
});

// Seconde tentative (premier essai réel du 2026-11-21 : premier contact raté, second réussi).
describe('Seconde tentative, jamais après une écriture', () => {
  const ok = { ok: true, debut: '23:45', fin: '06:00', plage_active: true };
  test('échec de contact sans écriture : une seconde tentative, qui réussit', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client(), programmer: async () => (++n === 1 ? { ok: false, erreur: 'hors_ligne' } : ok) }, '06:00');
    assert.equal(n, 2);
    assert.equal(r.etat, 'ok');
  });
  test('écriture partie (ecrit: true) : aucune seconde tentative, résultat incertain', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client(), programmer: async () => { n++; return { ok: false, erreur: 'delai', ecrit: true }; } }, '06:00');
    assert.equal(n, 1, 'une écriture peut-être appliquée n\'est jamais relancée');
    assert.deepEqual([r.etat, r.incertain], ['ko', true]);
  });
  test('relecture différente ou requête invalide : aucune seconde tentative', async () => {
    for (const e of [{ ok: false, erreur: 'relecture_differente', ecrit: true }, { ok: false, erreur: 'requete_invalide' }, { ok: false, erreur: 'format' }]) {
      let n = 0;
      await programmerLocal({ allumage: '23:45' }, { client: client(), programmer: async () => { n++; return e; } }, '06:00');
      assert.equal(n, 1, e.erreur);
    }
  });
  test('deux échecs de contact : deux tentatives au plus, heure manuelle donnée', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client(), programmer: async () => { n++; return { ok: false, erreur: 'delai' }; } }, '06:00');
    assert.equal(n, 2);
    assert.match(r.manuel, /début 23:45/);
  });
  test('lecture d\'état : seconde lecture plus longue si la première échoue', async () => {
    const delais = [];
    const r = await etatCable({ client: client(), lireEtat: async (cfg) => { delais.push(cfg.delaiGlobalMs); return delais.length === 1 ? { ok: false, erreur: 'delai' } : { ok: true, debut: '03:30', fin: '06:00', plage_active: true }; } });
    assert.deepEqual(delais, [4000, 8000]);
    assert.equal(r.etat, 'pret');
  });
});
