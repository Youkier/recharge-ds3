// Tests du mode « Local » de la page (site/local.js, coque Android). Depuis le lot E2, le protocole tourne dans le code
// natif (Kotlin, testé en JUnit avec le faux câble) : ici, client du pont SIMULÉ, qui répond ce que répond le natif, pour
// vérifier la traduction en états de la page, la règle 2 (jamais d'échec silencieux) et que la clé ne passe jamais par la page.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pontPresent, lireConfigurationCable, etatCable, chercherCable, programmerLocal, surLeReseauDeLaMaison } from '../site/local.js';

const PLAGE = { ok: true, debut: '03:30', fin: '06:00', plage_active: true };

// Client du pont simulé. lire / programmer / chercher : réponses du natif (valeur, ou fonction appelée à chaque appel).
function client({ configure = true, adresse = '192.168.1.48', prefixe = '192.168.1', wifi = true, lire = PLAGE, programmer, chercher, memoriser = { ok: true } } = {}) {
  const journal = { lectures: [], programmes: [], recherches: [], cable: 0, memoriser: 0 };
  const rep = (x, ...args) => (typeof x === 'function' ? x(...args) : x);
  return {
    journal,
    async cable() { journal.cable++; return configure ? { ok: true, configure: true, ...(adresse ? { adresse } : {}) } : { ok: true, configure: false }; },
    async prefixeWifi() { return wifi ? { ok: true, prefixe } : { ok: false, erreur: 'pas_wifi' }; },
    async memoriser() { journal.memoriser++; return memoriser; },
    async lire(params, delai) { journal.lectures.push({ params, delai }); return rep(lire, params, delai); },
    async programmer(action, params, delai) {
      journal.programmes.push({ action, params, delai });
      return rep(programmer ?? ((a) => ({ ok: true, debut: a.desactiver ? '05:59' : a.allumage, fin: '06:00', plage_active: true, immediat: false, courte: !!a.desactiver })), action, params, delai);
    },
    async chercher(params, surProgres) { journal.recherches.push(params); return rep(chercher ?? { ok: false, erreur: 'introuvable' }, params, surProgres); },
  };
}

describe('Pont présent', () => {
  test('pontPresent', () => {
    assert.equal(pontPresent({}), false);
    assert.equal(pontPresent({ PontLocal: {} }), false);
    assert.equal(pontPresent({ PontLocal: { postMessage() {} } }), true);
  });
});

describe('État du câble à l\'ouverture (une lecture, jamais de recherche)', () => {
  test('câble prêt : plage lue à l\'adresse retenue', async () => {
    const c = client();
    const r = await etatCable({ client: c });
    assert.deepEqual(r, { etat: 'pret', plage: { debut: '03:30', fin: '06:00', plage_active: true } });
    assert.deepEqual(c.journal.lectures, [{ params: { ip: '192.168.1.48' }, delai: 4000 }]);
    assert.deepEqual(c.journal.recherches, []);
  });
  test('rien d\'enregistré : à relier ; pas d\'adresse : sans_adresse ; aucune lecture', async () => {
    for (const [opts, attendu] of [[{ configure: false }, 'a_relier'], [{ adresse: null }, 'sans_adresse']]) {
      const c = client(opts);
      assert.equal((await etatCable({ client: c })).etat, attendu);
      assert.equal(c.journal.lectures.length, 0);
    }
  });
  test('hors du Wi-Fi de la maison ou sans Wi-Fi : rien n\'est tenté', async () => {
    for (const opts of [{ prefixe: '10.0.0' }, { wifi: false }]) {
      const c = client(opts);
      assert.equal((await etatCable({ client: c })).etat, 'hors_wifi');
      assert.equal(c.journal.lectures.length, 0);
    }
  });
  test('câble débranché : muet ; clé refusée : cle ; autres erreurs du natif', async () => {
    const attendus = [['hors_ligne', 'muet'], ['delai', 'muet'], ['cle', 'cle'], ['format', 'erreur'], ['occupe', 'erreur'], ['pont_muet', 'erreur'],
      ['pas_de_cle', 'a_relier'], ['pas_wifi', 'hors_wifi']];
    for (const [erreur, etat] of attendus) {
      assert.equal((await etatCable({ client: client({ lire: { ok: false, erreur } }) })).etat, etat, erreur);
    }
  });
  test('seconde lecture, plus longue, si la première échoue par contact ; pas pour une erreur de format', async () => {
    const delais = [];
    const r = await etatCable({ client: client({ lire: (p, d) => { delais.push(d); return delais.length === 1 ? { ok: false, erreur: 'delai' } : PLAGE; } }) });
    assert.deepEqual(delais, [4000, 8000]);
    assert.equal(r.etat, 'pret');
    const c = client({ lire: { ok: false, erreur: 'format' } });
    await etatCable({ client: c });
    assert.equal(c.journal.lectures.length, 1);
  });
});

describe('Le téléphone est-il sur le réseau de la maison ? (une lecture, aucun contact avec le câble)', () => {
  test('oui, non, pas de Wi-Fi, inconnu', async () => {
    assert.equal(await surLeReseauDeLaMaison({ client: client() }), 'oui');
    assert.equal(await surLeReseauDeLaMaison({ client: client({ prefixe: '10.0.0' }) }), 'non');
    assert.equal(await surLeReseauDeLaMaison({ client: client({ wifi: false }) }), 'pas_wifi');
    assert.equal(await surLeReseauDeLaMaison({ client: client({ adresse: null }) }), 'inconnu');
    assert.equal(await surLeReseauDeLaMaison({ client: client({ configure: false }) }), 'inconnu');
    assert.equal(await surLeReseauDeLaMaison({ client: { cable() { throw new Error('x'); } } }), 'inconnu');
  });
  test('aucune lecture du câble', async () => {
    const c = client({ prefixe: '10.0.0' });
    await surLeReseauDeLaMaison({ client: c });
    assert.equal(c.journal.lectures.length + c.journal.programmes.length, 0);
  });
});

describe('Recherche à la demande', () => {
  test('hors Wi-Fi ; introuvable (deux passages) ; clé absente', async () => {
    assert.equal((await chercherCable({ client: client({ wifi: false }) })).etat, 'hors_wifi');
    const c = client();
    assert.equal((await chercherCable({ client: c })).etat, 'introuvable');
    assert.equal(c.journal.recherches.length, 2, 'un second passage automatique');
    assert.equal((await chercherCable({ client: client({ configure: false }) })).etat, 'a_relier');
    const d = client({ chercher: { ok: false, erreur: 'occupe' } });
    assert.equal((await chercherCable({ client: d })).etat, 'erreur');
    assert.equal(d.journal.recherches.length, 1, 'pas de second passage pour autre chose que « introuvable »');
    assert.equal((await chercherCable({ client: client({ chercher: { ok: false, erreur: 'pas_wifi' } }) })).etat, 'hors_wifi');
  });
  test('trouvé : adresse de départ transmise, progression relayée, plage rendue', async () => {
    const c = client({ adresse: '192.168.1.48', chercher: (p, surProgres) => { surProgres({ etape: 'sondes', echeance: 123 }); return { ok: true, ip: '192.168.1.77', trouve: true, debut: '03:30', fin: '06:00', plage_active: true }; } });
    const vus = [];
    const r = await chercherCable({ client: c }, (p) => vus.push(p));
    assert.deepEqual(r, { ok: true, plage: { debut: '03:30', fin: '06:00', plage_active: true } });
    assert.deepEqual(c.journal.recherches, [{ ip: '192.168.1.48' }]);
    assert.deepEqual(vus, [{ etape: 'sondes', echeance: 123 }]);
  });
  test('adresse retenue sur un autre réseau : pas de départ', async () => {
    const c = client({ adresse: '10.9.9.9' });
    await chercherCable({ client: c });
    assert.deepEqual(c.journal.recherches[0], {});
  });
});

describe('Programmer en local (règle 2 : jamais d\'échec silencieux)', () => {
  test('pas de charge ce soir : seule l\'action « desactiver » part, résultat vérifié par service.js', async () => {
    const c = client();
    const r = await programmerLocal({ desactiver: true }, { client: c }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.match(r.message, /Le câble ne chargera pas cette nuit \(05:59–06:00\)/);
    assert.equal(r.rappel, 'Demain soir, reprogrammez : sinon la voiture ne chargera pas.');
    assert.deepEqual(c.journal.programmes.map((x) => x.action), [{ desactiver: true }]);
    assert.deepEqual(c.journal.programmes[0].params, { ip: '192.168.1.48' });
  });
  test('programmer une heure : ok seulement si relu conforme ; seule l\'heure part', async () => {
    const c = client();
    const r = await programmerLocal({ allumage: '23:45', autre: 'x', courant: 10 }, { client: c }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.equal(r.rappel, 'Pensez à brancher la voiture ce soir.');
    assert.ok(/Charge programmée : démarrage 23:45|Démarrage immédiat/.test(r.message), r.message);
    assert.deepEqual(c.journal.programmes.map((x) => x.action), [{ allumage: '23:45' }], 'rien d\'autre que l\'heure n\'est transmis');
  });
  test('échecs : heure manuelle toujours donnée', async () => {
    const cas = [
      [client({ prefixe: '10.0.0' }), 'local_hors_wifi', false],
      [client({ configure: false }), 'local_pas_de_cle', false],
      [client({ adresse: null }), 'local_muet', false],
      [client({ programmer: { ok: false, erreur: 'hors_ligne' } }), 'local_muet', false],
      [client({ programmer: { ok: false, erreur: 'cle' } }), 'local_cle', false],
      [client({ programmer: { ok: false, erreur: 'pas_wifi' } }), 'local_hors_wifi', false],
      [client({ programmer: { ok: false, erreur: 'pas_de_cle' } }), 'local_pas_de_cle', false],
      [client({ programmer: { ok: false, erreur: 'occupe' } }), 'local_occupe', false],
      [client({ programmer: { ok: false, erreur: 'pont_muet' } }), 'local_format', true],
    ];
    for (const [c, code, incertain] of cas) {
      const r = await programmerLocal({ allumage: '23:45' }, { client: c }, '06:00');
      assert.equal(r.etat, 'ko');
      assert.equal(r.code, code);
      assert.equal(r.incertain, incertain, code);
      assert.match(r.manuel, /À régler à la main dans Smart Life : plage de charge du câble, début 23:45/);
    }
  });
  test('délai : incertain, « Vérifiez dans Smart Life » ; exception : ko local_format ; relu différent : ko', async () => {
    const d = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: { ok: false, erreur: 'delai', ecrit: true } }) }, '06:00');
    assert.deepEqual([d.code, d.incertain, d.verifier], ['local_delai', true, 'Vérifiez dans Smart Life > charge différée : début 23:45, activée.']);
    assert.match(d.message, /Fermez Smart Life s'il est ouvert, puis réessayez\.$/);
    const x = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: () => { throw new Error('boum'); } }) }, '06:00');
    assert.equal(x.code, 'local_format');
    const f = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: { ok: true, debut: '23:50', fin: '06:00', plage_active: true } }) }, '06:00');
    assert.deepEqual([f.etat, f.code], ['ko', 'relecture_differente']);
    const g = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: { ok: false, erreur: 'relecture_differente', ecrit: true } }) }, '06:00');
    assert.deepEqual([g.etat, g.code, g.incertain], ['ko', 'relecture_differente', true]);
  });
  test('demande absente : ko, rien n\'est tenté', async () => {
    const c = client();
    assert.equal((await programmerLocal(null, { client: c }, '06:00')).etat, 'ko');
    assert.equal(c.journal.programmes.length, 0);
  });
});

test('site/local.js : un seul import (service.js), ni stockage ni console, jamais la clé ni l\'identifiant du câble', () => {
  const src = readFileSync(new URL('../site/local.js', import.meta.url), 'utf8');
  assert.deepEqual([...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./service.js']);
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\.|import\(/.test(code));
  assert.ok(!/cleLocale|deviceId|\.cle\b|local\/tuya-local|local\/recherche|creerTransport|retenirAdresse/.test(code), 'plus de protocole ni de clé côté page');
});

// Seconde tentative (premier essai réel du 2026-11-21 : premier contact raté, second réussi).
describe('Seconde tentative, jamais après une écriture', () => {
  const ok = { ok: true, debut: '23:45', fin: '06:00', plage_active: true };
  test('échec de contact sans écriture : une seconde tentative, qui réussit', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: () => (++n === 1 ? { ok: false, erreur: 'hors_ligne' } : ok) }) }, '06:00');
    assert.equal(n, 2);
    assert.equal(r.etat, 'ok');
  });
  test('écriture partie (ecrit: true) : aucune seconde tentative, résultat incertain', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: () => { n++; return { ok: false, erreur: 'delai', ecrit: true }; } }) }, '06:00');
    assert.equal(n, 1, 'une écriture peut-être appliquée n\'est jamais relancée');
    assert.deepEqual([r.etat, r.incertain], ['ko', true]);
  });
  test('relecture différente, requête invalide ou format : aucune seconde tentative', async () => {
    for (const e of [{ ok: false, erreur: 'relecture_differente', ecrit: true }, { ok: false, erreur: 'requete_invalide' }, { ok: false, erreur: 'format' }, { ok: false, erreur: 'occupe' }]) {
      let n = 0;
      await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: () => { n++; return e; } }) }, '06:00');
      assert.equal(n, 1, e.erreur);
    }
  });
  test('deux échecs de contact : deux tentatives au plus, heure manuelle donnée', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: () => { n++; return { ok: false, erreur: 'delai' }; } }) }, '06:00');
    assert.equal(n, 2);
    assert.match(r.manuel, /début 23:45/);
  });
});

describe('Seconde tentative : sous le plafond de 30 s de la page', () => {
  test('la seconde tentative reçoit seulement le temps restant', async () => {
    const c = client({ programmer: { ok: false, erreur: 'hors_ligne' } });
    await programmerLocal({ allumage: '23:45' }, { client: c }, '06:00');
    const delais = c.journal.programmes.map((x) => x.delai);
    assert.equal(delais.length, 2);
    assert.equal(delais[0], 20000, 'première tentative : 20 s');
    assert.ok(delais[1] > 0 && delais[1] <= 27000, `seconde tentative bornée : ${delais[1]}`);
  });
  test('trop peu de temps restant : pas de seconde tentative', async () => {
    let n = 0;
    const r = await programmerLocal({ allumage: '23:45' }, { client: client({ programmer: async () => { n++; await new Promise((ok) => setTimeout(ok, 30)); return { ok: false, erreur: 'delai' }; } }) }, '06:00');
    assert.equal(n, 2); // 30 ms écoulées : il reste largement plus de 5 s
    assert.equal(r.etat, 'ko');
  });
});

describe('Configuration du câble gardée par le natif (attente en arrière-plan, téléphone verrouillé)', () => {
  test('lireConfigurationCable : { pret, adresse } sans clé ; pas de clé : erreur', async () => {
    const r = await lireConfigurationCable(client());
    assert.deepEqual(r, { pret: true, adresse: '192.168.1.48' });
    assert.deepEqual(await lireConfigurationCable(client({ memoriser: { ok: false, erreur: 'pas_de_cle' } })), { erreur: 'local_pas_de_cle' });
    assert.deepEqual(await lireConfigurationCable(client({ memoriser: { ok: false, erreur: 'occupe' } })), { erreur: 'local_format' });
    assert.deepEqual(await lireConfigurationCable({ memoriser() { throw new Error('x'); } }), { erreur: 'local_format' });
  });
  test('etatCable, réseau et programmation ne rappellent plus client.cable() ; l\'adresse du câble sert', async () => {
    const c = client();
    const confCable = await lireConfigurationCable(c);
    c.journal.cable = 0;
    const deps = { client: c, confCable };
    assert.equal(await surLeReseauDeLaMaison(deps), 'oui');
    assert.equal((await etatCable(deps)).etat, 'pret');
    assert.equal((await programmerLocal({ allumage: '03:30' }, deps, '06:00')).etat, 'ok');
    assert.equal(c.journal.cable, 0);
  });
  test('recherche : trouvé à une autre adresse, la configuration gardée est mise à jour', async () => {
    const c = client({ chercher: { ok: true, ip: '192.168.1.77', trouve: true, debut: '03:30', fin: '06:00', plage_active: true } });
    const confCable = await lireConfigurationCable(c);
    const r = await chercherCable({ client: c, confCable });
    assert.equal(r.ok, true);
    assert.equal(confCable.adresse, '192.168.1.77');
    const p = await programmerLocal({ allumage: '03:30' }, { client: c, confCable }, '06:00');
    assert.equal(p.etat, 'ok');
    assert.deepEqual(c.journal.programmes.at(-1).params, { ip: '192.168.1.77' });
  });
});
