// Logique pure du bouton « Programmer la charge » (phase 2c). Module ES, aucune dépendance,
// utilisable par la page et par Node (tests). Contrat du service : PLAN.md, phase 2a.
// Règle n°2 : jamais d'échec silencieux, jamais de faux succès. Seul un résultat
// vérifié renvoie etat « ok » ; tout le reste est « ko » avec l'heure à régler à la main.
// Le jeton n'est jamais journalisé ni placé dans une URL ou un message.

export const DELAI_MAX_MS = 25000;
export const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- Réglages saisis par l'utilisateur ---

// Adresse https://<nom>.workers.dev, sans chemin, sans port, sans identifiants.
// Une barre finale seule est tolérée et retirée.
const ADRESSE_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.workers\.dev$/i;

export function validerAdresse(saisie) {
  const s = String(saisie ?? '').trim().replace(/\/$/, '');
  if (s === '') return { ok: false, raison: 'vide' };
  if (!ADRESSE_RE.test(s)) return { ok: false, raison: 'format' };
  return { ok: true, adresse: s.toLowerCase() };
}

// Le jeton passe dans un en-tête HTTP : caractères ASCII visibles seulement, sans espace.
export function validerJeton(saisie) {
  const s = String(saisie ?? '').trim();
  if (s === '') return { ok: false, raison: 'vide' };
  if (!/^[\x21-\x7e]+$/.test(s)) return { ok: false, raison: 'format' };
  return { ok: true, jeton: s };
}

// --- Choix de la demande ---

export const DUREE_MIN_MAX = 900;
const minutesDe = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const mod24 = (x) => ((x % 1440) + 1440) % 1440;

// Demande de programmation { allumage, fin, duree_min, depart } valide : trois heures HH:MM, durée entière de 1 à 900 minutes,
// fin comprise entre l'allumage (exclu) et le départ (inclus), en heures murales, minuit compris. Même règle que le Worker et
// que la coque Android (qui la revalident : cette fonction ne sert qu'à ne rien envoyer d'invalide).
export function demandeValide(d) {
  if (!d || typeof d !== 'object') return false;
  if (![d.allumage, d.fin, d.depart].every((h) => typeof h === 'string' && HEURE_RE.test(h))) return false;
  if (!Number.isInteger(d.duree_min) || d.duree_min < 1 || d.duree_min > DUREE_MIN_MAX) return false;
  const nuit = mod24(minutesDe(d.depart) - minutesDe(d.allumage));
  const jusquaFin = mod24(minutesDe(d.fin) - minutesDe(d.allumage));
  return nuit > 0 && jusquaFin > 0 && jusquaFin <= nuit;
}

// statut : r.status du calcul ('none' = aucune charge nécessaire). heure : "HH:MM" du début de charge.
// plan : { fin: "HH:MM" fin du plan, dureeMin: durée de charge du plan (chargeMin), depart: "HH:MM" réglage de départ }.
// Renvoie null si la demande ne peut pas être construite (rien n'est alors envoyé).
export function choisirDemande(statut, heure, plan = {}) {
  if (statut === 'none') return { desactiver: true };
  if ((statut === 'ok' || statut === 'short') && typeof heure === 'string' && HEURE_RE.test(heure)) {
    const d = { allumage: heure, fin: plan.fin, duree_min: plan.dureeMin, depart: plan.depart };
    return demandeValide(d) ? d : null;
  }
  return null;
}

// Phrases communes au service et au mode Local (une seule source). La charge ne démarre PAS si la voiture est branchée après
// l'heure de début de la plage (constat de Mathieu du 2026-11-22) : on le dit à chaque programmation. Jamais en condition
// préalable : la programmation peut précéder ou suivre le branchement de la voiture.
export const brancherAvant = (h) => 'Branchez la voiture avant ' + h + ' : sinon la charge ne démarrera pas.';
export const brancherAvantTardif = (h) => 'Branchez la voiture avant ' + h + '.';
export const RAPPEL_REPROGRAMMER = 'Demain soir, reprogrammez : sinon la voiture ne chargera pas.';
const FERMER_SMART_LIFE = " Fermez Smart Life s'il est ouvert, puis réessayez.";

// contexte (facultatif) : 'tardif' (heure déjà passée ou dans moins de 10 min : le début sera décalé) | 'cette_nuit' (programmé en
// journée), voir accueil.js.
export function libelleBouton(demande, contexte) {
  if (!demande) return null;
  if (demande.desactiver) return { principal: 'Pas de charge ce soir', secondaire: 'le câble ne chargera pas cette nuit' };
  const secondaire = contexte === 'tardif' ? 'début dans 10 min'
    : 'démarrage ' + demande.allumage + (contexte === 'cette_nuit' ? ' · pour cette nuit' : '');
  return { principal: 'Programmer la charge', secondaire };
}

// "HH:MM" moins une minute (modulo 24 h), ou null si l'entrée n'est pas une heure valide.
export function moinsUneMinute(hhmm) {
  if (typeof hhmm !== 'string' || !HEURE_RE.test(hhmm)) return null;
  const m = ((Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) - 1) % 1440 + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// Ce que l'utilisateur doit faire à la main dans Smart Life si le service échoue.
// finHC : fin des heures creuses des Paramètres ("HH:MM"), pour le cas « aucune charge ».
// Ne jamais conseiller de désactiver la plage : sur ce câble, cela lance la charge immédiate.
export function consigneManuelle(demande, finHC) {
  const avant = moinsUneMinute(finHC);
  return demande && demande.desactiver
    ? 'À régler à la main dans Smart Life : début de la plage à une minute avant la fin des heures creuses' + (avant ? ' (' + avant + ')' : '') + ', ou ne branchez pas la voiture.'
    : 'À régler à la main dans Smart Life : plage de charge du câble, début ' + (demande ? demande.allumage : '--:--') + '.';
}

// --- Interprétation des réponses ---

// Cause en clair par code d'erreur. incertain : l'état réel du câble est peut-être différent de ce
// qu'on croit (écriture possible sans confirmation) : on ajoute « vérifiez dans Smart Life ».
const CAUSES = {
  non_autorise: { message: 'Jeton refusé par le service. Vérifiez le jeton dans Paramètres.', incertain: false },
  trop_de_requetes: { message: 'Trop de requêtes. Attendez quelques minutes avant de réessayer.', incertain: false },
  hors_ligne: { message: 'Le câble est hors ligne (Wi-Fi ou courant coupé).', incertain: true },
  jeton: { message: 'Le service Tuya est en erreur (accès refusé côté Tuya).', incertain: true },
  tuya: { message: 'Le service Tuya est en erreur.', incertain: true },
  delai: { message: 'Le câble n\'a pas répondu à temps.', incertain: true },
  relecture_differente: { message: 'Le câble n\'a pas la valeur demandée après l\'écriture.', incertain: true },
  requete_invalide: { message: 'Le service a refusé la demande (format invalide).', incertain: false },
  // Début déjà passé et départ à 10 min ou moins : rien n'a été écrit (message complété avec l'heure de départ dans resultatKo).
  trop_tard: { message: 'Trop tard pour charger avant le départ : rien n\'a été modifié sur le câble.', incertain: false },
  // Échecs côté page
  hors_ligne_navigateur: { message: 'Pas de connexion internet : la demande n\'a pas été envoyée.', incertain: false },
  injoignable: { message: 'Service injoignable (réseau coupé, adresse erronée ou service arrêté).', incertain: true },
  delai_page: { message: 'Pas de réponse du service après 25 secondes.', incertain: true },
  illisible: { message: 'Réponse illisible du service.', incertain: true },
  inattendue: { message: 'Réponse inattendue du service : le réglage n\'est pas confirmé.', incertain: true },
  // Mode « Local » de l'appli Android (site/local.js) : le câble est joint directement sur le Wi-Fi de la maison.
  local_muet: { message: 'Le câble ne répond pas. Est-il branché à la prise murale ? Rien n\'a été modifié.' + FERMER_SMART_LIFE, incertain: false },
  local_delai: { message: 'Le câble n\'a pas répondu à temps.' + FERMER_SMART_LIFE, incertain: true },
  local_cle: { message: 'Le câble refuse la clé : elle change quand le câble est réappairé dans Smart Life. Rien n\'a été modifié. Collez la nouvelle clé depuis votre gestionnaire de mots de passe (« Relier le câble »).', incertain: false },
  local_hors_wifi: { message: 'Le téléphone n\'est pas sur le Wi-Fi de la maison : rien n\'a été envoyé.', incertain: false },
  // Attente du Wi-Fi (site/app.js) : rien n'a été envoyé.
  local_attente_expiree: { message: "Le téléphone n'a pas rejoint le Wi-Fi de la maison : rien n'a été envoyé.", incertain: false },
  local_attente_cable: { message: "Le câble n'a pas répondu sur le Wi-Fi de la maison : rien n'a été envoyé.", incertain: false },
  local_attente_cle: { message: "Le câble n'est pas relié à l'application ou refuse la clé : rien n'a été envoyé.", incertain: false },
  local_attente_modifiee: { message: "La saisie a changé pendant l'attente du Wi-Fi : rien n'a été envoyé. Touchez de nouveau « Programmer la charge ».", incertain: false },
  local_attente_annulee: { message: "Vous avez annulé l'attente : rien n'a été envoyé.", incertain: false },
  local_attente_quittee: { message: "L'application a été quittée pendant l'attente du Wi-Fi : rien n'a été envoyé.", incertain: false },
  local_attente_confirmation: { message: "La batterie saisie n'est plus confirmée : rien n'a été envoyé.", incertain: false },
  local_occupe: { message: "Une autre opération sur le câble est en cours : rien n'a été envoyé.", incertain: false },
  local_pas_de_cle: { message: 'Le câble n\'est pas encore relié à l\'application.', incertain: false },
  local_format: { message: 'Le câble a donné une réponse inattendue : le réglage n\'est pas confirmé.', incertain: true },
};

export function resultatKo(demande, code, finHC) {
  const c = CAUSES[code] || CAUSES.inattendue;
  const tropTard = code === 'trop_tard';
  return {
    etat: 'ko',
    code: CAUSES[code] ? code : 'inattendue',
    message: tropTard && demande && estHeure(demande.depart)
      ? 'Trop tard pour charger avant le départ (' + demande.depart + ') : rien n\'a été modifié sur le câble.'
      : c.message,
    manuel: tropTard ? consigneTropTard(demande) : consigneManuelle(demande, finHC),
    incertain: c.incertain,
    verifier: c.incertain ? ouVerifier(demande, finHC) : null,
  };
}

// Trop tard : l'heure calculée est dépassée et le départ est trop proche ; l'heure à régler à la main est dite, avec le geste.
function consigneTropTard(demande) {
  return 'Heure calculée : début ' + (demande && demande.allumage ? demande.allumage : '--:--') + ', déjà passé. Pour charger quand même, démarrez la charge à la main dans Smart Life.';
}

// Où vérifier quand le résultat est incertain : l'écran et la valeur à comparer.
function ouVerifier(demande, finHC) {
  const h = demande && demande.desactiver ? moinsUneMinute(finHC) : demande && demande.allumage;
  return typeof h === 'string' && HEURE_RE.test(h)
    ? 'Vérifiez dans Smart Life > charge différée : début ' + h + ', activée.'
    : 'Vérifiez dans Smart Life > charge différée.';
}

// Minutes de charge hors heures creuses : après la fin des heures creuses (finHC) et avant le départ. Le début des heures creuses n'est
// pas connu ici : un début avant lui n'est pas compté.
export function minutesHeuresPleines(debut, fin, finHC, depart) {
  if (![debut, fin, finHC, depart].every(estHeure)) return 0;
  const duree = mod24(minutesDe(fin) - minutesDe(debut));
  const jusquaFinHC = mod24(minutesDe(finHC) - minutesDe(debut));
  const apresHC = mod24(minutesDe(debut) - minutesDe(finHC));
  const nuit = mod24(minutesDe(depart) - minutesDe(finHC)); // de la fin des heures creuses au départ
  if (nuit > 0 && apresHC < nuit) return duree; // le début est déjà après la fin des heures creuses : tout est en heures pleines
  return jusquaFinHC < duree ? duree - jusquaFinHC : 0;
}

const estHeure = (x) => typeof x === 'string' && HEURE_RE.test(x);

// status : code HTTP ; json : objet déjà décodé, ou undefined si le corps n'était pas du JSON.
// finHC (facultatif) : fin des heures creuses des Paramètres, pour dire combien de minutes d'une charge tardive tombent en heures pleines.
export function interpreterReponse(demande, status, json, finHC) {
  const ko = (code) => resultatKo(demande, code, finHC);
  return interpreter(demande, status, json, ko, finHC);
}

function interpreter(demande, status, json, ko, finHC) {
  if (json === undefined || json === null || typeof json !== 'object' || Array.isArray(json)) {
    return ko(status === 401 ? 'non_autorise' : status === 429 ? 'trop_de_requetes' : 'illisible');
  }
  if (json.ok === false) {
    if (typeof json.erreur === 'string' && Object.hasOwn(CAUSES, json.erreur)) return ko(json.erreur);
    return ko(status === 401 ? 'non_autorise' : status === 429 ? 'trop_de_requetes' : 'inattendue');
  }
  // Seul chemin vers « ok » : HTTP 200, ok === true, et valeurs relues conformes.
  if (status !== 200 || json.ok !== true) return ko('inattendue');

  if (demande && demande.desactiver) {
    // Plage courte : OK seulement si activée, marquée courte, et début = fin - 1 min (relus sur le câble).
    if (json.plage_active === true && json.courte === true && estHeure(json.debut) && estHeure(json.fin) && json.debut === moinsUneMinute(json.fin)) {
      return { etat: 'ok', message: 'Le câble ne chargera pas cette nuit (' + json.debut + '–' + json.fin + '), inutile de brancher.', detail: null, rappel: RAPPEL_REPROGRAMMER, aucune: true, debut: json.debut, fin: json.fin };
    }
    return ko('relecture_differente');
  }

  if (!demande || !estHeure(demande.allumage) || !estHeure(json.debut) || json.plage_active !== true) {
    return ko('relecture_differente');
  }
  if (!estHeure(json.fin)) return ko('relecture_differente'); // la fin est écrite et relue à chaque fois
  if (json.tardif === true) {
    // Début reporté à maintenant + 10 min : vérifié seulement qu'il tient dans la nuit demandée (début -> fin -> départ).
    const nuit = estHeure(demande.depart) ? mod24(minutesDe(demande.depart) - minutesDe(json.debut)) : 0;
    const jusquaFin = mod24(minutesDe(json.fin) - minutesDe(json.debut));
    if (!(nuit > 0 && jusquaFin > 0 && jusquaFin <= nuit)) return ko('relecture_differente');
    const hp = minutesHeuresPleines(json.debut, json.fin, finHC, demande.depart);
    return {
      etat: 'ok', tardif: true, debut: json.debut, fin: json.fin,
      message: 'Heure de début dépassée : charge programmée de ' + json.debut + ' à ' + json.fin + '.',
      detail: hp > 0 ? 'Dont ' + hp + ' min en heures pleines.' : null,
      rappel: brancherAvantTardif(json.debut),
    };
  }
  if (json.debut !== demande.allumage || json.fin !== demande.fin) return ko('relecture_differente');
  return { etat: 'ok', message: 'Charge programmée : démarrage ' + json.debut, detail: 'Fin de la plage : ' + json.fin + '.', rappel: brancherAvant(json.debut), debut: json.debut, fin: json.fin };
}

// --- Envoi ---

// deps : fetch, onLine (booléen), delaiMs (tests) ; finHC (fin des heures creuses, "HH:MM"). Ne lève jamais : renvoie toujours un résultat.
export async function envoyer(adresse, jeton, demande, deps = {}) {
  const f = deps.fetch || ((...a) => fetch(...a));
  const enLigne = deps.onLine === undefined ? (typeof navigator !== 'undefined' ? navigator.onLine : true) : deps.onLine;
  if (!demande) return resultatKo(demande, 'inattendue', deps.finHC);
  if (enLigne === false) return resultatKo(demande, 'hors_ligne_navigateur', deps.finHC);
  const a = validerAdresse(adresse), j = validerJeton(jeton);
  if (!a.ok || !j.ok) return resultatKo(demande, 'inattendue', deps.finHC); // la page empêche déjà ce cas

  const ctrl = new AbortController();
  let delaiAtteint = false;
  const minuteur = setTimeout(() => { delaiAtteint = true; ctrl.abort(); }, deps.delaiMs ?? DELAI_MAX_MS);
  try {
    const rep = await f(a.adresse + '/api/programmer', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + j.jeton, 'Content-Type': 'application/json' },
      body: JSON.stringify(demande),
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error', // une redirection devient « service injoignable »
    });
    let json;
    try { json = JSON.parse(await rep.text()); } catch (e) {
      if (delaiAtteint) return resultatKo(demande, 'delai_page', deps.finHC);
      json = undefined;
    }
    return interpreterReponse(demande, rep.status, json, deps.finHC);
  } catch (e) {
    return resultatKo(demande, delaiAtteint ? 'delai_page' : 'injoignable', deps.finHC);
  } finally {
    clearTimeout(minuteur);
  }
}

// Lecture de la plage du câble par le service (GET /api/etat), pour la ligne « Câble réglé » de l'accueil.
// Purement informatif : au moindre doute (réseau, jeton, réponse inattendue) rend null, sans message ni attente
// (décision de Mathieu du 2026-11-22). Rien n'est écrit. deps : fetch, onLine, delaiMs (tests).
// -> { etat: 'pret', plage: { debut, fin, plage_active } } ou null.
export async function lireEtatService(adresse, jeton, deps = {}) {
  const f = deps.fetch || ((...a) => fetch(...a));
  const enLigne = deps.onLine === undefined ? (typeof navigator !== 'undefined' ? navigator.onLine : true) : deps.onLine;
  const a = validerAdresse(adresse), j = validerJeton(jeton);
  if (enLigne === false || !a.ok || !j.ok) return null;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), deps.delaiMs ?? 10000);
  try {
    const rep = await f(a.adresse + '/api/etat', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + j.jeton },
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    if (rep.status !== 200) return null;
    const json = JSON.parse(await rep.text());
    if (!json || json.ok !== true || !estHeure(json.debut) || typeof json.plage_active !== 'boolean') return null;
    return { etat: 'pret', plage: { debut: json.debut, fin: estHeure(json.fin) ? json.fin : undefined, plage_active: json.plage_active } };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

// Envoie puis affiche le résultat. Ne lève jamais : si l'envoi ou l'affichage échoue, on tente
// d'afficher un KO générique avec l'heure à régler à la main (règle n°2, pas d'échec silencieux).
export async function envoyerEtAfficher(adresse, jeton, demande, afficher, deps = {}) {
  let res;
  try { res = await envoyer(adresse, jeton, demande, deps); } catch (e) { res = resultatKo(demande, 'inattendue', deps.finHC); }
  try { afficher(res); } catch (e) {
    try { afficher(resultatKo(demande, 'inattendue', deps.finHC)); } catch (e2) { /* rien de plus à faire */ }
  }
}
