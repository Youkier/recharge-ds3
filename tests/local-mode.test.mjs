// Tests du mode « Local » de la page (site/local.js, coque Android). Depuis le lot E2, le protocole tourne dans le code
// natif (Kotlin, testé en JUnit avec le faux câble) : ici, client du pont SIMULÉ, qui répond ce que répond le natif, pour
// vérifier la traduction en états de la page, la règle 2 (jamais d'échec silencieux) et que la clé ne passe jamais par la page.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pontPresent, etatCable, chercherCable, programmerLocal, surLeReseauDeLaMaison } from '../site/local.js';

// Demande complète du contrat du 2026-11-22 : début, fin du plan, durée de charge, départ.
const dem = (allumage, o = {}) => ({ allumage, fin: '06:00', duree_min: 300, depart: '07:30', ...o });
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
      return rep(programmer ?? ((a) => ({ ok: true, debut: a.desactiver ? '05:59' : a.allumage, fin: a.desactiver ? a.fin : a.fin, plage_active: true, tardif: false, courte: !!a.desactiver })), action, params, delai);
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
    assert.deepEqual(c.journal.lectures, [{ params: { ip: '192.168.1.48', reessayer: true }, delai: 4000 }]);
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
  test('la seconde lecture est faite par le natif : une seule demande, avec reessayer ; les erreurs sont traduites', async () => {
    const c = client({ lire: { ok: false, erreur: 'delai' } });
    assert.equal((await etatCable({ client: c })).etat, 'muet');
    assert.equal(c.journal.lectures.length, 1, 'la page ne relance rien elle-même');
    assert.equal(c.journal.lectures[0].params.reessayer, true);
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
  test('hors Wi-Fi ; introuvable (second balayage fait par le natif) ; clé absente', async () => {
    assert.equal((await chercherCable({ client: client({ wifi: false }) })).etat, 'hors_wifi');
    const c = client();
    assert.equal((await chercherCable({ client: c })).etat, 'introuvable');
    assert.equal(c.journal.recherches.length, 1, 'une seule demande : le second balayage est natif');
    assert.equal(c.journal.recherches[0].reessayer, true);
    assert.equal((await chercherCable({ client: client({ configure: false }) })).etat, 'a_relier');
    const d = client({ chercher: { ok: false, erreur: 'occupe' } });
    assert.equal((await chercherCable({ client: d })).etat, 'erreur');
    assert.equal((await chercherCable({ client: client({ chercher: { ok: false, erreur: 'pas_wifi' } }) })).etat, 'hors_wifi');
  });
  test('trouvé : adresse de départ transmise, progression relayée, plage rendue', async () => {
    const c = client({ adresse: '192.168.1.48', chercher: (p, surProgres) => { surProgres({ etape: 'sondes', echeance: 123 }); return { ok: true, ip: '192.168.1.77', trouve: true, debut: '03:30', fin: '06:00', plage_active: true }; } });
    const vus = [];
    const r = await chercherCable({ client: c }, (p) => vus.push(p));
    assert.deepEqual(r, { ok: true, plage: { debut: '03:30', fin: '06:00', plage_active: true } });
    assert.deepEqual(c.journal.recherches, [{ ip: '192.168.1.48', reessayer: true }]);
    assert.deepEqual(vus, [{ etape: 'sondes', echeance: 123 }]);
  });
  test('adresse retenue sur un autre réseau : pas de départ', async () => {
    const c = client({ adresse: '10.9.9.9' });
    await chercherCable({ client: c });
    assert.deepEqual(c.journal.recherches[0], { reessayer: true });
  });
});

describe('Programmer en local (règle 2 : jamais d\'échec silencieux)', () => {
  test('pas de charge ce soir : seule l\'action « desactiver » part, résultat vérifié par service.js', async () => {
    const c = client();
    const r = await programmerLocal({ desactiver: true, fin: '06:00' }, { client: c }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.match(r.message, /Le câble ne chargera pas cette nuit \(05:59–06:00\)/);
    assert.equal(r.rappel, 'Demain soir, reprogrammez : sinon la voiture ne chargera pas.');
    assert.deepEqual(c.journal.programmes.map((x) => x.action), [{ desactiver: true, fin: '06:00' }]);
    assert.deepEqual(c.journal.programmes[0].params, { ip: '192.168.1.48', reessayer: true });
  });
  test('programmer une heure : ok seulement si relu conforme ; seuls début, fin, durée et départ partent', async () => {
    const c = client();
    const r = await programmerLocal({ ...dem('23:45'), autre: 'x', courant: 10 }, { client: c }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.equal(r.rappel, 'Branchez la voiture avant 23:45 : sinon la charge ne démarrera pas.');
    assert.equal(r.message, 'Charge programmée : démarrage 23:45');
    assert.deepEqual(c.journal.programmes.map((x) => x.action), [{ allumage: '23:45', fin: '06:00', duree_min: 300, depart: '07:30' }], 'rien d\'autre que le contrat n\'est transmis');
    assert.deepEqual(c.journal.programmes[0].params, { ip: '192.168.1.48', reessayer: true });
  });
  test('démarrage tardif : le natif décale le début, la page affiche l\'alerte avec les heures relues', async () => {
    const c = client({ programmer: { ok: true, debut: '23:40', fin: '06:40', plage_active: true, tardif: true, courte: false } });
    const r = await programmerLocal(dem('23:00', { duree_min: 420 }), { client: c }, '06:00');
    assert.equal(r.etat, 'ok', JSON.stringify(r));
    assert.equal(r.tardif, true);
    assert.equal(r.message, 'Heure de début dépassée : charge programmée de 23:40 à 06:40.');
    assert.equal(r.detail, 'Dont 40 min en heures pleines.');
    assert.equal(r.rappel, 'Branchez la voiture avant 23:40.');
  });
  test('trop tard : rien n\'a été écrit, KO sans incertitude avec l\'heure à la main', async () => {
    const c = client({ programmer: { ok: false, erreur: 'trop_tard' } });
    const r = await programmerLocal(dem('23:00'), { client: c }, '06:00');
    assert.deepEqual([r.etat, r.code, r.incertain, r.verifier], ['ko', 'trop_tard', false, null]);
    assert.match(r.message, /Trop tard pour charger avant le départ \(07:30\)/);
    assert.match(r.manuel, /début 23:00, déjà passé/);
  });
  test('demande de l\'ancien contrat (allumage seul) : refusée par le natif, KO affiché', async () => {
    const c = client({ programmer: { ok: false, erreur: 'requete_invalide' } });
    const r = await programmerLocal({ allumage: '23:45' }, { client: c }, '06:00');
    assert.equal(r.etat, 'ko');
    assert.equal(r.code, 'requete_invalide');
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
      const r = await programmerLocal(dem('23:45'), { client: c }, '06:00');
      assert.equal(r.etat, 'ko');
      assert.equal(r.code, code);
      assert.equal(r.incertain, incertain, code);
      assert.match(r.manuel, /À régler à la main dans Smart Life : plage de charge du câble, début 23:45/);
    }
  });
  test('délai : incertain, « Vérifiez dans Smart Life » ; exception : ko local_format ; relu différent : ko', async () => {
    const soir = () => new Date('2027-01-12T20:00:00Z'); // 21:00 à Paris : avant le début, règle normale
    const d = await programmerLocal(dem('23:45'), { client: client({ programmer: { ok: false, erreur: 'delai', ecrit: true } }), maintenant: soir }, '06:00');
    assert.deepEqual([d.code, d.incertain, d.verifier], ['local_delai', true, 'Vérifiez dans Smart Life > charge différée : début 23:45, fin 06:00, activée.']);
    assert.match(d.manuel, /début 23:45, fin 06:00\./);
    // Échec alors que l'heure de début est passée : la consigne donne l'heure tardive (début = maintenant + 10 min, fin bornée par le départ).
    const tard = await programmerLocal(dem('23:00', { duree_min: 420 }), { client: client({ programmer: { ok: false, erreur: 'delai', ecrit: true } }), maintenant: () => new Date('2027-01-12T22:50:00Z') }, '06:00'); // 23:50
    assert.match(tard.manuel, /début 00:00, fin 07:00 \(heure de début dépassée : début dans 10 min\)/);
    assert.equal(tard.verifier, 'Vérifiez dans Smart Life > charge différée : début 00:00, fin 07:00, activée.');
    assert.match(d.message, /Fermez Smart Life s'il est ouvert, puis réessayez\.$/);
    const x = await programmerLocal(dem('23:45'), { client: client({ programmer: () => { throw new Error('boum'); } }) }, '06:00');
    assert.equal(x.code, 'local_format');
    const f = await programmerLocal(dem('23:45'), { client: client({ programmer: { ok: true, debut: '23:50', fin: '06:00', plage_active: true } }) }, '06:00');
    assert.deepEqual([f.etat, f.code], ['ko', 'relecture_differente']);
    const g = await programmerLocal(dem('23:45'), { client: client({ programmer: { ok: false, erreur: 'relecture_differente', ecrit: true } }) }, '06:00');
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

// Nouvelles tentatives : depuis le 2026-11-22, elles sont faites par OperationsCable (JUnit : OperationsCableTest), qui est
// le seul endroit où vit la règle « jamais de nouvel envoi après une écriture ». La page ne relance JAMAIS un envoi.
describe('Nouvelles tentatives : demandées au natif, jamais relancées par la page', () => {
  test('une seule demande d\'écriture, avec reessayer, quel que soit le résultat', async () => {
    for (const e of [{ ok: false, erreur: 'hors_ligne' }, { ok: false, erreur: 'delai', ecrit: true }, { ok: false, erreur: 'relecture_differente', ecrit: true }, { ok: false, erreur: 'requete_invalide' }, { ok: false, erreur: 'format' }, { ok: false, erreur: 'occupe' }]) {
      const c = client({ programmer: e });
      const r = await programmerLocal(dem('23:45'), { client: c }, '06:00');
      assert.equal(c.journal.programmes.length, 1, e.erreur);
      assert.equal(c.journal.programmes[0].params.reessayer, true);
      assert.equal(r.etat, 'ko');
      assert.match(r.manuel, /début 23:45/);
    }
  });
  test('écriture partie (ecrit: true) : résultat incertain', async () => {
    const r = await programmerLocal(dem('23:45'), { client: client({ programmer: { ok: false, erreur: 'delai', ecrit: true } }) }, '06:00');
    assert.deepEqual([r.etat, r.incertain], ['ko', true]);
  });
  test('la durée de la demande reste de 20 s : le budget de 27 s est tenu par le natif', async () => {
    const c = client({ programmer: { ok: false, erreur: 'hors_ligne' } });
    await programmerLocal(dem('23:45'), { client: c }, '06:00');
    assert.equal(c.journal.programmes[0].delai, 20000);
  });
  test('site/local.js ne contient plus de liste d\'échecs à retenter ni de budget', () => {
    const code = readFileSync(new URL('../site/local.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/ECHECS_A_RETENTER|BUDGET_ECRITURE_MS|Date\.now\(\)/.test(code));
  });
});

describe('La page ne garde plus rien de la configuration du câble (E3 : le natif la tient pour l’attente)', () => {
  test("site/local.js ne connaît ni mémorisation ni configuration fournie par l'appelant", () => {
    const code = readFileSync(new URL('../site/local.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/memoriser|oublierMemoire|confCable|lireConfigurationCable/.test(code));
  });
  test("l'adresse retenue sert à chaque appel, sans clé", async () => {
    const c = client();
    const deps = { client: c };
    assert.equal(await surLeReseauDeLaMaison(deps), 'oui');
    assert.equal((await etatCable(deps)).etat, 'pret');
    assert.equal((await programmerLocal(dem('03:30'), deps, '06:00')).etat, 'ok');
  });
  test("une écriture partie n'est jamais dite « rien n'a été modifié »", async () => {
    const c = client({ programmer: { ok: false, erreur: 'hors_ligne', ecrit: true } });
    const p = await programmerLocal(dem('03:30'), { client: c }, '06:00');
    assert.equal(p.etat, 'ko');
    assert.equal(p.incertain, true);
  });
});
