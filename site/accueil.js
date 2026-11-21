// Logique pure de l'accueil (parcours du soir), sans DOM : testable avec Node.
// Module ES, aucune dépendance. Règles : jamais de programmation sur le % d'hier sans geste de l'utilisateur ;
// jamais de bascule silencieuse d'un moyen d'envoi vers l'autre (règle n°2 : un échec reste un échec, avec l'heure manuelle).

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
export function boutonActif({ moyen, demande, confirme, occupe }) {
  return !!moyen && !!demande && !!confirme && !occupe;
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
    case 'a_relier': return { texte: 'Câble à relier', ton: 'warn', action: 'relier', aide: "L'application n'est pas encore reliée au câble. Il faut saisir sa clé une fois." };
    case 'cle': return { texte: 'Clé du câble à saisir', ton: 'bad', action: 'relier', aide: 'Le câble refuse la clé : elle a peut-être changé dans Smart Life.' };
    case 'sans_adresse': return { texte: 'Câble à localiser', ton: 'warn', action: 'chercher', aide: "L'application ne connaît pas encore l'emplacement du câble sur le Wi-Fi." };
    case 'muet': return { texte: 'Câble introuvable', ton: 'bad', action: 'chercher', aide: 'Le câble ne répond pas. Est-il branché à la prise murale ?' };
    case 'hors_wifi': return { texte: 'Hors Wi-Fi maison', ton: 'warn', action: 'reessayer', aide: 'Connectez le téléphone au Wi-Fi de la maison, puis réessayez.' };
    case 'verification': return { texte: 'Vérification du câble…', ton: 'neutre', action: null, aide: null };
    case 'recherche': return { texte: 'Recherche du câble…', ton: 'neutre', action: null, aide: null };
    default: return { texte: 'Câble indisponible', ton: 'bad', action: 'reessayer', aide: "L'état du câble n'a pas pu être lu." };
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

// Sous-ligne du bouton Programmer, par ordre de priorité.
export function sousLigneBouton({ occupe, delaiS, demande, confirme, reussi, blocage, secondaire, attente }) {
  if (attente) return sousLigneAttente(attente);
  if (occupe) return "patientez, jusqu'à " + delaiS + " secondes";
  if (!demande) return 'saisie à corriger';
  if (!confirme) return "confirmez la batterie ci-dessus";
  if (reussi) return reussi;
  if (blocage) return blocage;
  return secondaire || '';
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
