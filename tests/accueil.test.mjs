// Tests de la logique de l'accueil (site/accueil.js) : sans DOM, sans réseau.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  socValide, moyenEnvoi, boutonActif,
  programmerSelonMoyen, pastille, secondesRestantes,
  confirmationValable, blocageCable, plageRelue, sousLigneBouton, rechercheAutomatique,
  decisionEnvoi, suiviWifiActif, LIBELLES_ATTENTE, ATTENTE_MAX_MS,
  plafondDepasse, ENVOI_PLAFOND_MS, sousLigneAttente, enteteAttente, memeDemande, titreAttente, lireEtatAttente,
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
    assert.equal(pastille('muet').texte, 'Câble introuvable : chercher');
    assert.equal(pastille('muet').action, 'chercher');
    assert.equal(pastille('hors_wifi').texte, 'Hors Wi-Fi maison : réessayer');
    // Constat, deux-points, verbe : ce que le toucher fait.
    assert.deepEqual(['a_relier', 'cle', 'sans_adresse'].map((e) => pastille(e).texte), ['Câble non relié : relier', 'Clé refusée : saisir la clé', 'Câble non localisé : chercher']);
    assert.equal(pastille('erreur').texte, 'Câble indisponible : réessayer');
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
    assert.equal(sousLigneBouton({ ...base, demande: null, socVide: true }), 'batterie à saisir');
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
  test('l\'attente dure 10 min au plus, tenue par le natif', () => {
    assert.equal(ATTENTE_MAX_MS, 600000);
    assert.equal(enteteAttente('00:35'), 'Programmation de 00:35 dès que le câble répond (10 min au plus)');
    assert.equal(enteteAttente(undefined), 'Programmation de --:-- dès que le câble répond (10 min au plus)');
    assert.equal(enteteAttente('25:00'), 'Programmation de --:-- dès que le câble répond (10 min au plus)');
  });
  test('suivi de la pastille : hors Wi-Fi, page visible, rien en cours', () => {
    assert.equal(suiviWifiActif({ etat: 'hors_wifi', visible: true, occupe: false }), true);
    assert.equal(suiviWifiActif({ etat: 'hors_wifi', visible: false, occupe: false }), false);
    assert.equal(suiviWifiActif({ etat: 'hors_wifi', visible: true, occupe: true }), false);
    assert.equal(suiviWifiActif({ etat: 'pret', visible: true, occupe: false }), false);
  });
  test('libellés et sous-ligne du bouton pendant attente', () => {
    assert.equal(LIBELLES_ATTENTE.principal, 'En attente du Wi-Fi et du câble…');
    assert.equal(LIBELLES_ATTENTE.regler, 'Régler à la main');
    const sl = (attente, attenteRestantMs) => sousLigneBouton({ attente, attenteRestantMs, occupe: true, delaiS: 30, demande: { allumage: '23:00' }, confirme: true });
    assert.equal(sl('wifi'), 'téléphone pas encore sur le Wi-Fi');
    assert.equal(sl('cable', 540000), 'câble pas encore joignable · encore 9 min');
    assert.equal(sl('recherche', 59000), 'recherche du câble… · encore 1 min');
    assert.equal(sl('envoi', 300000), "l'envoi ne peut plus être annulé");
    assert.equal(sl(true), 'téléphone pas encore sur le Wi-Fi');
    assert.equal(sousLigneAttente('cable', 600000), 'câble pas encore joignable · encore 10 min');
  });
  test('deux demandes identiques quel que soit l\'ordre des clés', () => {
    const d = { allumage: '00:35', fin: '06:00', duree_min: 300, depart: '07:30' };
    assert.equal(memeDemande(d, { depart: '07:30', duree_min: 300, fin: '06:00', allumage: '00:35' }), true);
    assert.equal(memeDemande(d, { ...d, duree_min: 301 }), false);
    assert.equal(memeDemande(d, { ...d, allumage: '00:36' }), false);
    assert.equal(memeDemande({ desactiver: true, fin: '06:00' }, { fin: '06:00', desactiver: true }), true);
    assert.equal(memeDemande({ desactiver: true, fin: '06:00' }, d), false);
    assert.equal(memeDemande(null, d), false);
  });
  test('lecture de l\'état du natif : suivre, finir ou rien', () => {
    assert.deepEqual(lireEtatAttente(null), { action: 'aucune' });
    assert.deepEqual(lireEtatAttente({ ok: false }), { action: 'aucune' });
    assert.deepEqual(lireEtatAttente({ ok: true, phase: 'inactive' }), { action: 'aucune' });
    const demande = { allumage: '00:35', fin: '06:00', duree_min: 300, depart: '07:30' };
    const h = { debut: '00:35', fin: '06:00' };
    assert.deepEqual(lireEtatAttente({ ok: true, phase: 'attente', etape: 'cable', restant_ms: 500000, demande, heureManuelle: h }),
      { action: 'suivre', envoi: false, etape: 'cable', restantMs: 500000, demande, heureManuelle: h });
    assert.deepEqual(lireEtatAttente({ ok: true, phase: 'envoi', etape: 'envoi', demande, heureManuelle: h }),
      { action: 'suivre', envoi: true, etape: 'envoi', restantMs: undefined, demande, heureManuelle: h });
    const resultat = { ok: false, erreur: 'non_suivie' };
    assert.deepEqual(lireEtatAttente({ ok: true, phase: 'terminee', resultat, demande, heureManuelle: h }), { action: 'finir', resultat, demande, heureManuelle: h });
  });
  test('titres des cartes d\'attente sans envoi', () => {
    assert.equal(titreAttente('local_attente_annulee'), 'Programmation annulée');
    assert.equal(titreAttente('local_non_suivie'), 'Programmation non suivie');
    for (const c of ['local_attente_expiree', 'local_attente_cable', 'local_attente_cle', 'local_attente_refusee']) assert.equal(titreAttente(c), 'Programmation non envoyée', c);
    assert.equal(titreAttente('local_delai'), undefined);
  });
  test('fins d\'attente sans envoi : carte KO avec heure manuelle', () => {
    for (const code of ['local_attente_expiree', 'local_attente_cable', 'local_attente_cle', 'local_attente_annulee', 'local_attente_quittee', 'local_attente_refusee']) {
      const r = resultatKo({ allumage: '23:15', fin: '06:00', duree_min: 300, depart: '07:30' }, code, '06:00', new Date('2026-11-16T12:00:00Z'));
      assert.equal(r.code, code);
      assert.match(r.message, /rien n.a été envoyé/);
      assert.match(r.manuel, /début 23:15, fin 06:00/);
      assert.equal(r.incertain, false);
    }
  });
  test('plafonds : envoi direct 30 s, horloge incohérente = dépassé', () => {
    assert.equal(ENVOI_PLAFOND_MS, 30000);
    assert.equal(plafondDepasse(1000, 1000 + 29999, ENVOI_PLAFOND_MS), false);
    assert.equal(plafondDepasse(1000, 1000 + 30000, ENVOI_PLAFOND_MS), true);
    assert.equal(plafondDepasse(1000, 500, ENVOI_PLAFOND_MS), true);
    assert.equal(plafondDepasse(NaN, 500, ENVOI_PLAFOND_MS), true);
  });
  test('source de la page : l\'attente est tenue par le natif, la page ne fait que la suivre', () => {
    const src = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
    // Le plafond de l'envoi direct est posé dans le même passage que l'appel au pont (aucune attente avant) et relu à la reprise.
    const deb = src.indexOf('local: function () {'), fin = src.indexOf('programmerSelonMoyen(m, envoi)');
    const local = deb > 0 && fin > deb ? src.slice(deb, fin) : null;
    assert.ok(local, 'bloc local de lancerEnvoi trouvé');
    assert.ok(local.indexOf('opCableLancer(') < local.indexOf('setTimeout(declencher, DELAI_LOCAL_MAX_MS)'));
    assert.match(src, /verifierPlafondEnvoi\(\);\s*verifierConfirmation\(\);/);
    // Plus aucune boucle d'attente dans la page : ni lecture du câble, ni recherche, ni envoi, ni clé gardée.
    for (const mort of ['tickAttente', 'lireCablePendantAttente', 'chercherPendantAttente', 'envoiApresAttente', 'attenteExpiree', 'etapeAttente',
      'lectureDue', 'quitterSiCache', 'confValable', 'preparerArrierePlan', 'lireConfigurationCable', 'notifierFin', 'oublierMemoire', 'memoriser']) {
      assert.ok(!src.includes(mort), mort + ' n\'a plus lieu d\'être dans la page');
    }
    // Les appels au câble faits par la page : envoi direct, lecture d'état, recherche demandée (opCableLancer : définition + 3).
    assert.equal((src.match(/opCableLancer\(/g) || []).length, 4);
    assert.equal((src.match(/lancerEnvoi\(/g) || []).length, 3); // définition + service/local sans attente + après le contrôle du réseau
    // « Annuler » : le natif décide ; refusé une fois l'envoi commencé, l'attente continue jusqu'au résultat.
    assert.match(src, /appelPont\("attenteAnnuler"\)\.then\(function \(r\) \{[\s\S]*?r\.annulee === true[\s\S]*?plus annulable/);
    // Le résultat du natif est acquitté après affichage ; reprise à l'ouverture et au retour de l'appli.
    assert.match(src, /appelPont\("attenteAcquitter"\)/);
    assert.match(src, /reprendreAttente\(\)\.then\(function \(\) \{ if \(!att && !busy\) majEtatCable\(\); \}\)/);
    // Décision du 2026-11-23 : plus de relecture par la page après un succès (envoi direct ou résultat de l'attente) ; seule la
    // relecture du cas « clé manquante » reste. La pastille et la plage viennent du résultat, sans connexion.
    assert.ok(!/etat === "ok"[^\n]*majEtatCable/.test(src), 'aucune relecture après un succès');
    assert.equal((src.match(/cablePretApresSucces\(res\)/g) || []).length, 3); // définition + deux appels
    assert.match(src, /local_attente_cle"\) majEtatCable\(\)/);
    const fnSucces = src.slice(src.indexOf('function cablePretApresSucces'), src.indexOf('function journal'));
    assert.match(fnSucces, /pastilleMontre\("pret"\);\s*majPlage\(plageDuCable\(res\)\)/);
    assert.ok(!fnSucces.includes('opCableLancer') && !fnSucces.includes('majEtatCable'), 'aucune connexion');
    // Durées en ms : seulement dans des lignes de journal, qui n'écrivent que si la version est « debug ».
    assert.match(src, /function journal\(o\) \{ if \(debugPont\)/);
    for (const action of ['page-prete', 'page-duree', 'page-etat', 'page-chercher']) {
      const l = src.split('\n').find((x) => x.includes('journal({ action: "' + action + '"'));
      assert.ok(l && /ms: Math\.round\(performance\.now\(\)/.test(l), action + ' porte une durée');
      assert.ok(!/(adresse|cle|trame|identifiant)\s*:/i.test(l), action + ' ne porte ni adresse ni clé');
    }
    // Une attente reprise après un rechargement n'est pas annulée par un changement de saisie.
    assert.match(src, /if \(att && !att\.reprise && !memeDemande\(d, att\.d\)\) annulerAttente\(/);
    // La page ne lit ni n'écrit jamais la clé : seules les heures partent vers le natif.
    assert.match(src, /appelPont\("attenteDebut", \{ demande: d, heureManuelle: h \}, 15000\)/);
  });
});
