// Tests de la logique de l'accueil (site/accueil.js) : sans DOM, sans réseau.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  socValide, moyenEnvoi, boutonActif,
  programmerSelonMoyen, pastille, secondesRestantes,
  confirmationValable, blocageCable, plageRelue, sousLigneBouton, rechercheAutomatique,
  decisionEnvoi, attenteExpiree, suiviWifiActif, LIBELLES_ATTENTE, ATTENTE_MAX_MS,
  etapeAttente, lectureDue, quitterSiCache, confValable, resultatNotification, heureNotification, CLE_EN_MEMOIRE_MAX_MS, suiteLecture, codeEcheance, sousLigneAttente,
} from '../site/accueil.js';
import { resultatKo } from '../site/service.js';

describe('Valeur d\'hier à confirmer', () => {
  const base = { moyen: 'service', demande: { allumage: '00:35' }, occupe: false };
  test('bouton inactif tant qu\'aucun geste n\'a confirmé la valeur', () => {
    assert.equal(boutonActif({ ...base, confirme: false }), false);
    assert.equal(boutonActif({ ...base, confirme: true }), true);
  });
  test('inactif sans moyen d\'envoi, sans demande ou pendant un envoi', () => {
    assert.equal(boutonActif({ ...base, confirme: true, moyen: null }), false);
    assert.equal(boutonActif({ ...base, confirme: true, demande: null }), false);
    assert.equal(boutonActif({ ...base, confirme: true, occupe: true }), false);
  });
  test('valeur de batterie valide : entier de 0 à 100', () => {
    assert.equal(socValide('38'), 38);
    assert.equal(socValide(' 0 '), 0);
    for (const x of ['', null, undefined, 'abc', -1, 101]) assert.equal(socValide(x), null);
  });
});

describe('Choix du moyen d\'envoi', () => {
  test('pont présent : local, même si le service est configuré', () => {
    assert.equal(moyenEnvoi({ pont: true, adresse: 'https://a.workers.dev', jeton: 'x' }), 'local');
    assert.equal(moyenEnvoi({ pont: true, adresse: null, jeton: null }), 'local');
  });
  test('sans pont : service seulement s\'il est entièrement configuré, sinon aucun bouton', () => {
    assert.equal(moyenEnvoi({ pont: false, adresse: 'https://a.workers.dev', jeton: 'x' }), 'service');
    assert.equal(moyenEnvoi({ pont: false, adresse: 'https://a.workers.dev', jeton: null }), null);
    assert.equal(moyenEnvoi({ pont: false, adresse: null, jeton: null }), null);
  });
});

describe('Pas de bascule silencieuse', () => {
  const d = { allumage: '00:35' };
  test('local en échec : le service n\'est jamais appelé, l\'échec garde l\'heure manuelle', async () => {
    let appelsService = 0;
    const res = await programmerSelonMoyen('local', {
      local: async () => resultatKo(d, 'local_muet', '06:00'),
      service: async () => { appelsService++; return { etat: 'ok' }; },
    });
    assert.equal(appelsService, 0);
    assert.equal(res.etat, 'ko');
    assert.match(res.manuel, /00:35/);
  });
  test('service en échec : le local n\'est jamais appelé', async () => {
    let appelsLocal = 0;
    const res = await programmerSelonMoyen('service', {
      service: async () => resultatKo(d, 'injoignable', '06:00'),
      local: async () => { appelsLocal++; return { etat: 'ok' }; },
    });
    assert.equal(appelsLocal, 0);
    assert.equal(res.etat, 'ko');
  });
  test('aucun moyen : rien n\'est envoyé', async () => {
    let n = 0;
    const f = async () => { n++; return { etat: 'ok' }; };
    assert.equal(await programmerSelonMoyen(null, { local: f, service: f }), null);
    assert.equal(n, 0);
  });
});

describe('Pastille d\'état du câble', () => {
  test('prêt : verte, rien à proposer', () => {
    assert.deepEqual(pastille('pret'), { texte: 'Câble prêt', ton: 'ok', action: null, aide: null });
  });
  test('états en échec : texte sans jargon et action', () => {
    assert.equal(pastille('muet').texte, 'Câble introuvable');
    assert.equal(pastille('muet').action, 'chercher');
    assert.equal(pastille('hors_wifi').texte, 'Hors Wi-Fi maison');
    assert.deepEqual(['a_relier', 'cle', 'sans_adresse'].map((e) => pastille(e).texte), ['Câble à relier', 'Clé du câble à saisir', 'Câble à localiser']);
    assert.equal(pastille('a_relier').action, 'relier');
    assert.equal(pastille('cle').action, 'relier');
    assert.equal(pastille('sans_adresse').action, 'chercher');
    assert.equal(pastille('erreur').action, 'reessayer');
    for (const e of ['muet', 'hors_wifi', 'a_relier', 'cle', 'sans_adresse', 'erreur', 'recherche']) {
      const p = pastille(e);
      assert.ok(!/\b(dp|timeout|tuya|erreur \d)/i.test(p.texte + (p.aide ?? '')), e);
    }
  });
  test('compte à rebours : entier, jamais négatif, nul sans échéance', () => {
    assert.equal(secondesRestantes(10_000, 7_500), 3);
    assert.equal(secondesRestantes(10_000, 20_000), 0);
    assert.equal(secondesRestantes(null, 0), null);
  });
});

describe('Confirmation du % périmée', () => {
  const t = (j, h, m = 0) => new Date(2026, 10, j, h, m).getTime();
  test('valable le même soir, moins de 6 h', () => {
    assert.equal(confirmationValable(t(21, 19), t(21, 19, 30)), true);
    assert.equal(confirmationValable(t(21, 18), t(21, 23, 59)), true);
  });
  test('périmée après 6 h, au jour suivant, ou sans confirmation', () => {
    assert.equal(confirmationValable(t(21, 12), t(21, 18, 1)), false);
    assert.equal(confirmationValable(t(21, 23, 30), t(22, 0, 30)), false);
    assert.equal(confirmationValable(null, t(21, 12)), false);
    assert.equal(confirmationValable(t(21, 12), t(21, 11)), false); // horloge reculée
  });
});

describe('Câble pas prêt à recevoir', () => {
  test("à relier, clé refusée, sans adresse : le bouton explique au lieu d'envoyer", () => {
    assert.equal(blocageCable('a_relier'), "câble à relier d'abord");
    assert.equal(blocageCable('cle'), "câble à relier d'abord");
    assert.equal(blocageCable('sans_adresse'), "câble à localiser d'abord");
  });
  test("muet, hors Wi-Fi, erreur, prêt : l'envoi reste tenté (échec avec heure manuelle)", () => {
    for (const e of ['muet', 'hors_wifi', 'erreur', 'pret', null]) assert.equal(blocageCable(e), null, String(e));
  });
});

describe('Pastille interactive ou non', () => {
  test('« Câble prêt » : ni aide ni action ; les états en échec ont une action', () => {
    for (const e of ['pret', 'verification', 'recherche']) { const p = pastille(e); assert.ok(!p.aide && !p.action, e); }
    for (const e of ['a_relier', 'cle', 'sans_adresse', 'muet', 'hors_wifi', 'erreur']) { const p = pastille(e); assert.ok(p.aide && p.action, e); }
  });
});

describe('Plage relue et sous-ligne du bouton', () => {
  test('plageRelue : programmation, plage courte, démarrage immédiat', () => {
    assert.deepEqual(plageRelue({ etat: 'ok', message: 'Charge programmée : démarrage 00:35', detail: 'Fin de la plage : 06:00.' }), { debut: '00:35', fin: '06:00' });
    assert.deepEqual(plageRelue({ etat: 'ok', message: 'Pas de charge cette nuit : plage réduite à une minute (05:59–06:00), inutile de brancher.', detail: null }), { debut: '05:59', fin: '06:00' });
    assert.deepEqual(plageRelue({ etat: 'ok', message: "Démarrage immédiat : l'heure calculée était passée.", detail: 'Début relu sur le câble : 00:10. Fin de la plage : 06:00.' }), { debut: '00:10', fin: '06:00' });
    assert.deepEqual(plageRelue({ etat: 'ko' }), {});
  });
  test('ordre des sous-lignes', () => {
    const base = { occupe: false, delaiS: 30, demande: { allumage: '00:35' }, confirme: true, reussi: null, blocage: null, secondaire: 'démarrage 00:35' };
    assert.equal(sousLigneBouton({ ...base, confirme: false }), 'confirmez la batterie ci-dessus');
    assert.equal(sousLigneBouton({ ...base, occupe: true }), "patientez, jusqu'à 30 secondes");
    assert.equal(sousLigneBouton({ ...base, demande: null }), 'saisie à corriger');
    assert.equal(sousLigneBouton({ ...base, reussi: 'programmé à 00:35 · relu sur le câble' }), 'programmé à 00:35 · relu sur le câble');
    assert.equal(sousLigneBouton({ ...base, blocage: "câble à relier d'abord" }), "câble à relier d'abord");
    assert.equal(sousLigneBouton(base), 'démarrage 00:35');
  });
});

describe('Recherche automatique du câble', () => {
  test('une seule fois, seulement sans adresse et avec le pont', () => {
    assert.equal(rechercheAutomatique({ etat: 'sans_adresse', dejaFaite: false, pont: true }), true);
    assert.equal(rechercheAutomatique({ etat: 'sans_adresse', dejaFaite: true, pont: true }), false);
    assert.equal(rechercheAutomatique({ etat: 'sans_adresse', dejaFaite: false, pont: false }), false);
  });
  test('jamais pour muet, hors Wi-Fi, clé refusée, erreur, à relier, prêt', () => {
    for (const e of ['muet', 'hors_wifi', 'cle', 'erreur', 'a_relier', 'pret', 'verification', null]) {
      assert.equal(rechercheAutomatique({ etat: e, dejaFaite: false, pont: true }), false, String(e));
    }
  });
});

// Source de la page : le curseur ne confirme que sur un geste (événement input), jamais au rendu.
describe('Le curseur est un geste de confirmation', () => {
  test('socRange : setConfirme(true) seulement dans le gestionnaire « input »', () => {
    const src = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
    const m = src.match(/\$\("socRange"\)\.addEventListener\("input",[\s\S]{0,400}?\}\);/);
    assert.ok(m, 'gestionnaire input du curseur trouvé');
    assert.match(m[0], /setConfirme\(true\)/);
  });
});

describe('Attente du Wi-Fi de la maison', () => {
  test('décision au toucher : panneau, attendre ou envoyer', () => {
    for (const etat of ['a_relier', 'cle', 'sans_adresse']) {
      assert.equal(decisionEnvoi({ etat, surReseau: 'non' }), 'panneau', etat);
      assert.equal(decisionEnvoi({ etat, surReseau: 'inconnu' }), 'panneau', etat);
    }
    for (const etat of ['pret', 'hors_wifi', 'muet', 'erreur']) {
      assert.equal(decisionEnvoi({ etat, surReseau: 'non' }), 'attendre', etat);
      assert.equal(decisionEnvoi({ etat, surReseau: 'pas_wifi' }), 'attendre', etat);
      assert.equal(decisionEnvoi({ etat, surReseau: 'oui' }), etat === 'muet' ? 'attendre' : 'envoyer', etat); // muet sur le Wi-Fi : on attend le câble
      assert.equal(decisionEnvoi({ etat, surReseau: 'inconnu' }), 'envoyer', etat); // l'échec propre reste affiché, avec l'heure manuelle
    }
  });
  test('attente expirée à 10 min pile ; horloge incohérente : pas d attente', () => {
    assert.equal(ATTENTE_MAX_MS, 600000);
    assert.equal(attenteExpiree(1000, 1000 + 599999), false);
    assert.equal(attenteExpiree(1000, 1000 + 600000), true);
    assert.equal(attenteExpiree(1000, 500), true);
    assert.equal(attenteExpiree(NaN, 1000), true);
  });
  test('suivi de la pastille : hors Wi-Fi, page visible, rien en cours', () => {
    assert.equal(suiviWifiActif({ etat: 'hors_wifi', visible: true, occupe: false }), true);
    assert.equal(suiviWifiActif({ etat: 'hors_wifi', visible: false, occupe: false }), false);
    assert.equal(suiviWifiActif({ etat: 'hors_wifi', visible: true, occupe: true }), false);
    assert.equal(suiviWifiActif({ etat: 'pret', visible: true, occupe: false }), false);
  });
  test('libellés et sous-ligne du bouton pendant attente', () => {
    assert.equal(LIBELLES_ATTENTE.principal, 'En attente du Wi-Fi et du câble…');
    const sl = (attente) => sousLigneBouton({ attente, occupe: true, delaiS: 30, demande: { allumage: '23:00' }, confirme: true });
    assert.equal(sl('wifi'), 'téléphone pas encore sur le Wi-Fi · au plus 10 min');
    assert.equal(sl('cable'), 'câble pas encore joignable · au plus 10 min');
    assert.equal(sl('recherche'), 'recherche du câble…');
    assert.equal(sl(true), 'téléphone pas encore sur le Wi-Fi · au plus 10 min');
    assert.equal(sousLigneAttente('cable'), 'câble pas encore joignable · au plus 10 min');
  });
  test('étape de l attente : Wi-Fi, câble, une seule recherche après 60 s de silence', () => {
    const e = (surReseau, cableDepuis, maintenant, rechercheFaite = false) => etapeAttente({ surReseau, cableDepuis, maintenant, rechercheFaite });
    for (const sr of ['non', 'pas_wifi', 'inconnu']) assert.equal(e(sr, null, 5000), 'wifi', sr);
    assert.equal(e('non', 0, 999999), 'wifi'); // Wi-Fi perdu : retour à l'étape du Wi-Fi
    assert.equal(e('oui', 1000, 1000), 'cable');
    assert.equal(e('oui', 1000, 1000 + 59999), 'cable');
    assert.equal(e('oui', 1000, 1000 + 60000), 'recherche');
    assert.equal(e('oui', 1000, 1000 + 120000, true), 'cable'); // déjà faite : on relit l'adresse
    assert.equal(e('oui', null, 1000), 'cable');
  });
  test('lecture du câble : toutes les 5 s, une suite par état', () => {
    assert.equal(lectureDue(null, 1000), true);
    assert.equal(lectureDue(1000, 1000 + 4999), false);
    assert.equal(lectureDue(1000, 1000 + 5000), true);
    assert.equal(lectureDue(5000, 1000), true);
    assert.equal(suiteLecture('pret'), 'envoyer');
    for (const x of ['cle', 'a_relier']) assert.equal(suiteLecture(x), 'relier', x);
    for (const x of ['muet', 'hors_wifi', 'erreur', 'sans_adresse', undefined]) assert.equal(suiteLecture(x), 'continuer', String(x));
  });
  test('carte KO d échéance : câble muet sur le Wi-Fi, ou téléphone jamais arrivé', () => {
    assert.equal(codeEcheance(1000), 'local_attente_cable');
    assert.equal(codeEcheance(null), 'local_attente_expiree');
    const r = resultatKo({ allumage: '23:15' }, 'local_attente_cable', '06:00');
    assert.equal(r.message, "Le câble n'a pas répondu sur le Wi-Fi de la maison : rien n'a été envoyé.");
    assert.match(r.manuel, /23:15/);
  });
  test('fins d attente sans envoi : carte KO avec heure manuelle', () => {
    for (const code of ['local_attente_expiree', 'local_attente_cable', 'local_attente_cle', 'local_attente_annulee', 'local_attente_quittee', 'local_attente_confirmation']) {
      const r = resultatKo({ allumage: '23:15' }, code, '06:00');
      assert.equal(r.code, code);
      assert.match(r.message, /rien n.a été envoyé/);
      assert.match(r.manuel, /23:15/);
      assert.equal(r.incertain, false);
    }
  });
  test('arrière-plan : la page cachée ne quitte que l attente en mode appli ouverte', () => {
    assert.equal(quitterSiCache({ cache: true, arriere: false, prepa: false }), true);
    assert.equal(quitterSiCache({ cache: true, arriere: true, prepa: false }), false);
    assert.equal(quitterSiCache({ cache: true, arriere: false, prepa: true }), false); // fenêtre système de permission
    assert.equal(quitterSiCache({ cache: false, arriere: false, prepa: false }), false);
  });
  test('configuration du câble gardée 15 min au plus, horloge cohérente', () => {
    assert.equal(CLE_EN_MEMOIRE_MAX_MS, 900000);
    assert.equal(confValable(1000, 1000 + 899999), true);
    assert.equal(confValable(1000, 1000 + 900000), false);
    assert.equal(confValable(1000, 500), false);
    assert.equal(confValable(null, 500), false);
  });
  test('notification de fin : résultat et heure', () => {
    assert.equal(resultatNotification({ code: 'local_attente_annulee' }), 'annulee');
    assert.equal(resultatNotification({ code: 'local_attente_expiree' }), 'ko');
    assert.equal(resultatNotification({ res: { etat: 'ok' } }), 'ok');
    assert.equal(resultatNotification({ res: { etat: 'ko' } }), 'ko');
    assert.equal(heureNotification({ demande: { allumage: '23:15' }, finHC: '06:00', debutRelu: '23:20' }), '23:20');
    assert.equal(heureNotification({ demande: { allumage: '23:15' }, finHC: '06:00' }), '23:15');
    assert.equal(heureNotification({ demande: { desactiver: true }, finHC: '06:00' }), '05:59');
    assert.equal(heureNotification({ demande: { desactiver: true }, finHC: '00:00' }), '23:59');
    assert.equal(heureNotification({ demande: null, finHC: 'x' }), null);
    assert.equal(LIBELLES_ATTENTE.autoriser, 'Autorisez les notifications pour être prévenu écran éteint');
    assert.equal(LIBELLES_ATTENTE.sansNotifications, "Sans notifications, gardez l'application ouverte");
  });
  test('source de la page : arrière-plan annule attente, envois comptés', () => {
    const src = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
    assert.match(src, /if \(quitterSiCache\(\{ cache: document\.hidden, arriere: a\.arriere, prepa: a\.prepa \}\)\) \{ quitterAttente\(\); return; \}/);
    assert.match(src, /if \(quitterSiCache\(\{ cache: true, arriere: att && att\.arriere, prepa: att && att\.prepa \}\)\) quitterAttente\(\);/);
    assert.match(src, /function envoiApresAttente[\s\S]*?attenteExpiree\(a\.debut, Date\.now\(\)\)[\s\S]*?lancerEnvoi\(opts\)/); // échéance revérifiée avant l'envoi
    assert.equal((src.match(/opCableLancer\(/g) || []).length, 6); // définition + envoi local, lecture, recherche (attente), majEtatCable, lancerRecherche
    assert.equal((src.match(/lancerEnvoi\(/g) || []).length, 4); // définition + service + après contrôle + après attente (avec opts) // définition + trois appels (service, après contrôle, après attente)
  });
});
