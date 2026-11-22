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

import { resultatKo, interpreterReponse } from './service.js';

export function pontPresent(g = globalThis) {
  return !!(g && g.PontLocal && typeof g.PontLocal.postMessage === 'function');
}

// Échecs de contact avec le câble qui méritent une seconde tentative (connexion refusée, lente, ou fermée pendant la
// négociation, que le protocole lit comme « cle »). Jamais après une écriture.
const ECHECS_A_RETENTER = new Set(['hors_ligne', 'delai', 'cle']);
const BUDGET_ECRITURE_MS = 27000; // sous le plafond de 30 s de site/app.js (DELAI_LOCAL_MAX_MS)

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const reseau24 = (ip) => (typeof ip === 'string' && IPV4.test(ip) ? ip.split('.').slice(0, 3).join('.') : null);

// Code d'erreur du pont natif -> code de service.js (CAUSES). Un code inconnu (pont_muet…) reste « incertain ».
function codeLocal(erreur) {
  switch (erreur) {
    case 'hors_ligne': case 'sans_adresse': return 'local_muet';
    case 'delai': return 'local_delai';
    case 'cle': return 'local_cle';
    case 'pas_de_cle': return 'local_pas_de_cle';
    case 'pas_wifi': return 'local_hors_wifi';
    case 'occupe': return 'local_occupe'; // le natif n'a rien lancé
    case 'relecture_differente': return 'relecture_differente';
    case 'requete_invalide': return 'requete_invalide';
    default: return 'local_format';
  }
}

// Configuration du câble : { pret:true, adresse } ou { erreur }. Seule l'adresse (non secrète) est connue de la page ; la
// clé et l'identifiant restent dans le code natif. Lue au moment de l'appel, sauf si l'appelant en fournit une déjà lue
// (deps.confCable, attente en arrière-plan : le natif a gardé la configuration en mémoire, la clé du magasin étant
// illisible téléphone verrouillé). Seule l'adresse est mise à jour quand une recherche trouve le câble ailleurs.
async function configuration(client, confCable = null) {
  if (confCable && confCable.pret === true) return confCable;
  const c = await client.cable();
  if (!c || !c.ok) return { erreur: 'local_format' };
  if (!c.configure) return { erreur: 'local_pas_de_cle' };
  return { pret: true, adresse: typeof c.adresse === 'string' ? c.adresse : null };
}

// Demande au natif de garder la configuration du câble le temps d'une attente (15 min au plus, puis effacée) et rend ce
// que la page a le droit d'en savoir : { pret, adresse } ou { erreur }.
export async function lireConfigurationCable(client) {
  try {
    const m = await client.memoriser();
    if (!m || !m.ok) return { erreur: m && m.erreur === 'pas_de_cle' ? 'local_pas_de_cle' : 'local_format' };
    return await configuration(client);
  } catch (e) { return { erreur: 'local_format' }; }
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
    const conf = await configuration(deps.client, deps.confCable);
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
  const conf = await configuration(client, deps.confCable);
  if (conf.erreur === 'local_pas_de_cle') return { etat: 'a_relier' };
  if (conf.erreur) return { etat: 'erreur' };
  if (!conf.adresse) return { etat: 'sans_adresse' };
  const reseau = await surLeReseau(client, conf.adresse);
  if (reseau !== 'oui') return { etat: 'hors_wifi' };
  // Premier contact souvent lent ou refusé (constaté au premier essai réel, 2026-11-21) : une seconde lecture, plus longue.
  let r = await client.lire({ ip: conf.adresse }, deps.delaiLectureMs ?? 4000);
  if (!(r && r.ok === true) && ECHECS_A_RETENTER.has(r && r.erreur)) {
    r = await client.lire({ ip: conf.adresse }, deps.delaiSecondeLectureMs ?? 8000);
  }
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
  const conf = await configuration(client, deps.confCable);
  if (conf.erreur === 'local_pas_de_cle') return { ok: false, etat: 'a_relier' };
  if (conf.erreur) return { ok: false, etat: 'erreur' };
  const w = await client.prefixeWifi();
  if (!w || !w.ok) return { ok: false, etat: 'hors_wifi' };
  // Le natif essaie d'abord cette adresse (si elle est sur le réseau du Wi-Fi), puis fouille le /24 du Wi-Fi.
  const params = conf.adresse && reseau24(conf.adresse) === w.prefixe ? { ip: conf.adresse } : {};
  // Premier essai réel : « introuvable » puis trouvé au second passage. Un second passage automatique.
  let res = await client.chercher(params, surProgres);
  if (!(res && res.ok === true) && res && res.erreur === 'introuvable') res = await client.chercher(params, surProgres);
  if (res && res.ok === true) {
    if (deps.confCable) deps.confCable.adresse = res.ip; // la suite de l'attente lit la nouvelle adresse
    return { ok: true, plage: { debut: res.debut, fin: res.fin, plage_active: res.plage_active } };
  }
  const e = res && res.erreur;
  if (e === 'pas_wifi') return { ok: false, etat: 'hors_wifi' };
  if (e === 'pas_de_cle') return { ok: false, etat: 'a_relier' };
  return { ok: false, etat: e === 'introuvable' ? 'introuvable' : 'erreur' };
}

/**
 * Programme le câble (demande de service.js : { allumage } ou { desactiver:true }). Ne lève jamais.
 * -> même forme que service.js : { etat:'ok', message, detail?, avertissement? } | resultatKo(...)
 */
export async function programmerLocal(demande, deps, finHC) {
  const ko = (code) => resultatKo(demande, code, finHC);
  try {
    if (!demande) return ko('inattendue');
    const { client } = deps;
    const conf = await configuration(client, deps.confCable);
    if (conf.erreur) return ko(conf.erreur);
    if (!conf.adresse) return ko('local_muet');
    const reseau = await surLeReseau(client, conf.adresse);
    if (reseau !== 'oui') return ko('local_hors_wifi');
    // Les deux seules actions du projet ; le natif les revalide.
    const action = demande.desactiver ? { desactiver: true } : { allumage: demande.allumage };
    const debut = Date.now();
    let r = await client.programmer(action, { ip: conf.adresse }, 20000);
    // Une seconde tentative SEULEMENT si le natif ne signale pas d'écriture partie (pas de ecrit: true) et que l'échec
    // vient du contact avec le câble. Une écriture peut-être appliquée n'est jamais relancée (règle 2 : résultat incertain).
    // Les deux tentatives tiennent sous le plafond de 30 s de la page (app.js) : la seconde n'a que le temps restant,
    // et ne part pas s'il en reste trop peu (sinon elle pourrait écrire après l'affichage de l'échec).
    const reste = BUDGET_ECRITURE_MS - (Date.now() - debut);
    if (r && r.ok !== true && r.ecrit !== true && ECHECS_A_RETENTER.has(r.erreur) && reste >= 5000) {
      r = await client.programmer(action, { ip: conf.adresse }, reste);
    }
    if (!r || r.ok !== true) return ko(codeLocal(r && r.erreur));
    return interpreterReponse(demande, 200, r, finHC);
  } catch (e) {
    return ko('local_format');
  }
}
