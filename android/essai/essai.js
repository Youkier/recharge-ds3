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
  pas_de_cle: 'Identifiant et clé du câble non saisis : touchez « Saisir la clé du câble ».',
  pas_wifi: 'Pas de Wi-Fi : connectez le téléphone au Wi-Fi de la maison, puis recommencez.',
  adresse_invalide: 'Adresse invalide : saisissez une adresse du réseau de la maison (par exemple 192.168.1.48), ou touchez « Chercher le câble ».',
  adresse_vide: 'Aucune adresse : saisissez celle du câble, ou touchez « Chercher le câble ».',
  hors_ligne: 'Aucun câble ne répond à cette adresse. Vérifiez que le câble est alimenté et sur le même Wi-Fi.',
  hors_ligne_recherche: 'Aucun câble trouvé sur le Wi-Fi (recherche faite sur tout le réseau). Vérifiez que le câble est alimenté et que Smart Life n\'est pas en train de le piloter.',
  refuse: 'Adresse ou port refusés par l\'application : seule une adresse privée du réseau local, port 6668, est permise.',
  occupe: 'L\'application est déjà en train de parler au câble : attendez quelques secondes puis recommencez.',
  cle: 'Clé refusée par le câble : ressaisissez la clé, ou le câble a été réappairé depuis.',
  delai: 'Le câble n\'a pas répondu à temps.',
  format: 'Réponse inattendue du câble : rien n\'a été écrit.',
  relecture_differente: 'L\'écriture n\'est pas confirmée par la relecture : vérifiez la plage dans Smart Life.',
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
function journaliser(action, r, ip) {
  const ligne = { action, ok: r.ok === true, erreur: r.ok ? undefined : r.erreur, debut: r.debut, fin: r.fin, ip };
  if (r.immediat) ligne.immediat = true;
  if (r.courte) ligne.courte = true;
  console.log('ESSAI ' + JSON.stringify(ligne));
}
const plageTexte = (r) => `${r.debut} → ${r.fin} (${r.plage_active ? 'activée' : 'désactivée'})`;

// --- Préparation commune : clé, Wi-Fi, adresse ---
async function preparer({ adresse }) {
  const c = await client.cable();
  if (!c.ok) return { erreur: c.erreur === 'pont_muet' ? 'pont_muet' : 'pas_de_cle' };
  if (!c.configure || typeof c.cle !== 'string' || typeof c.deviceId !== 'string') return { erreur: 'pas_de_cle' };
  const w = await client.prefixeWifi();
  if (!w.ok) return { erreur: w.erreur === 'pas_wifi' ? 'pas_wifi' : (w.erreur ?? 'pas_wifi') };
  let ip = null;
  if (adresse) {
    ip = $('ip').value.trim();
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
  if (r.ok) return { r, ip: p.ip, texte: `Câble joint : charge différée ${plageTexte(r)}.` };
  const e = erreurFinale(r);
  return { r: { ...r, erreur: e }, ip: p.ip, texte: msg(e) };
}

async function actionChercher() {
  const p = await preparer({ adresse: false });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, texte: msg(p.erreur) };
  const depart = $('ip').value.trim();
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
    const nouveau = res.trouve ? ` (nouvelle adresse : ${res.ip}, à noter ; rien n'est enregistré)` : '';
    return { r: { ...res.etat, ok: true }, ip: res.ip, texte: `Câble trouvé à ${res.ip}${nouveau}. Charge différée ${plageTexte(res.etat)}.` };
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
    return { r, ip: p.ip, texte: `Programmé et relu : charge différée ${plageTexte(r)}${note}.` };
  }
  const e = erreurFinale(r);
  const suite = e === 'delai' ? ' Résultat incertain : vérifiez la plage dans Smart Life.' : '';
  return { r: { ...r, erreur: e }, ip: p.ip, texte: msg(e) + suite };
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
    else return;
    etat(res.texte, res.r.ok ? 'ok' : 'ko');
    journaliser(action, res.r, res.ip);
  } catch (e) {
    const r = { ok: false, erreur: 'format' };
    etat('Échec inattendu de la page d\'essai.', 'ko');
    journaliser(action, r);
  } finally {
    occupe(false);
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
  $('variante').textContent = variante === 'debug' ? 'Version de mise au point' : 'Version de lecture seule';
  $('miseaupoint').hidden = variante !== 'debug';

  $('lire').addEventListener('click', () => lancer('lire'));
  $('chercher').addEventListener('click', () => lancer('chercher'));
  $('cle').addEventListener('click', () => { client.saisirCle(); });
  $('programmer').addEventListener('click', () => lancer('programmer'));
  $('filtre').addEventListener('click', () => lancer('filtre'));

  // Action lancée par adb dans la version de mise au point seulement (le pont ne la transmet jamais en lecture seule).
  const auto = variante === 'debug' ? d.auto : null;
  if (auto && typeof auto.action === 'string') {
    if (typeof auto.ip === 'string') $('ip').value = auto.ip;
    if (typeof auto.heure === 'string') $('heure').value = auto.heure;
    await lancer(auto.action, { heure: auto.heure });
  }
}

demarrer();
