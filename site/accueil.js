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
    case 'cle': return { texte: 'Clé refusée : saisir la clé', ton: 'bad', action: 'relier', aide: 'Le câble refuse la clé : elle a peut-être changé dans Smart Life.' };
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

// Plage relue sur le câble, extraite d'un résultat « ok » de service.js : { debut, fin } (chaque champ peut manquer).
export function plageRelue(res) {
  if (!res || res.etat !== 'ok') return {};
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
export function dejaProgramme(plage, demande) {
  if (!plage || !demande || plage.active !== true) return false; // seulement une plage lue ACTIVE
  if (demande.desactiver) return plageSansCharge(plage);
  return typeof demande.allumage === 'string' && plage.debut === demande.allumage;
}

// Texte principal du bouton quand le câble a déjà la plage demandée.
export function libelleDejaProgramme(demande) {
  return demande && demande.desactiver ? 'Déjà réglé : pas de charge' : 'Déjà programmé à ' + (demande ? demande.allumage : '--:--');
}

// ---------- Quand la programmation a lieu ----------
// Contexte horaire de la demande, pour la sous-ligne du bouton :
//   'immediat'      : l'heure de début calculée est déjà passée dans la nuit en cours (le câble démarre tout de suite) ;
//   'cette_nuit'    : on programme en journée, pour la nuit qui vient (après la fin des heures creuses) ;
//   null            : rien à dire (ou nuit de changement d'heure : pas de prévision).
// startRel : début calculé en minutes depuis le début des heures creuses (négatif s'il précède les heures creuses).
export function contexteHoraire({ maintenant, hcStart, hcEnd, startRel, nuitChangement }) {
  if (!(maintenant instanceof Date) || isNaN(maintenant.getTime()) || nuitChangement || !Number.isFinite(startRel)) return null;
  const s = hm(hcStart), e = hm(hcEnd);
  const rel = (x) => ((x - s) % 1440 + 1440) % 1440;
  const longueur = rel(e) || 1440;
  const t = rel(maintenant.getHours() * 60 + maintenant.getMinutes());
  if (t < longueur) return startRel <= t ? 'immediat' : null; // dans les heures creuses
  // Hors heures creuses : un début avant les heures creuses (startRel < 0) peut déjà être passé ce soir.
  return startRel < 0 && t >= startRel + 1440 ? 'immediat' : 'cette_nuit';
}

// Sous-ligne du bouton Programmer, par ordre de priorité.
export function sousLigneBouton({ occupe, delaiS, demande, confirme, reussi, blocage, secondaire, attente, deja }) {
  if (attente) return sousLigneAttente(attente);
  if (occupe) return "patientez, jusqu'à " + delaiS + " secondes";
  if (!demande) return 'saisie à corriger';
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
// « Programmer » touché alors que le téléphone n'est pas encore sur le Wi-Fi de la maison, ou que le câble ne répond pas
// encore : la demande est figée, puis envoyée dès que le téléphone est sur le bon réseau ET que le câble répond,
// pendant 10 minutes au plus, page au premier plan seulement.
export const ATTENTE_MAX_MS = 10 * 60 * 1000;
export const ATTENTE_SONDE_MS = 2000; // contrôle du Wi-Fi pendant l'attente
export const ATTENTE_LECTURE_MS = 5000; // lecture du câble pendant l'attente (une à la fois)
export const ATTENTE_SILENCE_MS = 60 * 1000; // câble muet à son adresse depuis ce délai : une recherche
export const SUIVI_PASTILLE_MS = 5000; // contrôle du Wi-Fi quand la pastille dit « Hors Wi-Fi maison »

export const LIBELLES_ATTENTE = {
  principal: 'En attente du Wi-Fi et du câble…',
  sousLignes: {
    wifi: 'téléphone pas encore sur le Wi-Fi · au plus 10 min',
    cable: 'câble pas encore joignable · au plus 10 min',
    recherche: 'recherche du câble…',
  },
  annuler: 'Annuler',
  autoriser: 'Autorisez les notifications pour être prévenu écran éteint',
  sansNotifications: "Sans notifications, gardez l'application ouverte",
  annonce: 'En attente du Wi-Fi et du câble. Envoi automatique dès que le câble répond, au plus 10 minutes.',
};

// Sous-ligne selon l'étape ('wifi' | 'cable' | 'recherche'). Toute autre valeur vraie : étape du Wi-Fi.
export function sousLigneAttente(etape) {
  return LIBELLES_ATTENTE.sousLignes[etape] || LIBELLES_ATTENTE.sousLignes.wifi;
}

export function attenteExpiree(debut, maintenant) {
  if (!Number.isFinite(debut) || !Number.isFinite(maintenant)) return true; // doute : on n'attend pas indéfiniment
  return maintenant - debut >= ATTENTE_MAX_MS || maintenant < debut;
}

// Étape de l'attente. surReseau : 'oui' | 'non' | 'pas_wifi' | 'inconnu' ; cableDepuis : instant où le téléphone est
// arrivé sur le réseau (null s'il n'y est pas encore) ; rechercheFaite : la recherche unique a déjà eu lieu.
//   'wifi' : le téléphone n'est pas sur le réseau de la maison ; 'cable' : on lit le câble à son adresse ;
//   'recherche' : câble muet depuis 60 s, une seule recherche.
export function etapeAttente({ surReseau, cableDepuis, maintenant, rechercheFaite }) {
  if (surReseau !== 'oui') return 'wifi';
  if (!rechercheFaite && Number.isFinite(cableDepuis) && maintenant - cableDepuis >= ATTENTE_SILENCE_MS) return 'recherche';
  return 'cable';
}

// Lecture due : jamais plus d'une toutes les 5 s (derniere : instant de la fin de la dernière lecture, ou null).
export function lectureDue(derniere, maintenant) {
  return !Number.isFinite(derniere) || maintenant - derniere >= ATTENTE_LECTURE_MS || maintenant < derniere;
}

// Suite donnée à une lecture du câble pendant l'attente : 'envoyer' (prêt), 'relier' (clé ou liaison : fin d'attente,
// panneau du câble ouvert) ou 'continuer' (muet, hors Wi-Fi, erreur : on relit).
export function suiteLecture(etat) {
  if (etat === 'pret') return 'envoyer';
  if (etat === 'a_relier' || etat === 'cle') return 'relier';
  return 'continuer';
}

// ---------- Attente en arrière-plan (appli Android : service de premier plan + notification) ----------
export const CLE_EN_MEMOIRE_MAX_MS = 15 * 60 * 1000; // la configuration du câble n'est gardée que le temps d'une attente

// La configuration lue au toucher est-elle encore utilisable ? (au plus 15 min, horloge cohérente)
export function confValable(luLe, maintenant) {
  return Number.isFinite(luLe) && Number.isFinite(maintenant) && maintenant >= luLe && maintenant - luLe < CLE_EN_MEMOIRE_MAX_MS;
}

// Plafond de l'envoi local, et de la préparation de l'attente (demande de notifications : 120 s + marge).
export const ENVOI_PLAFOND_MS = 30000;
export const PREPARATION_MAX_MS = 125000;
// Un plafond est-il dépassé ? Horloge incohérente : oui (on n'attend jamais indéfiniment).
export function plafondDepasse(debut, maintenant, max) {
  if (!Number.isFinite(debut) || !Number.isFinite(maintenant)) return true;
  return maintenant < debut || maintenant - debut >= max;
}

// Page cachée : seule l'attente en mode « appli ouverte » est quittée. Pendant la préparation (fenêtre système de
// permission) ou en arrière-plan, l'attente continue.
export function quitterSiCache({ cache, arriere, prepa }) {
  return !!cache && !arriere && !prepa;
}

// Résultat envoyé à la notification de fin : 'ok' | 'ko' | 'annulee'.
export function resultatNotification({ code, res }) {
  if (code === 'local_attente_annulee') return 'annulee';
  if (!res || res.etat !== 'ok') return 'ko';
  if (res.aucune === true) return 'aucune';     // « pas de charge cette nuit » : jamais « Charge programmée »
  if (res.immediat === true) return 'immediat'; // heure passée : « démarrage immédiat », pas « démarrage HH:MM »
  return 'ok';
}

// Heure de la notification de fin : début relu si ok, sinon heure à régler à la main (début demandé ; pour « pas de
// charge », une minute avant la fin des heures creuses). null si rien d'exploitable.
export function heureNotification({ demande, finHC, debutRelu }) {
  const H = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof debutRelu === 'string' && H.test(debutRelu)) return debutRelu;
  if (demande && typeof demande.allumage === 'string' && H.test(demande.allumage)) return demande.allumage;
  if (typeof finHC === 'string' && H.test(finHC)) {
    const [h, m] = finHC.split(':').map(Number);
    const t = (h * 60 + m + 1439) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  return null;
}

// Code de la carte KO à l'échéance : le téléphone était-il sur le Wi-Fi (cableDepuis connu) ?
export function codeEcheance(cableDepuis) {
  return Number.isFinite(cableDepuis) ? 'local_attente_cable' : 'local_attente_expiree';
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
