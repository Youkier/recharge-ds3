// Mode « Local » de la page, dans l'appli Android (coque, lot C4) : le câble est lu et programmé directement sur le
// Wi-Fi de la maison, par le pont natif, sans cloud. Module ES pur : ses dépendances sont INJECTÉES (client du pont,
// lireEtat / programmer de local/tuya-local.js, localiserCable de local/recherche.js), il ne charge rien lui-même.
// La page ne le charge que si le pont natif est présent ; sur GitHub Pages, il n'est jamais chargé.
//
// Règles (CLAUDE.md, décisions du 2026-11-20) :
// - jamais d'échec silencieux : tout échec d'écriture rend l'heure à régler à la main (service.js, resultatKo) ;
// - un seul chemin vers « ok » : la vérification de service.js (interpreterReponse) sur le résultat relu sur le câble ;
// - lecture directe seulement si le Wi-Fi du téléphone est sur le réseau de l'adresse retenue ; jamais de recherche
//   sans demande ; rien n'est effacé ; l'adresse n'est retenue qu'après une lecture ou une écriture réussie ;
// - la clé n'est tenue que le temps de l'appel ; jamais affichée, gardée ni journalisée ici.

import { resultatKo, interpreterReponse } from './service.js';

export function pontPresent(g = globalThis) {
  return !!(g && g.PontLocal && typeof g.PontLocal.postMessage === 'function');
}

// Échecs de contact avec le câble qui méritent une seconde tentative (connexion refusée, lente, ou fermée pendant la
// négociation, que le module lit comme « cle »). Jamais après une écriture.
const ECHECS_A_RETENTER = new Set(['hors_ligne', 'delai', 'cle']);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const reseau24 = (ip) => (typeof ip === 'string' && IPV4.test(ip) ? ip.split('.').slice(0, 3).join('.') : null);

// Code d'erreur du module local -> code de service.js (CAUSES).
function codeLocal(erreur) {
  switch (erreur) {
    case 'hors_ligne': return 'local_muet';
    case 'delai': return 'local_delai';
    case 'cle': return 'local_cle';
    case 'relecture_differente': return 'relecture_differente';
    case 'requete_invalide': return 'requete_invalide';
    default: return 'local_format';
  }
}

// Configuration du câble lue au moment de l'appel : { cfg, adresse } ou { erreur }.
async function configuration(client) {
  const c = await client.cable();
  if (!c || !c.ok) return { erreur: 'local_format' };
  if (!c.configure || typeof c.cle !== 'string' || typeof c.deviceId !== 'string') return { erreur: 'local_pas_de_cle' };
  return { cfg: { deviceId: c.deviceId, cleLocale: c.cle, version: '3.5' }, adresse: typeof c.adresse === 'string' ? c.adresse : null };
}

// Le téléphone est-il sur le réseau de l'adresse retenue ? 'oui' | 'non' | 'pas_wifi'.
async function surLeReseau(client, adresse) {
  const w = await client.prefixeWifi();
  if (!w || !w.ok) return 'pas_wifi';
  return reseau24(adresse) === w.prefixe ? 'oui' : 'non';
}

/**
 * État du câble à l'ouverture (une seule lecture, jamais de recherche).
 * -> { etat: 'pret', plage:{debut,fin,plage_active} } | { etat: 'a_relier' } | { etat: 'sans_adresse' }
 *    | { etat: 'hors_wifi' } | { etat: 'muet' } | { etat: 'cle' } | { etat: 'erreur' }
 */
export async function etatCable(deps) {
  const { client, lireEtat } = deps;
  const conf = await configuration(client);
  if (conf.erreur === 'local_pas_de_cle') return { etat: 'a_relier' };
  if (conf.erreur) return { etat: 'erreur' };
  if (!conf.adresse) return { etat: 'sans_adresse' };
  const reseau = await surLeReseau(client, conf.adresse);
  if (reseau !== 'oui') return { etat: 'hors_wifi' };
  // Premier contact souvent lent ou refusé (constaté au premier essai réel, 2026-11-21) : une seconde lecture, plus longue.
  let r = await lireEtat({ ...conf.cfg, ip: conf.adresse, delaiGlobalMs: deps.delaiLectureMs ?? 4000 }, client.creerTransport());
  if (!(r && r.ok === true) && ECHECS_A_RETENTER.has(r && r.erreur)) {
    r = await lireEtat({ ...conf.cfg, ip: conf.adresse, delaiGlobalMs: deps.delaiSecondeLectureMs ?? 8000 }, client.creerTransport());
  }
  if (r && r.ok === true) {
    await client.appeler('retenirAdresse', { ip: conf.adresse });
    return { etat: 'pret', plage: { debut: r.debut, fin: r.fin, plage_active: r.plage_active } };
  }
  const e = r && r.erreur;
  return { etat: e === 'cle' ? 'cle' : e === 'hors_ligne' || e === 'delai' ? 'muet' : 'erreur' };
}

/**
 * Recherche du câble sur le Wi-Fi, seulement à la demande. surProgres : voir local/recherche.js (sans adresse).
 * -> { ok:true, plage } | { ok:false, etat: 'a_relier' | 'hors_wifi' | 'introuvable' | 'erreur' }
 */
export async function chercherCable(deps, surProgres = null) {
  const { client, localiserCable } = deps;
  const conf = await configuration(client);
  if (conf.erreur === 'local_pas_de_cle') return { ok: false, etat: 'a_relier' };
  if (conf.erreur) return { ok: false, etat: 'erreur' };
  const w = await client.prefixeWifi();
  if (!w || !w.ok) return { ok: false, etat: 'hors_wifi' };
  const departs = conf.adresse && reseau24(conf.adresse) === w.prefixe ? [conf.adresse] : [];
  const chercher = () => localiserCable({
    cfg: conf.cfg, departs, interfaces: [`${w.prefixe}.1`],
    creerTransport: client.creerTransport, sonder: client.sonder, surProgres,
  });
  // Premier essai réel : « introuvable » puis trouvé au second passage. Un second passage automatique.
  let res = await chercher();
  if (!res || res.ok !== true) res = await chercher();
  if (!res || res.ok !== true) return { ok: false, etat: 'introuvable' };
  await client.appeler('retenirAdresse', { ip: res.ip });
  return { ok: true, plage: { debut: res.etat.debut, fin: res.etat.fin, plage_active: res.etat.plage_active } };
}

/**
 * Programme le câble (demande de service.js : { allumage } ou { desactiver:true }). Ne lève jamais.
 * -> même forme que service.js : { etat:'ok', message, detail?, avertissement? } | resultatKo(...)
 */
export async function programmerLocal(demande, deps, finHC) {
  const ko = (code) => resultatKo(demande, code, finHC);
  try {
    if (!demande) return ko('inattendue');
    const { client, programmer } = deps;
    const conf = await configuration(client);
    if (conf.erreur) return ko(conf.erreur);
    if (!conf.adresse) return ko('local_muet');
    const reseau = await surLeReseau(client, conf.adresse);
    if (reseau !== 'oui') return ko('local_hors_wifi');
    let r = await programmer({ ...conf.cfg, ip: conf.adresse }, client.creerTransport(), demande);
    // Une seconde tentative SEULEMENT si le module ne signale pas d'écriture partie (pas de ecrit: true) et que l'échec
    // vient du contact avec le câble. Une écriture peut-être appliquée n'est jamais relancée (règle 2 : résultat incertain).
    if (r && r.ok !== true && r.ecrit !== true && ECHECS_A_RETENTER.has(r.erreur)) {
      r = await programmer({ ...conf.cfg, ip: conf.adresse }, client.creerTransport(), demande);
    }
    if (!r || r.ok !== true) return ko(codeLocal(r && r.erreur));
    const res = interpreterReponse(demande, 200, r, finHC);
    if (res.etat === 'ok') await client.appeler('retenirAdresse', { ip: conf.adresse });
    return res;
  } catch (e) {
    return ko('local_format');
  }
}
