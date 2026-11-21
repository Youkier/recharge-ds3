// Logique pure de l'accueil (parcours du soir), sans DOM : testable avec Node.
// Module ES, aucune dépendance. Règles : jamais de programmation sur le % d'hier sans geste de l'utilisateur ;
// jamais de bascule silencieuse d'un moyen d'envoi vers l'autre (règle n°2 : un échec reste un échec, avec l'heure manuelle).

export const NB_RACCOURCIS = 3;
const MAX_HISTORIQUE = 10;

// Entier 0..100 ou null.
export function socValide(x) {
  if (x === null || x === undefined || String(x).trim() === '') return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

// Historique lu dans le stockage (texte JSON) : tableau d'entiers valides distincts, le plus récent d'abord.
export function lireHistorique(brut) {
  let a;
  try { a = JSON.parse(brut || '[]'); } catch (e) { a = []; }
  if (!Array.isArray(a)) return [];
  const vu = [];
  for (const x of a) { const v = socValide(x); if (v !== null && !vu.includes(v)) vu.push(v); }
  return vu.slice(0, MAX_HISTORIQUE);
}

// Nouvel historique avec la valeur en tête (doublon retiré). Valeur invalide : historique inchangé.
export function ajouterHistorique(historique, valeur) {
  const v = socValide(valeur);
  if (v === null) return historique.slice();
  return [v].concat(historique.filter((x) => x !== v)).slice(0, MAX_HISTORIQUE);
}

// Les n dernières valeurs distinctes, la plus récente d'abord.
export function raccourcis(historique, n = NB_RACCOURCIS) {
  const sortie = [];
  for (const x of historique) { const v = socValide(x); if (v !== null && !sortie.includes(v)) sortie.push(v); }
  return sortie.slice(0, n);
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
export function sousLigneBouton({ occupe, delaiS, demande, confirme, reussi, blocage, secondaire }) {
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
