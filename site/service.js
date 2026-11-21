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

// statut : r.status du calcul ('none' = aucune charge nécessaire). heure : "HH:MM" du début de charge.
// Renvoie null si la demande ne peut pas être construite (rien n'est alors envoyé).
export function choisirDemande(statut, heure) {
  if (statut === 'none') return { desactiver: true };
  if ((statut === 'ok' || statut === 'short') && typeof heure === 'string' && HEURE_RE.test(heure)) return { allumage: heure };
  return null;
}

export function libelleBouton(demande) {
  if (!demande) return null;
  return demande.desactiver
    ? { principal: 'Pas de charge ce soir', secondaire: 'plage réduite à 1 min' }
    : { principal: 'Programmer la charge', secondaire: 'démarrage ' + demande.allumage };
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
  // Échecs côté page
  hors_ligne_navigateur: { message: 'Pas de connexion internet : la demande n\'a pas été envoyée.', incertain: false },
  injoignable: { message: 'Service injoignable (réseau coupé, adresse erronée ou service arrêté).', incertain: true },
  delai_page: { message: 'Pas de réponse du service après 25 secondes.', incertain: true },
  illisible: { message: 'Réponse illisible du service.', incertain: true },
  inattendue: { message: 'Réponse inattendue du service : le réglage n\'est pas confirmé.', incertain: true },
  // Mode « Local » de l'appli Android (site/local.js) : le câble est joint directement sur le Wi-Fi de la maison.
  local_muet: { message: 'Le câble ne répond pas. Est-il branché à la prise murale ? Rien n\'a été modifié.', incertain: false },
  local_delai: { message: 'Le câble n\'a pas répondu à temps.', incertain: true },
  local_cle: { message: 'Le câble refuse la clé : elle a peut-être changé dans Smart Life. Rien n\'a été modifié.', incertain: false },
  local_hors_wifi: { message: 'Le téléphone n\'est pas sur le Wi-Fi de la maison : rien n\'a été envoyé.', incertain: false },
  // Attente du Wi-Fi (site/app.js) : rien n'a été envoyé.
  local_attente_expiree: { message: "Le téléphone n'a pas rejoint le Wi-Fi de la maison : rien n'a été envoyé.", incertain: false },
  local_attente_modifiee: { message: "La saisie a changé pendant l'attente du Wi-Fi : rien n'a été envoyé. Touchez de nouveau « Programmer la charge ».", incertain: false },
  local_attente_annulee: { message: "Vous avez annulé l'attente : rien n'a été envoyé.", incertain: false },
  local_attente_quittee: { message: "L'application a été quittée pendant l'attente du Wi-Fi : rien n'a été envoyé.", incertain: false },
  local_attente_confirmation: { message: "La batterie saisie n'est plus confirmée : rien n'a été envoyé.", incertain: false },
  local_pas_de_cle: { message: 'Le câble n\'est pas encore relié à l\'application.', incertain: false },
  local_format: { message: 'Le câble a donné une réponse inattendue : le réglage n\'est pas confirmé.', incertain: true },
};

export function resultatKo(demande, code, finHC) {
  const c = CAUSES[code] || CAUSES.inattendue;
  return {
    etat: 'ko',
    code: CAUSES[code] ? code : 'inattendue',
    message: c.message,
    manuel: consigneManuelle(demande, finHC),
    incertain: c.incertain,
    verifier: c.incertain ? 'Vérifiez dans Smart Life.' : null,
  };
}

const estHeure = (x) => typeof x === 'string' && HEURE_RE.test(x);

// status : code HTTP ; json : objet déjà décodé, ou undefined si le corps n'était pas du JSON.
// finHC (facultatif) : fin des heures creuses des Paramètres, pour signaler une fin de plage différente.
export function interpreterReponse(demande, status, json, finHC) {
  const ko = (code) => resultatKo(demande, code, finHC);
  const res = interpreterSansAvertissement(demande, status, json, ko);
  if (res.etat === 'ok' && estHeure(finHC) && estHeure(json.fin) && json.fin !== finHC) {
    res.avertissement = 'La fin de plage du câble (' + json.fin + ') ne correspond pas à la fin des heures creuses (' + finHC + ') : vérifiez dans Smart Life.';
  }
  return res;
}

function interpreterSansAvertissement(demande, status, json, ko) {
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
      return { etat: 'ok', message: 'Pas de charge cette nuit : plage réduite à une minute (' + json.debut + '–' + json.fin + '), inutile de brancher.', detail: null };
    }
    return ko('relecture_differente');
  }

  if (!demande || !estHeure(demande.allumage) || !estHeure(json.debut) || json.plage_active !== true) {
    return ko('relecture_differente');
  }
  const fin = estHeure(json.fin) ? 'Fin de la plage : ' + json.fin + '.' : null;
  if (json.immediat === true) {
    return { etat: 'ok', message: 'Démarrage immédiat : l\'heure calculée était passée.', detail: ['Début relu sur le câble : ' + json.debut + '.', fin].filter(Boolean).join(' ') };
  }
  if (json.debut !== demande.allumage) return ko('relecture_differente');
  return { etat: 'ok', message: 'Charge programmée : démarrage ' + json.debut, detail: fin };
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

// Envoie puis affiche le résultat. Ne lève jamais : si l'envoi ou l'affichage échoue, on tente
// d'afficher un KO générique avec l'heure à régler à la main (règle n°2, pas d'échec silencieux).
export async function envoyerEtAfficher(adresse, jeton, demande, afficher, deps = {}) {
  let res;
  try { res = await envoyer(adresse, jeton, demande, deps); } catch (e) { res = resultatKo(demande, 'inattendue', deps.finHC); }
  try { afficher(res); } catch (e) {
    try { afficher(resultatKo(demande, 'inattendue', deps.finHC)); } catch (e2) { /* rien de plus à faire */ }
  }
}
