// Lot UX « A » (2026-11-22) : plage du câble affichée à l'ouverture, « Déjà programmé », contexte horaire,
// lecture de l'état par le service, textes d'échec et rappels. Sans DOM, sans réseau.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  plageDuCable, plageSansCharge, ligneCable, dejaProgramme, libelleDejaProgramme, contexteHoraire,
  sousLigneBouton, boutonActif, mentionProvisoire, LIBELLES_SOC,
} from '../site/accueil.js';
import { libelleBouton, lireEtatService, resultatKo, interpreterReponse, brancherAvant, brancherAvantTardif, RAPPEL_REPROGRAMMER } from '../site/service.js';

// Demande complète du contrat du 2026-11-22 : début, fin du plan, durée de charge, départ.
const D = { allumage: '00:35', fin: '06:00', duree_min: 325, depart: '07:30' };

const lecture = (debut, fin, plage_active = true) => ({ etat: 'pret', plage: { debut, fin, plage_active } });

describe('Plage lue sur le câble', () => {
  test('lecture d\'état (local ou service) : debut, fin, active', () => {
    assert.deepEqual(plageDuCable(lecture('00:35', '06:00')), { debut: '00:35', fin: '06:00', active: true });
    assert.deepEqual(plageDuCable(lecture('00:35', '06:00', false)), { debut: '00:35', fin: '06:00', active: false });
  });
  test('résultat « ok » d\'un envoi : relu par plageRelue', () => {
    const ok = interpreterReponse(D, 200, { ok: true, debut: '00:35', fin: '06:00', plage_active: true });
    assert.deepEqual(plageDuCable(ok), { debut: '00:35', fin: '06:00', active: true });
    // Démarrage tardif : les heures écrites et relues viennent de champs structurés, pas du texte de l'alerte.
    const tardif = interpreterReponse(D, 200, { ok: true, debut: '23:58', fin: '07:30', plage_active: true, tardif: true });
    assert.deepEqual(plageDuCable(tardif), { debut: '23:58', fin: '07:30', active: true });
    const aucune = interpreterReponse({ desactiver: true }, 200, { ok: true, debut: '05:59', fin: '06:00', plage_active: true, courte: true });
    assert.deepEqual(plageDuCable(aucune), { debut: '05:59', fin: '06:00', active: true });
  });
  test('rien d\'exploitable : null (la ligne reste masquée)', () => {
    for (const x of [null, undefined, {}, { etat: 'muet' }, { etat: 'pret' }, { etat: 'pret', plage: {} }, lecture('0:35', '06:00'), lecture(35, '06:00'), resultatKo({ allumage: '00:35' }, 'local_delai', '06:00')]) {
      assert.equal(plageDuCable(x), null);
    }
    assert.deepEqual(plageDuCable(lecture('00:35', 'n\'importe quoi')), { debut: '00:35', fin: undefined, active: true });
  });
  test('ligne sous la pastille', () => {
    assert.equal(ligneCable(plageDuCable(lecture('00:35', '06:00'))), 'Câble réglé : 00:35 → 06:00');
    assert.equal(ligneCable(plageDuCable(lecture('05:59', '06:00'))), 'Câble réglé sur : pas de charge');
    assert.equal(ligneCable(plageDuCable(lecture('23:59', '00:00'))), 'Câble réglé sur : pas de charge');
    assert.equal(ligneCable(plageDuCable(lecture('00:35', '06:00', false))), 'Câble : plage désactivée (00:35 → 06:00)');
    assert.equal(ligneCable(plageDuCable(lecture('00:35', undefined))), 'Câble réglé : 00:35');
    assert.equal(ligneCable(null), null);
    assert.equal(plageSansCharge({ debut: '05:59', fin: '06:00' }), true);
    assert.equal(plageSansCharge({ debut: '05:58', fin: '06:00' }), false);
  });
});

describe('« Déjà programmé » : aucun envoi inutile', () => {
  const plage = { debut: '00:35', fin: '06:00', active: true };
  test('même début ET même fin : déjà programmé ; autre heure, autre fin ou plage inactive : non', () => {
    assert.equal(dejaProgramme(plage, D), true);
    assert.equal(dejaProgramme(plage, { ...D, allumage: '00:40' }), false);
    assert.equal(dejaProgramme(plage, { ...D, fin: '05:30' }), false); // la fin du plan change : à réécrire
    assert.equal(dejaProgramme({ ...plage, fin: undefined }, D), false); // fin inconnue : on ne conclut pas
    assert.equal(dejaProgramme({ ...plage, active: false }, D), false);
    assert.equal(dejaProgramme(null, D), false);
    assert.equal(dejaProgramme(plage, null), false);
  });
  test('début passé ou imminent (contexte tardif) : jamais « déjà programmé », la charge ne démarrerait pas', () => {
    assert.equal(dejaProgramme(plage, D, 'tardif'), false);
    assert.equal(dejaProgramme(plage, D, 'cette_nuit'), true);
    assert.equal(dejaProgramme(plage, D, null), true);
    assert.equal(dejaProgramme({ debut: '05:59', fin: '06:00', active: true }, { desactiver: true }, 'tardif'), true); // pas de charge : inchangé
  });
  test('pas de charge : seulement si le câble est déjà sur la plage d\'une minute', () => {
    assert.equal(dejaProgramme({ debut: '05:59', fin: '06:00', active: true }, { desactiver: true, fin: '06:00' }), true);
    assert.equal(dejaProgramme({ debut: '06:59', fin: '07:00', active: true }, { desactiver: true, fin: '06:00' }), false); // autre fin : à réécrire
    assert.equal(dejaProgramme(plage, { desactiver: true }), false);
    assert.equal(dejaProgramme({ debut: '05:59', fin: '06:00', active: true }, { allumage: '05:59', fin: '06:00', duree_min: 1, depart: '07:30' }), true);
  });
  test('textes du bouton', () => {
    assert.equal(libelleDejaProgramme({ allumage: '00:35' }), 'Déjà programmé à 00:35');
    assert.equal(libelleDejaProgramme({ desactiver: true }), 'Déjà réglé : pas de charge');
  });
  test('bouton inactif et raison dite (aria-describedby sur la sous-ligne)', () => {
    const base = { moyen: 'local', demande: { allumage: '00:35' }, confirme: true, occupe: false };
    assert.equal(boutonActif({ ...base, dejaProgramme: true }), false);
    assert.equal(boutonActif({ ...base, dejaProgramme: false }), true);
    assert.equal(sousLigneBouton({ demande: base.demande, confirme: true, deja: true, secondaire: 'démarrage 00:35' }), 'rien à envoyer');
    // La batterie non confirmée passe avant : on ne dit pas « rien à envoyer » sur une valeur d'hier.
    assert.equal(sousLigneBouton({ demande: base.demande, confirme: false, deja: true }), 'confirmez la batterie ci-dessus');
    assert.equal(sousLigneBouton({ demande: base.demande, confirme: true, reussi: 'programmé à 00:35 · relu sur le câble', deja: true }), 'programmé à 00:35 · relu sur le câble');
    const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
    assert.match(html, /id="sendBtn" aria-describedby="sendSub sendHelp"/);
  });
});

describe('Contexte horaire : « pour cette nuit », « début dans 10 min »', () => {
  const c = (h, m, startRel, extra = {}) => contexteHoraire({ maintenant: new Date(2027, 0, 12, h, m, extra.s ?? 0), hcStart: '22:00', hcEnd: '06:00', startRel, ...extra });
  test('en journée (après 06:00) : pour cette nuit', () => {
    assert.equal(c(8, 15, 155), 'cette_nuit');
    assert.equal(c(21, 59, 155), 'cette_nuit');
  });
  test('dans les heures creuses : heure à venir = rien ; heure passée ou dans moins de 10 min = début décalé', () => {
    assert.equal(c(22, 30, 155), null); // début à 00:35 (155 min après 22:00), pas encore
    assert.equal(c(0, 0, 155), null);
    assert.equal(c(2, 0, 155), 'tardif'); // 02:00 = 240 min après 22:00 : 00:35 est passé
    assert.equal(c(0, 25, 155), null); // 00:25 : début dans 10 min pile, écriture normale
    assert.equal(c(0, 26, 155), 'tardif'); // 9 min
    assert.equal(c(0, 25, 155, { s: 30 }), 'tardif'); // 00:25:30 arrondi à 00:26, comme l'envoi
  });
  test('début avant les heures creuses (charge trop longue)', () => {
    assert.equal(c(19, 0, -155), 'cette_nuit'); // 19:25 pas encore passé
    assert.equal(c(20, 0, -155), 'tardif'); // 19:25 passé, avant les heures creuses
    assert.equal(c(23, 0, -155), 'tardif');
  });
  test('entre la fin des heures creuses et le départ : un début passé reste « tardif » (avec le départ)', () => {
    const d = (h, m, extra = {}) => contexteHoraire({ maintenant: new Date(2027, 0, 12, h, m), hcStart: '22:00', hcEnd: '06:00', startRel: 155, dep: '07:30', ...extra });
    assert.equal(d(6, 30), 'tardif'); // 06:30 : 00:35 est passé, départ à 07:30
    assert.equal(d(7, 29), 'tardif');
    assert.equal(d(7, 30), 'cette_nuit'); // départ atteint : c'est pour la nuit suivante
    assert.equal(d(8, 15), 'cette_nuit');
    assert.equal(c(6, 30, 155), 'cette_nuit'); // sans le départ : comme avant
  });
  test('nuit de changement d\'heure ou entrée invalide : aucune prévision', () => {
    assert.equal(c(8, 0, 155, { nuitChangement: true }), null);
    assert.equal(c(8, 0, NaN), null);
    assert.equal(contexteHoraire({ maintenant: null, hcStart: '22:00', hcEnd: '06:00', startRel: 155 }), null);
  });
  test('libellés du bouton', () => {
    assert.equal(libelleBouton({ allumage: '00:35' }).secondaire, 'démarrage 00:35');
    assert.equal(libelleBouton({ allumage: '00:35' }, 'cette_nuit').secondaire, 'démarrage 00:35 · pour cette nuit');
    assert.equal(libelleBouton({ allumage: '00:35' }, 'tardif').secondaire, 'début dans 10 min');
    assert.equal(libelleBouton({ desactiver: true }).secondaire, 'le câble ne chargera pas cette nuit');
  });
});

describe('Rappels et messages d\'échec', () => {
  test('même phrase de rappel pour le service et le mode Local (une seule source)', () => {
    const ok = interpreterReponse(D, 200, { ok: true, debut: '00:35', fin: '06:00', plage_active: true });
    assert.equal(ok.rappel, brancherAvant('00:35'));
    assert.equal(brancherAvant('00:35'), 'Branchez la voiture avant 00:35 : sinon la charge ne démarrera pas.');
    assert.equal(brancherAvantTardif('01:10'), 'Branchez la voiture avant 01:10.');
    const tardif = interpreterReponse(D, 200, { ok: true, debut: '01:10', fin: '06:00', plage_active: true, tardif: true });
    assert.equal(tardif.rappel, brancherAvantTardif('01:10'));
    assert.equal(tardif.message, 'Heure de début dépassée : charge programmée de 01:10 à 06:00.');
    const aucune = interpreterReponse({ desactiver: true }, 200, { ok: true, debut: '05:59', fin: '06:00', plage_active: true, courte: true });
    assert.equal(aucune.rappel, RAPPEL_REPROGRAMMER);
    assert.equal(aucune.aucune, true);
    assert.equal(ok.message.includes('brancher'), false); // jamais en condition préalable
  });
  test('un échec ne dit pas « Branchez la voiture » et donne toujours l\'heure à régler à la main', () => {
    for (const code of ['local_muet', 'local_delai', 'delai', 'tuya', 'relecture_differente']) {
      const r = resultatKo({ allumage: '00:35' }, code, '06:00');
      assert.equal(r.rappel, undefined);
      assert.match(r.manuel, /début 00:35/);
    }
  });
  test('résultat incertain : où vérifier', () => {
    // Instant fixé : 21:00 à Paris, avant l'heure de début (règle normale, déterministe).
    const soir = new Date('2027-01-12T20:00:00Z');
    assert.equal(resultatKo(D, 'local_delai', '06:00', soir).verifier, 'Vérifiez dans Smart Life > charge différée : début 00:35, fin 06:00, activée.');
    assert.equal(resultatKo({ allumage: '00:35' }, 'local_delai', '06:00', soir).verifier, 'Vérifiez dans Smart Life > charge différée : début 00:35, activée.'); // ancienne demande, sans fin
    assert.equal(resultatKo({ desactiver: true, fin: '06:00' }, 'relecture_differente', '06:00').verifier, 'Vérifiez dans Smart Life > charge différée : début 05:59, fin 06:00, activée.');
    assert.equal(resultatKo({ desactiver: true }, 'relecture_differente', undefined).verifier, 'Vérifiez dans Smart Life > charge différée.');
    assert.equal(resultatKo({ allumage: '00:35' }, 'local_cle', '06:00').verifier, null); // rien n'a été modifié
  });
  test('câble muet ou lent : fermer Smart Life', () => {
    assert.match(resultatKo({ allumage: '00:35' }, 'local_muet', '06:00').message, /Fermez Smart Life s'il est ouvert, puis réessayez\.$/);
    assert.match(resultatKo({ allumage: '00:35' }, 'local_delai', '06:00').message, /Fermez Smart Life s'il est ouvert, puis réessayez\.$/);
  });
});

describe('Lecture de la plage par le service (mode Worker)', () => {
  const adresse = 'https://recharge.exemple.workers.dev', jeton = 'jeton-de-test-abcdefghijklmnop';
  const rep = (status, corps) => async () => ({ status, text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)) });
  test('réponse conforme : plage', async () => {
    let appel;
    const f = async (u, o) => { appel = { u, o }; return rep(200, { ok: true, debut: '00:35', fin: '06:00', plage_active: true })(); };
    assert.deepEqual(await lireEtatService(adresse, jeton, { fetch: f, onLine: true }), lecture('00:35', '06:00'));
    assert.equal(appel.u, adresse + '/api/etat');
    assert.equal(appel.o.method, 'GET');
    assert.equal(appel.o.headers.Authorization, 'Bearer ' + jeton); // jeton dans l'en-tête seulement
    assert.equal(appel.u.includes(jeton), false);
    assert.equal(appel.o.credentials, 'omit');
  });
  test('au moindre doute : null, sans exception ni message', async () => {
    for (const f of [rep(401, { ok: false }), rep(200, 'pas du json'), rep(200, { ok: false }), rep(200, { ok: true, debut: 'x', plage_active: true }), rep(200, { ok: true, debut: '00:35' }), async () => { throw new Error('réseau'); }]) {
      assert.equal(await lireEtatService(adresse, jeton, { fetch: f, onLine: true }), null);
    }
    assert.equal(await lireEtatService(adresse, jeton, { fetch: rep(200, {}), onLine: false }), null);
    assert.equal(await lireEtatService('https://evil.example.com', jeton, { fetch: rep(200, {}), onLine: true }), null);
    assert.equal(await lireEtatService(adresse, '', { fetch: rep(200, {}), onLine: true }), null);
  });
});

describe('Premier lancement', () => {
  test('textes de la batterie', () => {
    assert.equal(LIBELLES_SOC.derniere, 'Dernière valeur, à confirmer');
    assert.equal(LIBELLES_SOC.aucune, 'Entrez votre batterie');
    assert.equal(mentionProvisoire(38), 'd\'après 38 %, à confirmer');
    assert.equal(mentionProvisoire(null), '');
  });
  test('la page ne dit plus « inchangé » ni « plage réduite à 1 min »', () => {
    for (const f of ['../site/index.html', '../site/app.js', '../site/accueil.js', '../site/service.js']) {
      const t = readFileSync(new URL(f, import.meta.url), 'utf8');
      assert.equal(/inchangé|plage réduite à 1 min|plage réduite à une minute/.test(t), false, f);
    }
  });
});
