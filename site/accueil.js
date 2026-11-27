// Logique pure de l'accueil (parcours du soir), sans DOM : testable avec Node.
// Module ES, aucune dépendance. Règles : jamais de programmation sur le % d'hier sans geste de l'utilisateur ;
// jamais de bascule silencieuse d'un moyen d'envoi vers l'autre (règle n°2 : un échec reste un échec, avec l'heure manuelle).

import { HEURE_RE, moinsUneMinute } from './service.js';
import { hm } from './calc.js';

// Entier 0..100 ou null.
export function socValide(x) {
  if (x === null || x === undefined || String(x).trim() === '') return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

// Moyen d'envoi : le pont natif (appli Android) prime ; sinon le service s'il est configuré ; sinon aucun
// (l'accueil reste le calculateur, heure à régler à la main). Dans l'appli, le service n'est pas utilisable.
export function moyenEnvoi({ pont, adresse, jeton }) {
  if (pont) return 'local';
  return adresse && jeton ? 'service' : null;
}

// Le bouton « Programmer » est actif seulement si un moyen existe, une demande est prête, la valeur de
// batterie a été confirmée par un geste et aucun envoi n'est en cours.
// dejaProgramme : le câble a déjà la plage demandée, rien à envoyer.
export function boutonActif({ moyen, demande, confirme, occupe, dejaProgramme }) {
  return !!moyen && !!demande && !!confirme && !occupe && !dejaProgramme;
}

// Lance l'envoi par le seul moyen choisi. Aucun repli : si ce moyen échoue, son résultat est rendu tel quel.
export async function programmerSelonMoyen(moyen, envoi) {
  if (moyen === 'local') return envoi.local();
  if (moyen === 'service') return envoi.service();
  return null;
}

// Pastille d'état du câble (appli seulement) : texte, ton, action proposée au toucher.
//   action : 'chercher' | 'relier' | 'reessayer' | null ; aide : phrase affichée dans le panneau.
//   Sans aide ni action (« Câble prêt », vérification, recherche), la pastille n'est pas interactive.
export function pastille(etat) {
  switch (etat) {
    case 'pret': return { texte: 'Câble prêt', ton: 'ok', action: null, aide: null };
    case 'a_relier': return { texte: 'Câble non relié : relier', ton: 'warn', action: 'relier', aide: "L'application n'est pas encore reliée au câble. Il faut saisir sa clé une fois." };
    case 'cle': return { texte: 'Clé refusée : saisir la clé', ton: 'bad', action: 'relier', aide: 'Le câble refuse la clé : elle change quand le câble est réappairé dans Smart Life. Collez la nouvelle clé depuis votre gestionnaire de mots de passe (« Relier le câble »).' };
    case 'sans_adresse': return { texte: 'Câble non localisé : chercher', ton: 'warn', action: 'chercher', aide: "L'application ne connaît pas encore l'emplacement du câble sur le Wi-Fi." };
    case 'muet': return { texte: 'Câble introuvable : chercher', ton: 'bad', action: 'chercher', aide: 'Le câble ne répond pas. Est-il branché à la prise murale ?' };
    case 'hors_wifi': return { texte: 'Hors Wi-Fi maison : réessayer', ton: 'warn', action: 'reessayer', aide: 'Connectez le téléphone au Wi-Fi de la maison, puis réessayez.' };
    case 'verification': return { texte: 'Vérification du câble…', ton: 'neutre', action: null, aide: null };
    case 'recherche': return { texte: 'Recherche du câble…', ton: 'neutre', action: null, aide: null };
    default: return { texte: 'Câble indisponible : réessayer', ton: 'bad', action: 'reessayer', aide: "L'état du câble n'a pas pu être lu." };
  }
}

// Une confirmation du % de batterie reste valable moins de 6 h et seulement le jour où elle a été donnée
// (heure locale du téléphone). Sinon, le soir suivant, on repartirait sur un % périmé.
export const VALIDITE_CONFIRMATION_MS = 6 * 3600 * 1000;
export function confirmationValable(confirmeLe, maintenant) {
  if (!Number.isFinite(confirmeLe) || !Number.isFinite(maintenant)) return false;
  const ecoule = maintenant - confirmeLe;
  if (ecoule < 0 || ecoule > VALIDITE_CONFIRMATION_MS) return false;
  const a = new Date(confirmeLe), b = new Date(maintenant);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// La confirmation survit à un rechargement de la page (changement de thème : l'activité est recréée, la WebView aussi), mais
// jamais d'un soir à l'autre : mêmes conditions de validité que ci-dessus, et le % affiché doit être celui qui a été confirmé.
// Stockage : localStorage et non sessionStorage, car une WebView recréée repart d'un sessionStorage vide.
export const CLE_CONFIRMATION = 'recharge-ds3-confirmation';
export function confirmationAEnregistrer(confirmeLe, soc) {
  return Number.isFinite(confirmeLe) && Number.isFinite(soc) ? JSON.stringify({ le: confirmeLe, soc }) : null;
}
// -> l'instant de la confirmation à reprendre, ou null (absente, illisible, périmée, autre jour, % différent).
export function confirmationRestauree(brut, maintenant, soc) {
  if (typeof brut !== 'string' || !Number.isFinite(soc)) return null;
  let o;
  try { o = JSON.parse(brut); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || o.soc !== soc || !confirmationValable(o.le, maintenant)) return null;
  return o.le;
}

// Dans l'appli, tant que le câble n'est pas relié ou localisé, le bouton ne peut rien envoyer : il ouvre
// le panneau de la pastille. Renvoie la phrase de la sous-ligne, ou null si l'envoi peut être tenté
// (câble muet, hors Wi-Fi ou en erreur : l'envoi échoue proprement, avec l'heure manuelle).
export function blocageCable(etat) {
  if (etat === 'a_relier' || etat === 'cle') return "câble à relier d'abord";
  if (etat === 'sans_adresse') return "câble à localiser d'abord";
  return null;
}

// Gestes qui confirment le % de batterie : saisie, − / +, curseur, puce récente, « Garder ».

// Recherche automatique du câble : une seule fois par chargement de page, seulement dans l'appli (pont présent)
// et seulement quand aucune adresse n'est connue. Jamais pour muet, hors Wi-Fi, clé refusée ou erreur.
export function rechercheAutomatique({ etat, dejaFaite, pont }) {
  return !!pont && !dejaFaite && etat === 'sans_adresse';
}

// Seconde lecture discrète de l'état : un câble connu qui ne répond pas au premier contact (« muet ») est relu une fois,
// quelques secondes plus tard, avant d'afficher « Câble introuvable ». Premier contact raté vu sur le vrai câble (21/11)
// et en CI (Wi-Fi qui se reconnecte). Jamais pour les autres états, jamais deux fois de suite.
export const DELAI_RELECTURE_MS = 2500;
export function relectureEtat({ etat, dejaRelu }) {
  return !dejaRelu && etat === 'muet';
}

// Recherche automatique « introuvable » trop vite pour avoir sondé le réseau (réseau pas encore prêt juste après
// l'ouverture : CI API 36 du 26/11, S14, 72 ms sans aucune connexion au câble) : relancée une fois, après DELAI_RELECTURE_MS.
// Jamais pour une recherche demandée par l'utilisateur, jamais deux fois.
export const RECHERCHE_TROP_RAPIDE_MS = 1500;
export function relanceRecherche({ auto, etat, ms, dejaRelancee }) {
  return auto === true && !dejaRelancee && etat === 'introuvable' && Number.isFinite(ms) && ms < RECHERCHE_TROP_RAPIDE_MS;
}

// Plage relue sur le câble, extraite d'un résultat « ok » de service.js : { debut, fin } (chaque champ peut manquer).
export function plageRelue(res) {
  if (!res || res.etat !== 'ok') return {};
  // Champs structurés (service.js, depuis le démarrage tardif) : le texte d'une alerte n'est plus la source.
  if (typeof res.debut === 'string' && HEURE_RE.test(res.debut)) return { debut: res.debut, fin: typeof res.fin === 'string' && HEURE_RE.test(res.fin) ? res.fin : undefined };
  const t = [res.message, res.detail].filter(Boolean).join(' ');
  const d = /(?:Début relu sur le câble : |démarrage |\()(\d\d:\d\d)/.exec(t);
  const f = /(?:Fin de la plage : |–)(\d\d:\d\d)/.exec(t);
  return { debut: d ? d[1] : undefined, fin: f ? f[1] : undefined };
}

// ---------- Plage lue sur le câble (à l'ouverture, après une recherche, après « Programmer ») ----------
// Plage connue : { debut, fin, active } (fin peut manquer), ou null. Sources :
//   - lecture de l'état (local.js etatCable, ou GET /api/etat du service) : { etat: 'pret', plage: { debut, fin, plage_active } } ;
//   - résultat « ok » d'un envoi (service.js) : relu par plageRelue.
// Aucun autre champ n'est lu : sans plage exploitable, la page n'affiche rien de plus que la pastille.
export function plageDuCable(r) {
  if (!r) return null;
  let debut, fin, active = true;
  if (r.etat === 'pret' && r.plage && typeof r.plage === 'object') {
    debut = r.plage.debut; fin = r.plage.fin;
    active = r.plage.plage_active === true ? true : r.plage.plage_active === false ? false : null; // null : inconnu
  } else if (r.etat === 'ok') {
    ({ debut, fin } = plageRelue(r));
  } else return null;
  if (typeof debut !== 'string' || !HEURE_RE.test(debut)) return null;
  return { debut, fin: typeof fin === 'string' && HEURE_RE.test(fin) ? fin : undefined, active };
}

// Plage « pas de charge » : début = fin - 1 minute (la charge de cette nuit ne peut pas démarrer).
export function plageSansCharge(plage) {
  return !!plage && !!plage.fin && plage.debut === moinsUneMinute(plage.fin);
}

// Ligne sous la pastille, ou null si la plage n'est pas connue.
export function ligneCable(plage) {
  if (!plage) return null;
  if (plage.active === false) return 'Câble : plage désactivée (' + plage.debut + (plage.fin ? ' → ' + plage.fin : '') + ')';
  if (plageSansCharge(plage)) return 'Câble réglé sur : pas de charge';
  return 'Câble réglé : ' + plage.debut + (plage.fin ? ' → ' + plage.fin : '');
}

// Le câble a-t-il déjà ce qu'on s'apprête à lui envoyer ? Alors « Programmer » n'a rien à faire (aucun envoi inutile).
// Début ET fin identiques. Jamais « déjà programmé » quand le début est passé ou imminent (contexte 'tardif') : la charge ne démarrerait
// pas si la voiture est branchée maintenant, il faut décaler le début (démarrage tardif).
export function dejaProgramme(plage, demande, contexte) {
  if (!plage || !demande || plage.active !== true) return false; // seulement une plage lue ACTIVE
  if (demande.desactiver) return plageSansCharge(plage) && (typeof demande.fin !== 'string' || plage.fin === demande.fin);
  if (contexte === 'tardif') return false;
  return typeof demande.allumage === 'string' && plage.debut === demande.allumage && typeof demande.fin === 'string' && plage.fin === demande.fin;
}

// Texte principal du bouton quand le câble a déjà la plage demandée.
export function libelleDejaProgramme(demande) {
  return demande && demande.desactiver ? 'Déjà réglé : pas de charge' : 'Déjà programmé à ' + (demande ? demande.allumage : '--:--');
}

// ---------- Quand la programmation a lieu ----------
// Contexte horaire de la demande, pour la sous-ligne du bouton :
//   'tardif'        : l'heure de début calculée est déjà passée dans la nuit en cours, ou dans moins de 10 min : le début sera
//                     décalé à maintenant + 10 min (démarrage tardif) ;
//   'cette_nuit'    : on programme en journée, pour la nuit qui vient (après la fin des heures creuses) ;
//   null            : rien à dire (ou nuit de changement d'heure : pas de prévision).
// startRel : début calculé en minutes depuis le début des heures creuses (négatif s'il précède les heures creuses).
// dep (facultatif) : heure de départ ; entre la fin des heures creuses et le départ, un début passé reste « tardif ».
export function contexteHoraire({ maintenant, hcStart, hcEnd, startRel, nuitChangement, dep }) {
  if (!(maintenant instanceof Date) || isNaN(maintenant.getTime()) || nuitChangement || !Number.isFinite(startRel)) return null;
  const s = hm(hcStart), e = hm(hcEnd);
  const rel = (x) => ((x - s) % 1440 + 1440) % 1440;
  const longueur = rel(e) || 1440;
  const seconde = maintenant.getSeconds() > 0 || maintenant.getMilliseconds() > 0 ? 1 : 0; // comme l'envoi : minute supérieure
  const t = rel(maintenant.getHours() * 60 + maintenant.getMinutes() + seconde);
  const MARGE = 10; // un début dans moins de 10 min est aussi décalé
  if (t < longueur) return startRel < t + MARGE ? 'tardif' : null; // dans les heures creuses
  // Hors heures creuses : un début avant les heures creuses (startRel < 0) peut déjà être passé ce soir (ou l'être dans moins de 10 min).
  if (startRel < 0 && t + MARGE > startRel + 1440) return 'tardif';
  // Entre la fin des heures creuses et le départ : le début (dans les heures creuses) est passé.
  if (typeof dep === 'string' && HEURE_RE.test(dep)) {
    const depRel = rel(hm(dep));
    if (depRel > longueur && t < depRel) return 'tardif';
  }
  return 'cette_nuit';
}

// Sous-ligne du bouton Programmer, par ordre de priorité.
export function sousLigneBouton({ occupe, delaiS, demande, confirme, reussi, blocage, secondaire, attente, attenteRestantMs, deja, socVide }) {
  if (attente) return sousLigneAttente(attente, attenteRestantMs);
  if (occupe) return "patientez, jusqu'à " + delaiS + " secondes";
  if (!demande) return socVide ? 'batterie à saisir' : 'saisie à corriger'; // champ vide : rien à corriger, juste à remplir
  if (!confirme) return "confirmez la batterie ci-dessus";
  if (reussi) return reussi;
  if (deja) return 'rien à envoyer';
  if (blocage) return blocage;
  return secondaire || '';
}

// Premier lancement ou données effacées : pas de « dernière valeur » à confirmer.
export const LIBELLES_SOC = {
  derniere: 'Dernière valeur, à confirmer',
  aucune: 'Entrez votre batterie',
};

// Heure du bloc principal tant que la batterie n'est pas confirmée : « d'après 38 % ».
export function mentionProvisoire(soc) {
  return Number.isFinite(soc) ? "d'après " + Math.round(soc) + " %, à confirmer" : '';
}

// Compte à rebours de la recherche : secondes entières restantes (jamais négatif), ou null sans échéance.
export function secondesRestantes(echeance, maintenant) {
  if (!Number.isFinite(echeance)) return null;
  return Math.max(0, Math.ceil((echeance - maintenant) / 1000));
}

// ---------- Attente du Wi-Fi de la maison puis du câble (appli seulement) ----------
// « Programmer » touché alors que le téléphone n'est pas encore sur le Wi-Fi de la maison, ou que le câble ne répond pas encore :
// la demande est confiée au code natif (lot E3, PiloteAttente dans le service de premier plan), qui attend le Wi-Fi puis le câble
// pendant 10 minutes au plus, lit toutes les 5 s, cherche le câble après 60 s de silence, envoie et notifie. La page n'est qu'une
// vue : elle relit l'état du natif (attenteEtat) et affiche ce qu'il rend ; balayer l'appli ou la recharger n'annule rien.
export const ATTENTE_MAX_MS = 10 * 60 * 1000;
export const ATTENTE_SONDE_MS = 2000; // relecture de l'état de l'attente auprès du natif (page visible)
export const SUIVI_PASTILLE_MS = 5000; // contrôle du Wi-Fi quand la pastille dit « Hors Wi-Fi maison »

export const LIBELLES_ATTENTE = {
  principal: 'En attente du Wi-Fi et du câble…',
  envoi: 'Envoi au câble…',
  sousLignes: {
    wifi: 'téléphone pas encore sur le Wi-Fi',
    cable: 'câble pas encore joignable',
    recherche: 'recherche du câble…',
    envoi: "l'envoi ne peut plus être annulé",
  },
  regler: 'Régler à la main',
  autoriser: 'Autorisez les notifications pour être prévenu écran éteint',
  sansNotifications: "Sans notification, l'attente continue : rouvrez l'application pour voir le résultat",
  annonce: 'En attente du Wi-Fi et du câble. Envoi automatique dès que le câble répond, au plus 10 minutes, même écran éteint.',
};

// Ligne d'état en haut de l'écran d'attente : « Programmation de 00:35 dès que le câble répond (10 min au plus) ».
export function enteteAttente(heure) {
  return 'Programmation de ' + (typeof heure === 'string' && HEURE_RE.test(heure) ? heure : '--:--') + ' dès que le câble répond (10 min au plus)';
}

// Sous-ligne selon l'étape ('wifi' | 'cable' | 'recherche' | 'envoi'), avec le temps restant (minutes entières, au moins 1) si connu.
// Toute autre valeur vraie : étape du Wi-Fi.
export function sousLigneAttente(etape, restantMs) {
  const base = LIBELLES_ATTENTE.sousLignes[etape] || LIBELLES_ATTENTE.sousLignes.wifi;
  if (etape === 'envoi' || !Number.isFinite(restantMs)) return base;
  return base + ' · encore ' + Math.max(1, Math.ceil(restantMs / 60000)) + ' min';
}

// Deux demandes identiques (mêmes champs, quel que soit l'ordre des clés) : la demande figée du natif et celle de la page.
export function memeDemande(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.desactiver === true || b.desactiver === true) return a.desactiver === true && b.desactiver === true && a.fin === b.fin;
  return a.allumage === b.allumage && a.fin === b.fin && a.duree_min === b.duree_min && a.depart === b.depart;
}

// Titre de la carte de résultat d'une attente qui n'a pas abouti, selon le code de service.js ; undefined : titre par défaut.
export function titreAttente(code) {
  switch (code) {
    case 'local_attente_annulee': return 'Programmation annulée';
    case 'local_attente_modifiee': return 'Attente annulée';
    case 'local_non_suivie': return 'Programmation non suivie';
    case 'local_attente_expiree': case 'local_attente_cable': case 'local_attente_cle': case 'local_attente_quittee': case 'local_attente_refusee':
      return 'Programmation non envoyée';
    default: return undefined;
  }
}

// Lecture de l'état de l'attente auprès du natif -> ce que la page doit faire :
//   { action: 'aucune' }                       rien en cours (ou réponse inexploitable : on relira) ;
//   { action: 'suivre', etape, restantMs }     attente ou envoi en cours ;
//   { action: 'finir', resultat, demande, heureManuelle }   terminée : afficher le résultat puis acquitter.
export function lireEtatAttente(e) {
  if (!e || e.ok !== true) return { action: 'aucune' };
  if (e.phase === 'attente' || e.phase === 'envoi') {
    return { action: 'suivre', envoi: e.phase === 'envoi', etape: e.phase === 'envoi' ? 'envoi' : e.etape, restantMs: e.phase === 'attente' ? e.restant_ms : undefined, demande: e.demande, heureManuelle: e.heureManuelle };
  }
  if (e.phase === 'terminee') return { action: 'finir', resultat: e.resultat, demande: e.demande, heureManuelle: e.heureManuelle };
  return { action: 'aucune' };
}

// Plafond de l'envoi local direct (« Programmer » alors que le câble répond déjà), au premier plan.
export const ENVOI_PLAFOND_MS = 30000;
// Un plafond est-il dépassé ? Horloge incohérente : oui (on n'attend jamais indéfiniment).
export function plafondDepasse(debut, maintenant, max) {
  if (!Number.isFinite(debut) || !Number.isFinite(maintenant)) return true;
  return maintenant < debut || maintenant - debut >= max;
}

// Que fait le bouton « Programmer » dans l'appli ? etat : état de la pastille ; surReseau : 'oui' | 'non' | 'pas_wifi' | 'inconnu'.
//   'panneau'  : câble à relier ou à localiser (pas d'adresse retenue : aucun réseau de référence), le bouton ouvre le panneau ;
//   'attendre' : le téléphone n'est pas sur le réseau de l'adresse retenue, ou il y est mais le câble connu ne répond pas (muet) ;
//   'envoyer'  : envoi normal (ses échecs restent affichés avec l'heure manuelle).
export function decisionEnvoi({ etat, surReseau }) {
  if (blocageCable(etat)) return 'panneau';
  if (surReseau === 'non' || surReseau === 'pas_wifi') return 'attendre';
  if (surReseau === 'oui' && etat === 'muet') return 'attendre';
  return 'envoyer';
}

// Suivi du Wi-Fi quand la pastille est « hors_wifi » : seulement page visible, rien en cours, pas de recherche.
export function suiviWifiActif({ etat, visible, occupe }) {
  return etat === 'hors_wifi' && !!visible && !occupe;
}
