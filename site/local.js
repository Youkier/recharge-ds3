// Mode « Local » de la page, dans l'appli Android (coque) : le câble est lu et programmé directement sur le Wi-Fi de la
// maison, sans cloud. Depuis le lot E2 (décision du 2026-11-21), le protocole local tourne dans le code natif (Kotlin) :
// ce module ne fait que demander au pont natif des opérations de haut niveau (lire, programmer, chercher) et traduire leurs
// résultats en états de la page. Il ne voit JAMAIS la clé ni l'identifiant du câble. Module ES pur : son client du pont est
// INJECTÉ (site/pont.js), il ne charge rien lui-même.
// La page ne le charge que si le pont natif est présent ; sur GitHub Pages, il n'est jamais chargé.
//
// Règles (CLAUDE.md, décisions du 2026-11-20) :
// - jamais d'échec silencieux : tout échec d'écriture rend l'heure à régler à la main (service.js, resultatKo) ;
// - un seul chemin vers « ok » : la vérification de service.js (interpreterReponse) sur le résultat relu sur le câble ;
// - lecture directe seulement si le Wi-Fi du téléphone est sur le réseau de l'adresse retenue ; jamais de recherche
//   sans demande ; rien n'est effacé ; l'adresse n'est retenue (côté natif) qu'après une lecture ou une écriture réussie ;
// - la clé reste dans le code natif : jamais lue, gardée, affichée ni journalisée ici.

import { resultatKo, interpreterReponse, messageNonSuivie } from './service.js';

export function pontPresent(g = globalThis) {
  return !!(g && g.PontLocal && typeof g.PontLocal.postMessage === 'function');
}

// Les nouvelles tentatives (seconde lecture, seconde écriture, second balayage) ne sont PAS faites ici : la page les demande
// au pont natif (reessayer: true) et OperationsCable les applique, avec la règle unique « jamais de nouvel envoi après
// une écriture » (décision du 2026-11-22, revue d'architecture n°2). Ce module ne fait que traduire les codes.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const reseau24 = (ip) => (typeof ip === 'string' && IPV4.test(ip) ? ip.split('.').slice(0, 3).join('.') : null);

// Codes dont l'état réel du câble est peut-être différent de ce qu'on croit (comme `incertain` de service.js).
const CODES_INCERTAINS = new Set(['local_delai', 'relecture_differente', 'local_format', 'local_non_suivie']);

// Code d'erreur du pont natif -> code de service.js (CAUSES). Un code inconnu (pont_muet…) reste « incertain ». Une écriture partie
// (ecrit:true) ne peut jamais être dite « rien n'a été modifié » : un code non incertain devient « incertain ».
export function codeLocal(erreur, ecrit = false) {
  const c = codeBrut(erreur);
  return ecrit === true && !CODES_INCERTAINS.has(c) ? 'local_format' : c;
}

function codeBrut(erreur) {
  switch (erreur) {
    case 'hors_ligne': case 'sans_adresse': return 'local_muet';
    case 'delai': return 'local_delai';
    case 'cle': return 'local_cle';
    case 'pas_de_cle': return 'local_pas_de_cle';
    case 'pas_wifi': return 'local_hors_wifi';
    case 'occupe': return 'local_occupe'; // le natif n'a rien lancé
    case 'relecture_differente': return 'relecture_differente';
    case 'requete_invalide': return 'requete_invalide';
    case 'trop_tard': return 'trop_tard'; // début passé et départ à 10 min ou moins : le natif n'a rien écrit
    // Attente tenue par le natif (lot E3) : rien n'a été envoyé dans ces cas.
    case 'attente_annulee': return 'local_attente_annulee';
    case 'attente_expiree': return 'local_attente_expiree';
    case 'attente_cable': return 'local_attente_cable';
    case 'attente_cle': return 'local_attente_cle';
    case 'non_suivie': return 'local_non_suivie';
    default: return 'local_format';
  }
}

// Configuration du câble : { pret:true, adresse } ou { erreur }. Seule l'adresse (non secrète) est connue de la page ; la
// clé et l'identifiant restent dans le code natif. Lue au moment de l'appel.
async function configuration(client) {
  const c = await client.cable();
  if (!c || !c.ok) return { erreur: 'local_format' };
  if (!c.configure) return { erreur: 'local_pas_de_cle' };
  return { pret: true, adresse: typeof c.adresse === 'string' ? c.adresse : null };
}

// Le téléphone est-il sur le réseau de l'adresse retenue ? 'oui' | 'non' | 'pas_wifi'.
async function surLeReseau(client, adresse) {
  const w = await client.prefixeWifi();
  if (!w || !w.ok) return 'pas_wifi';
  return reseau24(adresse) === w.prefixe ? 'oui' : 'non';
}

/**
 * Le téléphone est-il, à cet instant, sur le réseau de l'adresse retenue du câble ? Une lecture, aucun contact avec le câble.
 * -> 'oui' | 'non' | 'pas_wifi' | 'inconnu' (rien d'enregistré, pas d'adresse retenue, ou pont en erreur : pas de réseau de référence).
 */
export async function surLeReseauDeLaMaison(deps) {
  try {
    const conf = await configuration(deps.client);
    if (conf.erreur || !conf.adresse) return 'inconnu';
    return await surLeReseau(deps.client, conf.adresse);
  } catch (e) {
    return 'inconnu';
  }
}

/**
 * État du câble à l'ouverture (une seule lecture, jamais de recherche).
 * -> { etat: 'pret', plage:{debut,fin,plage_active} } | { etat: 'a_relier' } | { etat: 'sans_adresse' }
 *    | { etat: 'hors_wifi' } | { etat: 'muet' } | { etat: 'cle' } | { etat: 'erreur' }
 */
export async function etatCable(deps) {
  const { client } = deps;
  const conf = await configuration(client);
  if (conf.erreur === 'local_pas_de_cle') return { etat: 'a_relier' };
  if (conf.erreur) return { etat: 'erreur' };
  if (!conf.adresse) return { etat: 'sans_adresse' };
  const reseau = await surLeReseau(client, conf.adresse);
  if (reseau !== 'oui') return { etat: 'hors_wifi' };
  // Premier contact souvent lent ou refusé (premier essai réel, 2026-11-21) : le natif fait la seconde lecture, plus longue.
  const r = await client.lire({ ip: conf.adresse, reessayer: true }, deps.delaiLectureMs ?? 4000);
  if (r && r.ok === true) return { etat: 'pret', plage: { debut: r.debut, fin: r.fin, plage_active: r.plage_active } };
  const e = r && r.erreur;
  if (e === 'pas_de_cle') return { etat: 'a_relier' };
  if (e === 'pas_wifi') return { etat: 'hors_wifi' };
  return { etat: e === 'cle' ? 'cle' : e === 'hors_ligne' || e === 'delai' ? 'muet' : 'erreur' };
}

/**
 * Recherche du câble sur le Wi-Fi, seulement à la demande. surProgres : reçoit { etape, appareils, lectures, echeance }
 * (sans adresse) pendant la fouille du réseau.
 * -> { ok:true, plage } | { ok:false, etat: 'a_relier' | 'hors_wifi' | 'introuvable' | 'erreur' }
 */
export async function chercherCable(deps, surProgres = null) {
  const { client } = deps;
  const conf = await configuration(client);
  if (conf.erreur === 'local_pas_de_cle') return { ok: false, etat: 'a_relier' };
  if (conf.erreur) return { ok: false, etat: 'erreur' };
  const w = await client.prefixeWifi();
  if (!w || !w.ok) return { ok: false, etat: 'hors_wifi' };
  // Le natif essaie d'abord cette adresse (si elle est sur le réseau du Wi-Fi), puis fouille le /24 du Wi-Fi.
  const params = conf.adresse && reseau24(conf.adresse) === w.prefixe ? { ip: conf.adresse } : {};
  // Premier essai réel : « introuvable » puis trouvé au second passage : le natif fait le second balayage, et l'échéance
  // qu'il annonce couvre les deux.
  const res = await client.chercher({ ...params, reessayer: true }, surProgres);
  if (res && res.ok === true) {
    return { ok: true, plage: { debut: res.debut, fin: res.fin, plage_active: res.plage_active } };
  }
  const e = res && res.erreur;
  if (e === 'pas_wifi') return { ok: false, etat: 'hors_wifi' };
  if (e === 'pas_de_cle') return { ok: false, etat: 'a_relier' };
  return { ok: false, etat: e === 'introuvable' ? 'introuvable' : 'erreur' };
}

/**
 * Programme le câble (demande de service.js : { allumage, fin, duree_min, depart } ou { desactiver:true, fin }). Ne lève jamais.
 * -> même forme que service.js : { etat:'ok', message, detail?, rappel, tardif? } | resultatKo(...)
 */
export async function programmerLocal(demande, deps, finHC) {
  const ko = (code) => resultatKo(demande, code, finHC, deps && deps.maintenant ? deps.maintenant() : undefined);
  try {
    if (!demande) return ko('inattendue');
    const { client } = deps;
    const conf = await configuration(client);
    if (conf.erreur) return ko(conf.erreur);
    if (!conf.adresse) return ko('local_muet');
    const reseau = await surLeReseau(client, conf.adresse);
    if (reseau !== 'oui') return ko('local_hors_wifi');
    // Les deux seules actions du projet ; le natif les revalide.
    const action = demande.desactiver
      ? { desactiver: true, fin: demande.fin }
      : { allumage: demande.allumage, fin: demande.fin, duree_min: demande.duree_min, depart: demande.depart };
    // Le natif refait une tentative SEULEMENT si l'écriture n'est pas partie, dans un budget de 27 s (sous le plafond de
    // 30 s de la page, app.js) ; une écriture peut-être appliquée n'est jamais relancée (règle 2 : résultat incertain).
    const r = await client.programmer(action, { ip: conf.adresse, reessayer: true }, 20000);
    if (!r || r.ok !== true) return ko(codeLocal(r && r.erreur, r && r.ecrit === true));
    return interpreterReponse(demande, 200, r, finHC);
  } catch (e) {
    return ko('local_format');
  }
}

/**
 * Résultat d'une attente tenue par le natif (attenteEtat, phase « terminee ») -> même forme que programmerLocal : { etat:'ok', ... }
 * (seule la vérification de service.js, interpreterReponse, mène à « ok », sur le résultat BRUT relu sur le câble) ou resultatKo
 * avec l'heure à régler à la main. `heureManuelle` : { debut, fin } du natif, pour le message « programmation non suivie ».
 * Ne lève jamais.
 */
export function resultatAttente(demande, brut, finHC, maintenant, heureManuelle) {
  const ko = (code) => {
    const r = resultatKo(demande, code, finHC, maintenant);
    if (code === 'local_non_suivie') r.message = messageNonSuivie(heureManuelle);
    return r;
  };
  try {
    if (!demande || !brut || typeof brut !== 'object') return ko('local_non_suivie');
    if (brut.ok !== true) return ko(codeLocal(brut.erreur, brut.ecrit === true));
    return interpreterReponse(demande, 200, brut, finHC);
  } catch (e) {
    return ko('local_format');
  }
}
