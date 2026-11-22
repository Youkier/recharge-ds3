// Lot UX « A » (2026-11-22) : plage du câble affichée à l'ouverture, « Déjà programmé », contexte horaire,
// lecture de l'état par le service, textes d'échec et rappels. Sans DOM, sans réseau.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  plageDuCable, plageSansCharge, ligneCable, dejaProgramme, libelleDejaProgramme, contexteHoraire,
  sousLigneBouton, boutonActif, mentionProvisoire, LIBELLES_SOC,
} from '../site/accueil.js';
import { libelleBouton, lireEtatService, resultatKo, interpreterReponse, PENSE_BRANCHER, RAPPEL_REPROGRAMMER } from '../site/service.js';

const lecture = (debut, fin, plage_active = true) => ({ etat: 'pret', plage: { debut, fin, plage_active } });

describe('Plage lue sur le câble', () => {
  test('lecture d\'état (local ou service) : debut, fin, active', () => {
    assert.deepEqual(plageDuCable(lecture('00:35', '06:00')), { debut: '00:35', fin: '06:00', active: true });
    assert.deepEqual(plageDuCable(lecture('00:35', '06:00', false)), { debut: '00:35', fin: '06:00', active: false });
  });
  test('résultat « ok » d\'un envoi : relu par plageRelue', () => {
    const ok = interpreterReponse({ allumage: '00:35' }, 200, { ok: true, debut: '00:35', fin: '06:00', plage_active: true });
    assert.deepEqual(plageDuCable(ok), { debut: '00:35', fin: '06:00', active: true });
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
  test('même heure : déjà programmé ; autre heure ou plage inactive : non', () => {
    assert.equal(dejaProgramme(plage, { allumage: '00:35' }), true);
    assert.equal(dejaProgramme(plage, { allumage: '00:40' }), false);
    assert.equal(dejaProgramme({ ...plage, active: false }, { allumage: '00:35' }), false);
    assert.equal(dejaProgramme(null, { allumage: '00:35' }), false);
    assert.equal(dejaProgramme(plage, null), false);
  });
  test('pas de charge : seulement si le câble est déjà sur la plage d\'une minute', () => {
    assert.equal(dejaProgramme({ debut: '05:59', fin: '06:00', active: true }, { desactiver: true }), true);
    assert.equal(dejaProgramme(plage, { desactiver: true }), false);
    assert.equal(dejaProgramme({ debut: '05:59', fin: '06:00', active: true }, { allumage: '05:59' }), true);
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

describe('Contexte horaire : « pour cette nuit », « démarre tout de suite »', () => {
  const c = (h, m, startRel, extra = {}) => contexteHoraire({ maintenant: new Date(2027, 0, 12, h, m), hcStart: '22:00', hcEnd: '06:00', startRel, ...extra });
  test('en journée (après 06:00) : pour cette nuit', () => {
    assert.equal(c(8, 15, 155), 'cette_nuit');
    assert.equal(c(21, 59, 155), 'cette_nuit');
  });
  test('dans les heures creuses : heure à venir = rien ; heure passée = tout de suite', () => {
    assert.equal(c(22, 30, 155), null); // début à 00:35 (155 min après 22:00), pas encore
    assert.equal(c(0, 0, 155), null);
    assert.equal(c(2, 0, 155), 'immediat'); // 02:00 = 240 min après 22:00 : 00:35 est passé
  });
  test('début avant les heures creuses (charge trop longue)', () => {
    assert.equal(c(19, 0, -155), 'cette_nuit'); // 19:25 pas encore passé
    assert.equal(c(20, 0, -155), 'immediat'); // 19:25 passé, avant les heures creuses
    assert.equal(c(23, 0, -155), 'immediat');
  });
  test('nuit de changement d\'heure ou entrée invalide : aucune prévision', () => {
    assert.equal(c(8, 0, 155, { nuitChangement: true }), null);
    assert.equal(c(8, 0, NaN), null);
    assert.equal(contexteHoraire({ maintenant: null, hcStart: '22:00', hcEnd: '06:00', startRel: 155 }), null);
  });
  test('libellés du bouton', () => {
    assert.equal(libelleBouton({ allumage: '00:35' }).secondaire, 'démarrage 00:35');
    assert.equal(libelleBouton({ allumage: '00:35' }, 'cette_nuit').secondaire, 'démarrage 00:35 · pour cette nuit');
    assert.equal(libelleBouton({ allumage: '00:35' }, 'immediat').secondaire, 'démarre tout de suite');
    assert.equal(libelleBouton({ desactiver: true }).secondaire, 'le câble ne chargera pas cette nuit');
  });
});

describe('Rappels et messages d\'échec', () => {
  test('même phrase de rappel pour le service et le mode Local (une seule source)', () => {
    const ok = interpreterReponse({ allumage: '00:35' }, 200, { ok: true, debut: '00:35', fin: '06:00', plage_active: true });
    assert.equal(ok.rappel, PENSE_BRANCHER);
    assert.equal(PENSE_BRANCHER, 'Pensez à brancher la voiture ce soir.');
    const imm = interpreterReponse({ allumage: '00:35' }, 200, { ok: true, debut: '01:10', fin: '06:00', plage_active: true, immediat: true });
    assert.equal(imm.rappel, PENSE_BRANCHER);
    const aucune = interpreterReponse({ desactiver: true }, 200, { ok: true, debut: '05:59', fin: '06:00', plage_active: true, courte: true });
    assert.equal(aucune.rappel, RAPPEL_REPROGRAMMER);
    assert.equal(aucune.aucune, true);
    assert.equal(ok.message.includes('brancher'), false); // jamais en condition préalable
  });
  test('un échec ne dit pas « Pensez à brancher » et donne toujours l\'heure à régler à la main', () => {
    for (const code of ['local_muet', 'local_delai', 'delai', 'tuya', 'relecture_differente']) {
      const r = resultatKo({ allumage: '00:35' }, code, '06:00');
      assert.equal(r.rappel, undefined);
      assert.match(r.manuel, /début 00:35/);
    }
  });
  test('résultat incertain : où vérifier', () => {
    assert.equal(resultatKo({ allumage: '00:35' }, 'local_delai', '06:00').verifier, 'Vérifiez dans Smart Life > charge différée : début 00:35, activée.');
    assert.equal(resultatKo({ desactiver: true }, 'relecture_differente', '06:00').verifier, 'Vérifiez dans Smart Life > charge différée : début 05:59, activée.');
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
