// Page d'essai de la coque Android (lot C3) : « Lire l'état », « Chercher le câble » et, dans la version de mise au
// point seulement, « Programmer » et « Vérifier le filtre du pont ». Aucune modification de local/tuya-local.js ni de
// local/recherche.js : on leur fournit un transport et une sonde qui passent par le pont natif (transport-pont.js).
//
// Clé du câble : saisie dans l'écran natif, jamais ici. Elle est demandée au pont au moment de chaque action
// (op « cable »), tenue dans une variable locale le temps de l'appel, puis abandonnée : jamais dans le DOM, une URL,
// localStorage ou un journal. Après chaque action, UNE ligne « ESSAI {json} » (action, ok, erreur, debut, fin, ip) est
// écrite dans la console, que la version de mise au point relaie dans logcat : jamais de clé ni de trame.

import { lireEtat, programmer } from '../../local/tuya-local.js';
import { localiserCable, adressePrivee } from '../../local/recherche.js';
import { creerClientPont } from './transport-pont.js';

const $ = (id) => document.getElementById(id);
const BOUTONS = ['lire', 'chercher', 'cle', 'programmer', 'filtre'];

const MESSAGES = {
  pas_de_cle: 'Commencez par saisir la clé du câble.',
  pas_wifi: 'Pas de Wi-Fi : connectez le téléphone au Wi-Fi de la maison, puis recommencez.',
  adresse_invalide: 'Adresse invalide : saisissez une adresse du réseau de la maison (par exemple 192.168.1.48), ou touchez « Chercher le câble ».',
  adresse_vide: 'Aucune adresse : saisissez celle du câble, ou touchez « Chercher le câble ».',
  hors_ligne: 'Aucun câble ne répond à cette adresse. Vérifiez que le câble est branché et sur le même Wi-Fi.',
  hors_ligne_recherche: 'Aucun câble trouvé sur le Wi-Fi. Vérifiez que le câble est branché, puis fermez Smart Life s\'il est ouvert et recommencez.',
  refuse: 'L\'application refuse cette adresse : seule une adresse du réseau de la maison est permise.',
  occupe: 'L\'application est déjà en train de parler au câble : attendez quelques secondes puis recommencez.',
  cle: 'La clé n\'est pas acceptée par le câble. Ressaisissez-la. Si le problème persiste, le câble a peut-être été reconfiguré dans Smart Life.',
  delai: 'Le câble n\'a pas répondu à temps.',
  format: 'Le câble a donné une réponse inattendue : rien n\'a été modifié.',
  relecture_differente: 'Le câble n\'a pas confirmé le réglage : vérifiez la plage de charge dans Smart Life.',
  requete_invalide: 'Demande invalide.',
  pont_muet: 'L\'application ne répond pas : fermez-la puis rouvrez-la.',
  pont_absent: 'Cette page doit être ouverte dans l\'application Recharge DS 3 (pas dans un navigateur).',
};
const msg = (code) => MESSAGES[code] ?? `Échec inattendu (${code}).`;

let client = null;
let variante = 'release';

// --- Affichage ---
function etat(texte, classe = '') {
  const r = $('resultat');
  r.textContent = texte;
  r.className = `resultat ${classe}`.trim();
}
function occupe(oui) { for (const id of BOUTONS) { const b = $(id); if (b) b.disabled = oui; } }
function horloge() {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  $('horloge').textContent = `Heure du téléphone (Paris) : ${f.format(new Date())}. Si elle est fausse, la décision « démarrage immédiat » le sera aussi.`;
}
// Le seul appel de console de la page : une ligne « ESSAI {json} », sans clé ni identifiant.
function ecrireLigne(ligne) {
  console.log('ESSAI ' + JSON.stringify(ligne));
}
function journaliser(action, r, ip, mesures) {
  const ligne = { action, ok: r.ok === true, erreur: r.ok ? undefined : r.erreur, debut: r.debut, fin: r.fin, ip };
  if (r.immediat) ligne.immediat = true;
  if (r.courte) ligne.courte = true;
  if (mesures) Object.assign(ligne, mesures); // essai E0 : durées et état de l'écran, jamais de donnée du câble
  ecrireLigne(ligne);
}
const plageTexte = (r) => `de ${r.debut} à ${r.fin} (${r.plage_active ? 'activée' : 'désactivée'})`;
function principal(id) { for (const b of ['lire', 'cle']) $(b).classList.toggle('principal', b === id); }
function montrerResultat() { $('resultat').scrollIntoView({ block: 'nearest' }); }

// --- Préparation commune : clé, Wi-Fi, adresse ---
async function preparer({ adresse }) {
  const c = await client.cable();
  if (!c.ok) return { erreur: c.erreur === 'pont_muet' ? 'pont_muet' : 'pas_de_cle' };
  if (!c.configure || typeof c.cle !== 'string' || typeof c.deviceId !== 'string') return { erreur: 'pas_de_cle' };
  const w = await client.prefixeWifi();
  if (!w.ok) return { erreur: w.erreur === 'pas_wifi' ? 'pas_wifi' : (w.erreur ?? 'pas_wifi') };
  let ip = null;
  if (adresse) {
    ip = $('ip').value.trim().replace(',', '.');
    if (!ip) return { erreur: 'adresse_vide' };
    if (!adressePrivee(ip)) return { erreur: 'adresse_invalide', ip };
  }
  // La clé n'existe que dans cet objet, le temps de l'appel.
  return { cfg: { deviceId: c.deviceId, cleLocale: c.cle, version: '3.5' }, prefixe: w.prefixe, ip };
}

function erreurFinale(r, { recherche = false } = {}) {
  if (r.erreur === 'hors_ligne') {
    if (client.dernierMotif === 'pas_wifi') return 'pas_wifi';
    if (client.dernierMotif === 'refuse') return 'refuse';
    if (client.dernierMotif === 'occupe') return 'occupe';
    return recherche || r.recherche ? 'hors_ligne_recherche' : 'hors_ligne';
  }
  return r.erreur;
}

// --- Actions ---
async function actionLire() {
  const p = await preparer({ adresse: true });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, ip: p.ip, texte: msg(p.erreur) };
  etat('Lecture du câble…');
  client.dernierMotif = null;
  const r = await lireEtat({ ...p.cfg, ip: p.ip }, client.creerTransport());
  if (r.ok) return { r, ip: p.ip, texte: `Câble connecté. Charge programmée ${plageTexte(r)}.` };
  const e = erreurFinale(r);
  return { r: { ...r, erreur: e }, ip: p.ip, texte: msg(e) };
}

async function actionChercher() {
  const p = await preparer({ adresse: false });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, texte: msg(p.erreur) };
  const depart = $('ip').value.trim().replace(',', '.');
  const departs = depart && adressePrivee(depart) ? [depart] : [];
  etat(departs.length ? 'Connexion au câble…' : 'Recherche du câble sur le Wi-Fi… (jusqu\'à 30 s)');
  client.dernierMotif = null;
  const res = await localiserCable({
    cfg: p.cfg,
    departs,
    interfaces: [`${p.prefixe}.1`],
    creerTransport: client.creerTransport,
    sonder: client.sonder,
    surRecherche: () => etat('Recherche du câble sur le Wi-Fi… (jusqu\'à 30 s)'),
  });
  if (res.ok) {
    $('ip').value = res.ip;
    const nouveau = res.trouve ? ` (adresse à noter : rien n'est enregistré)` : '';
    return { r: { ...res.etat, ok: true }, ip: res.ip, texte: `Câble trouvé à ${res.ip}${nouveau}. Charge programmée ${plageTexte(res.etat)}.` };
  }
  const e = erreurFinale(res, { recherche: res.recherche === true });
  return { r: { ok: false, erreur: e }, ip: departs[0], texte: msg(e) };
}

async function actionProgrammer(heure) {
  const p = await preparer({ adresse: true });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, ip: p.ip, texte: msg(p.erreur) };
  const h = (heure ?? $('heure').value ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) return { r: { ok: false, erreur: 'requete_invalide' }, ip: p.ip, texte: 'Heure invalide : choisissez une heure au format HH:MM.' };
  etat('Programmation du câble…');
  client.dernierMotif = null;
  const r = await programmer({ ...p.cfg, ip: p.ip }, client.creerTransport(), { allumage: h });
  if (r.ok) {
    const note = r.immediat ? ' (l\'heure était déjà passée : démarrage immédiat)' : '';
    return { r, ip: p.ip, texte: `Câble programmé et relu. Charge ${plageTexte(r)}${note}.` };
  }
  const e = erreurFinale(r);
  const suite = e === 'delai' ? ' Résultat incertain : vérifiez la plage de charge dans Smart Life.' : '';
  return { r: { ...r, erreur: e }, ip: p.ip, texte: msg(e) + suite };
}

// --- Essai E0 : envoi différé en arrière-plan (version de mise au point seulement) ---
// Question : le JS de la WebView peut-il lire, écrire et relire le câble pendant que l'activité est en arrière-plan,
// écran éteint et téléphone verrouillé, si un service de premier plan `connectedDevice` garde le processus ?
// Déroulé : configuration du câble lue MAINTENANT (téléphone déverrouillé : la clé du magasin est illisible une fois
// verrouillé, setUnlockedDeviceRequired), gardée en mémoire 15 min au plus puis effacée (décision du 2026-11-21) ;
// service démarré ; ligne « arriere-plan-pret » (le script éteint alors l'écran) ; attente de `delai` secondes ; même
// programmation que « Programmer » ; service arrêté dans tous les cas.
const ATTENTE_MAX_S = 900;
let memoire = null; // { cfg, minuteur } : seule copie de la configuration pendant l'attente

function oublierMemoire() {
  if (!memoire) return;
  clearTimeout(memoire.minuteur);
  memoire.cfg = null;
  memoire = null;
}
const patienter = (ms) => new Promise((r) => setTimeout(r, ms));
const ecranTexte = (e) => (e && e.ok ? `${e.interactif ? 'allume' : 'eteint'}${e.verrouille ? '-verrouille' : ''}` : 'inconnu');

async function actionArrierePlan(params) {
  const delaiS = Number.isInteger(params.delai) ? Math.min(Math.max(params.delai, 0), ATTENTE_MAX_S) : 20;
  const h = (params.heure ?? '').trim();
  const ip = $('ip').value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h) || !adressePrivee(ip)) {
    return { r: { ok: false, erreur: 'requete_invalide' }, ip, texte: msg('requete_invalide') };
  }
  oublierMemoire();
  const c = await client.cable();
  if (!c.ok || !c.configure || typeof c.cle !== 'string' || typeof c.deviceId !== 'string') {
    const e = await client.appeler('essaiArrierePlan', { quoi: 'etat' });
    ecrireLigne({ action: 'arriere-plan-pret', ok: false, erreur: 'pas_de_cle', ecran: ecranTexte(e) });
    return { r: { ok: false, erreur: 'pas_de_cle' }, ip, texte: msg('pas_de_cle') };
  }
  memoire = { cfg: { deviceId: c.deviceId, cleLocale: c.cle, version: '3.5' }, minuteur: setTimeout(oublierMemoire, ATTENTE_MAX_S * 1000) };
  const d = await client.appeler('essaiArrierePlan', { quoi: 'debut' });
  ecrireLigne({ action: 'arriere-plan-pret', ok: d.ok === true, erreur: d.ok ? undefined : d.erreur, ecran: ecranTexte(d), delai_s: delaiS });
  if (!d.ok) {
    oublierMemoire();
    return { r: { ok: false, erreur: d.erreur ?? 'service' }, ip, texte: 'Le service d\'attente n\'a pas démarré.' };
  }
  etat(`Attente de ${delaiS} s, puis programmation du câble…`);
  try {
    const t0 = Date.now();
    await patienter(delaiS * 1000);
    const retard = Date.now() - t0 - delaiS * 1000; // retard du minuteur : mesure de la mise en sommeil de la page
    const e = await client.appeler('essaiArrierePlan', { quoi: 'etat' });
    const mesures = { ecran: ecranTexte(e), visibilite: document.visibilityState, retard_ms: retard };
    if (!memoire) return { r: { ok: false, erreur: 'memoire_effacee' }, ip, texte: 'Attente trop longue : configuration effacée.', mesures };
    const debut = Date.now();
    client.dernierMotif = null;
    const r = await programmer({ ...memoire.cfg, ip }, client.creerTransport(), { allumage: h });
    mesures.duree_ms = Date.now() - debut; // lecture + écriture + relecture
    if (r.ok) return { r, ip, texte: `Câble programmé et relu en arrière-plan. Charge ${plageTexte(r)}.`, mesures };
    const err = erreurFinale(r);
    return { r: { ...r, erreur: err }, ip, texte: msg(err), mesures };
  } finally {
    oublierMemoire();
    await client.appeler('essaiArrierePlan', { quoi: 'fin' });
  }
}

// Vérifie que le pont natif refuse ce qu'il doit refuser, sans qu'aucun octet ne parte, et que sw.js est en 404.
async function actionFiltre() {
  const essais = [
    ['port6669', 'ouvrir', { ip: '10.0.2.2', port: 6669, delai: 1000 }],
    ['loopback', 'ouvrir', { ip: '127.0.0.1', port: 6668, delai: 1000 }],
    ['zeroDeTete', 'ouvrir', { ip: '010.0.0.1', port: 6668, delai: 1000 }],
    ['publique', 'ouvrir', { ip: '8.8.8.8', port: 6668, delai: 1000 }],
    ['sondeLoopback', 'sonder', { ip: '127.0.0.1', delai: 400 }],
    ['sondeLienLocal', 'sonder', { ip: '169.254.1.1', delai: 400 }],
  ];
  const echecs = [];
  for (const [nom, op, params] of essais) {
    const r = await client.appeler(op, params, params.delai);
    if (r.ok || r.erreur !== 'refuse') { echecs.push(nom); if (r.ok && r.cx) await client.appeler('fermer', { cx: r.cx }); }
  }
  try {
    const sw = await fetch('../../site/sw.js', { cache: 'no-store' });
    if (sw.status !== 404) echecs.push(`sw.js:${sw.status}`);
  } catch { echecs.push('sw.js:erreur'); }
  const ok = echecs.length === 0;
  return { r: { ok, erreur: ok ? undefined : `filtre:${echecs.join(',')}` }, texte: ok ? 'Filtre du pont conforme : tout ce qui devait être refusé l\'est, sw.js est en 404.' : `Filtre non conforme : ${echecs.join(', ')}.` };
}

async function lancer(action, params = {}) {
  if (!client) return;
  occupe(true);
  try {
    let res;
    if (action === 'lire') res = await actionLire();
    else if (action === 'chercher') res = await actionChercher();
    else if (action === 'programmer' && variante === 'debug') res = await actionProgrammer(params.heure);
    else if (action === 'filtre' && variante === 'debug') res = await actionFiltre();
    else if (action === 'arriere-plan' && variante === 'debug') res = await actionArrierePlan(params);
    else return;
    etat(res.texte, res.r.ok ? 'ok' : 'ko');
    principal(res.r.erreur === 'cle' || res.r.erreur === 'pas_de_cle' ? 'cle' : 'lire');
    // Adresse retenue par le téléphone seulement après une lecture ou une écriture réussie avec la bonne clé.
    if (res.r.ok && res.ip && (action === 'lire' || action === 'chercher' || action === 'programmer')) {
      await client.appeler('retenirAdresse', { ip: res.ip });
    }
    journaliser(action, res.r, res.ip, res.mesures);
  } catch (e) {
    const r = { ok: false, erreur: 'format' };
    etat('Échec inattendu : fermez l\'application puis rouvrez-la.', 'ko');
    journaliser(action, r);
  } finally {
    occupe(false);
    montrerResultat();
  }
}

async function demarrer() {
  horloge();
  const pont = globalThis.PontLocal;
  if (!pont || typeof pont.postMessage !== 'function') { etat(msg('pont_absent'), 'ko'); occupe(true); return; }
  client = creerClientPont(pont);
  const d = await client.demarrage();
  if (!d.ok) { etat(msg('pont_muet'), 'ko'); occupe(true); return; }
  variante = d.variante === 'debug' ? 'debug' : 'release';
  if (variante === 'debug') { $('variante').textContent = 'Version de mise au point'; $('variante').hidden = false; }
  $('miseaupoint').hidden = variante !== 'debug';

  $('lire').addEventListener('click', () => lancer('lire'));
  $('chercher').addEventListener('click', () => lancer('chercher'));
  $('cle').addEventListener('click', () => { client.saisirCle(); });
  $('programmer').addEventListener('click', () => lancer('programmer'));
  $('filtre').addEventListener('click', () => lancer('filtre'));

  // Clé pas encore saisie : on l'indique d'emblée et le bouton de saisie devient principal. Adresse retenue : proposée.
  const c = await client.cable();
  if (c.ok && !c.configure) { etat(msg('pas_de_cle')); principal('cle'); }
  if (c.ok && typeof c.adresse === 'string' && adressePrivee(c.adresse)) $('ip').value = c.adresse;

  // Action lancée par adb dans la version de mise au point seulement (le pont ne la transmet jamais en lecture seule).
  const auto = variante === 'debug' ? d.auto : null;
  if (auto && auto.action === 'cle') { client.saisirCle(); return; }
  if (auto && typeof auto.action === 'string') {
    if (typeof auto.ip === 'string') { $('ip').value = auto.ip; $('ip').closest('details').open = true; }
    if (typeof auto.heure === 'string') $('heure').value = auto.heure;
    await lancer(auto.action, { heure: auto.heure, delai: auto.delai });
  }
}

demarrer();
