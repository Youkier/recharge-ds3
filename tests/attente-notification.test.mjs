// Résultat d'une attente tenue par le code natif (lot E3, appli 0.5) : le natif rend un résultat BRUT de la forme de « programmer » ;
// la page l'interprète avec service.js (seul chemin vers « ok »). Les notifications, elles, sont construites côté Android
// (Attente.kt, testé en JUnit) : ici, ce que voit la page quand elle rouvre l'appli après la fin de l'attente.
// Relecture du 2026-11-21 : « Pas de charge ce soir » réussi ne doit jamais être annoncé « Charge programmée ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultatAttente, codeLocal } from '../site/local.js';
import { heureManuelleDe, messageNonSuivie, resultatKo } from '../site/service.js';

const dem = (allumage) => ({ allumage, fin: '06:00', duree_min: 300, depart: '07:30' });
const MAINTENANT = new Date('2026-11-16T22:30:00Z'); // 23:30 à Paris
const attente = (demande, brut, h) => resultatAttente(demande, brut, '06:00', MAINTENANT, h);

test('Charge programmée : relecture conforme, début et fin', () => {
  const r = attente(dem('02:10'), { ok: true, debut: '02:10', fin: '06:00', plage_active: true });
  assert.equal(r.etat, 'ok');
  assert.equal(r.debut, '02:10');
  assert.equal(r.fin, '06:00');
});

test('Jamais de faux OK : une relecture différente de la demande est refusée', () => {
  for (const relu of [
    { ok: true, debut: '02:20', fin: '06:00', plage_active: true }, { ok: true, debut: '02:10', fin: '05:00', plage_active: true },
    { ok: true, debut: '02:10', fin: '06:00', plage_active: false }, { ok: true, debut: '02:10', plage_active: true }, { ok: true },
  ]) {
    const r = attente(dem('02:10'), relu);
    assert.equal(r.etat, 'ko', JSON.stringify(relu));
    assert.equal(r.incertain, true);
    assert.match(r.manuel, /début .*fin 06:00/);
  }
});

test('Échec : KO avec l\'heure à régler à la main, début et fin', () => {
  const r = attente(dem('02:10'), { ok: false, erreur: 'cle' });
  assert.equal(r.etat, 'ko');
  assert.match(r.manuel, /début 02:10, fin 06:00/);
});

test('Une écriture partie n\'est jamais dite « rien n\'a été modifié »', () => {
  for (const erreur of ['hors_ligne', 'cle', 'pas_wifi', 'occupe']) {
    assert.equal(codeLocal(erreur, true), 'local_format', erreur);
    const r = attente(dem('02:10'), { ok: false, erreur, ecrit: true });
    assert.equal(r.incertain, true, erreur);
    assert.match(r.verifier, /Vérifiez dans Smart Life/);
  }
  assert.equal(codeLocal('delai', true), 'local_delai');
  assert.equal(codeLocal('hors_ligne', false), 'local_muet');
});

test('Attente sans envoi : annulée, expirée, câble muet, clé refusée', () => {
  const cas = { attente_annulee: 'local_attente_annulee', attente_expiree: 'local_attente_expiree', attente_cable: 'local_attente_cable', attente_cle: 'local_attente_cle' };
  for (const [erreur, code] of Object.entries(cas)) {
    const r = attente(dem('02:10'), { ok: false, erreur });
    assert.equal(r.code, code);
    assert.equal(r.incertain, false);
    assert.match(r.message, /rien n.a été envoyé/);
    assert.match(r.manuel, /début 02:10, fin 06:00/);
  }
});

test('« Pas de charge ce soir » réussi : « aucune », jamais « Charge programmée »', () => {
  const r = attente({ desactiver: true, fin: '06:00' }, { ok: true, debut: '05:59', fin: '06:00', plage_active: true, courte: true });
  assert.equal(r.etat, 'ok');
  assert.equal(r.aucune, true);
  assert.doesNotMatch(r.message, /Charge programmée/);
});

test('Démarrage tardif : début relu et non celui demandé', () => {
  const r = attente(dem('02:10'), { ok: true, debut: '03:40', fin: '07:30', plage_active: true, tardif: true });
  assert.equal(r.etat, 'ok');
  assert.equal(r.tardif, true);
  assert.equal(r.debut, '03:40');
});

test('Trop tard : rien n\'a été écrit', () => {
  const r = attente(dem('02:10'), { ok: false, erreur: 'trop_tard' });
  assert.equal(r.code, 'trop_tard');
  assert.equal(r.incertain, false);
});

test('Programmation non suivie (processus arrêté) : où vérifier, avec début et fin', () => {
  const r = attente(dem('00:35'), { ok: false, erreur: 'non_suivie' }, { debut: '00:35', fin: '06:00' });
  assert.equal(r.etat, 'ko');
  assert.equal(r.code, 'local_non_suivie');
  assert.equal(r.message, "La dernière programmation n'a pas pu être suivie : vérifiez dans Smart Life (début 00:35, fin 06:00).");
  assert.equal(r.incertain, true);
  assert.equal(messageNonSuivie(undefined), "La dernière programmation n'a pas pu être suivie : vérifiez dans Smart Life.");
  // Résultat illisible ou demande absente : jamais d'exception, jamais « ok ».
  for (const brut of [null, undefined, 'x', 3]) assert.equal(attente(dem('00:35'), brut).etat, 'ko');
  assert.equal(attente(undefined, { ok: true, debut: '00:35', fin: '06:00', plage_active: true }).etat, 'ko');
});

test('heureManuelleDe : début et fin que le câble aurait reçus (démarrage tardif compris)', () => {
  assert.deepEqual(heureManuelleDe(dem('00:35'), '06:00', MAINTENANT), { debut: '00:35', fin: '06:00' });
  // 01:00 à Paris : le début 00:35 est passé, début = maintenant + 10 min, fin = début + 300 min.
  assert.deepEqual(heureManuelleDe(dem('00:35'), '06:00', new Date('2026-11-17T00:00:00Z')), { debut: '01:10', fin: '06:10' });
  assert.deepEqual(heureManuelleDe({ desactiver: true, fin: '06:00' }, '06:00', MAINTENANT), { debut: '05:59', fin: '06:00' });
  // Départ trop proche : les heures de la demande.
  assert.deepEqual(heureManuelleDe(dem('00:35'), '06:00', new Date('2026-11-17T06:20:00Z')), { debut: '00:35', fin: '06:00' });
});

test('resultatKo reste la source des cartes d\'échec', () => {
  assert.equal(resultatKo(dem('02:10'), 'local_attente_refusee', '06:00', MAINTENANT).incertain, false);
});
