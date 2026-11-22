// Page d'essai de la coque Android : « Lire l'état », « Chercher le câble » et, dans la version de mise au point
// seulement, « Programmer » et « Vérifier le filtre du pont ». Depuis le lot E2, le protocole local tourne dans le code
// natif : cette page demande des opérations de haut niveau (lire, programmer, chercher) par site/pont.js.
//
// Clé du câble : saisie dans l'écran natif, jamais ici ; la page ne la reçoit jamais (ni l'identifiant). Après chaque
// action, UNE ligne « ESSAI {json} » (action, ok, erreur, debut, fin, ip) est écrite dans la console, que la version de
// mise au point relaie dans logcat : jamais de clé ni de trame.

import { creerClientPont } from '../../site/pont.js';

const $ = (id) => document.getElementById(id);
const BOUTONS = ['lire', 'chercher', 'cle', 'programmer', 'filtre'];

const MESSAGES = {
  pas_de_cle: 'Commencez par saisir la clé du câble.',
  pas_wifi: 'Pas de Wi-Fi : connectez le téléphone au Wi-Fi de la maison, puis recommencez.',
  adresse_invalide: 'Adresse invalide : saisissez une adresse du réseau de la maison (par exemple 192.168.1.48), ou touchez « Chercher le câble ».',
  adresse_vide: 'Aucune adresse : saisissez celle du câble, ou touchez « Chercher le câble ».',
  hors_ligne: 'Aucun câble ne répond à cette adresse. Vérifiez que le câble est branché et sur le même Wi-Fi.',
  sans_adresse: 'Aucune adresse : saisissez celle du câble, ou touchez « Chercher le câble ».',
  introuvable: 'Aucun câble trouvé sur le Wi-Fi. Vérifiez que le câble est branché, puis fermez Smart Life s\'il est ouvert et recommencez.',
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
  $('horloge').textContent = `Heure du téléphone (Paris) : ${f.format(new Date())}. Si elle est fausse, la décision « démarrage tardif » le sera aussi.`;
}
// Le seul appel de console de la page : une ligne « ESSAI {json} », sans clé ni identifiant.
function ecrireLigne(ligne) {
  console.log('ESSAI ' + JSON.stringify(ligne));
}
function journaliser(action, r, ip, mesures) {
  const ligne = { action, ok: r.ok === true, erreur: r.ok ? undefined : r.erreur, debut: r.debut, fin: r.fin, ip };
  if (r.tardif) ligne.tardif = true;
  if (r.courte) ligne.courte = true;
  if (mesures) Object.assign(ligne, mesures); // essai E0 : durées et état de l'écran, jamais de donnée du câble
  ecrireLigne(ligne);
}
const plageTexte = (r) => `de ${r.debut} à ${r.fin} (${r.plage_active ? 'activée' : 'désactivée'})`;
function principal(id) { for (const b of ['lire', 'cle']) $(b).classList.toggle('principal', b === id); }
function montrerResultat() { $('resultat').scrollIntoView({ block: 'nearest' }); }

// --- Préparation commune : clé enregistrée ? adresse saisie ? (la clé elle-même reste dans le natif) ---
async function preparer({ adresse }) {
  const c = await client.cable();
  if (!c.ok) return { erreur: c.erreur === 'pont_muet' ? 'pont_muet' : 'pas_de_cle' };
  if (!c.configure) return { erreur: 'pas_de_cle' };
  let ip = null;
  if (adresse) {
    ip = $('ip').value.trim().replace(',', '.');
    if (!ip) return { erreur: 'adresse_vide' };
    if (!adressePrivee(ip)) return { erreur: 'adresse_invalide', ip };
  }
  return { ip };
}

// Adresse IPv4 privée en notation décimale stricte (le natif la revalide).
function adressePrivee(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n, i) => n > 255 || String(n) !== m[i + 1])) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

// --- Actions ---
async function actionLire() {
  const p = await preparer({ adresse: true });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, ip: p.ip, texte: msg(p.erreur) };
  etat('Lecture du câble…');
  const r = await client.lire({ ip: p.ip });
  if (r.ok) return { r, ip: p.ip, texte: `Câble connecté. Charge programmée ${plageTexte(r)}.` };
  return { r, ip: p.ip, texte: msg(r.erreur) };
}

async function actionChercher() {
  const p = await preparer({ adresse: false });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, texte: msg(p.erreur) };
  const depart = $('ip').value.trim().replace(',', '.');
  const params = depart && adressePrivee(depart) ? { ip: depart } : {};
  etat(params.ip ? 'Connexion au câble…' : 'Recherche du câble sur le Wi-Fi… (jusqu\'à 30 s)');
  const res = await client.chercher(params, (p2) => { if (p2.etape) etat('Recherche du câble sur le Wi-Fi… (jusqu\'à 30 s)'); });
  if (res.ok) {
    $('ip').value = res.ip;
    const nouveau = res.trouve ? ` (adresse à noter : rien n'est enregistré)` : '';
    return { r: { ...res, ok: true }, ip: res.ip, texte: `Câble trouvé à ${res.ip}${nouveau}. Charge programmée ${plageTexte(res)}.` };
  }
  return { r: { ok: false, erreur: res.erreur }, ip: params.ip, texte: msg(res.erreur) };
}

// Demande de programmation de la page d'essai : début choisi, fin 06:00, durée 7 h, départ 07:30 (contrat du 2026-11-22).
const demande = (h) => ({ allumage: h, fin: '06:00', duree_min: 420, depart: '07:30' });

async function actionProgrammer(heure) {
  const p = await preparer({ adresse: true });
  if (p.erreur) return { r: { ok: false, erreur: p.erreur }, ip: p.ip, texte: msg(p.erreur) };
  const h = (heure ?? $('heure').value ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) return { r: { ok: false, erreur: 'requete_invalide' }, ip: p.ip, texte: 'Heure invalide : choisissez une heure au format HH:MM.' };
  etat('Programmation du câble…');
  const r = await client.programmer(demande(h), { ip: p.ip });
  if (r.ok) {
    const note = r.tardif ? ' (heure de début dépassée : démarrage tardif, maintenant + 10 min)' : '';
    return { r, ip: p.ip, texte: `Câble programmé et relu. Charge ${plageTexte(r)}${note}.` };
  }
  const suite = r.erreur === 'delai' ? ' Résultat incertain : vérifiez la plage de charge dans Smart Life.' : '';
  return { r, ip: p.ip, texte: msg(r.erreur) + suite };
}

// Vérifie qu'aucune route générique n'existe (ouvrir, envoyer, recevoir, fermer, sonder : « operation_inconnue »), que le
// transport natif refuse tout sauf IPv4 privée:6668 sans qu'aucun octet ne parte (op « essaiFiltre », version de mise au
// point), que les opérations refusent une adresse hors filtre ou une heure invalide, et que sw.js est en 404.
async function actionFiltre() {
  const echecs = [];
  for (const op of ['ouvrir', 'envoyer', 'recevoir', 'fermer', 'sonder', 'retenirAdresse']) {
    const r = await client.appeler(op, { ip: '10.0.2.2', port: 6668, cx: 1, d: 'AA==', delai: 400 }, 400);
    if (r.ok || r.erreur !== 'operation_inconnue') echecs.push(`route:${op}`);
  }
  const f = await client.appeler('essaiFiltre', {}, 10000);
  if (!f.ok || f.conforme !== true) echecs.push(`transport:${Array.isArray(f.echecs) ? f.echecs.join('+') : (f.erreur ?? 'inconnu')}`);
  for (const ip of ['8.8.8.8', '127.0.0.1', '010.0.0.1', '169.254.1.1']) {
    const r = await client.lire({ ip }, 1000);
    if (r.ok || r.erreur !== 'refuse') echecs.push(`lire:${ip}`);
    const c = await client.chercher({ ip }, null, 1000);
    if (c.ok || c.erreur !== 'refuse') echecs.push(`chercher:${ip}`);
  }
  for (const h of ['25:00', '5:00', '05:60']) {
    const r = await client.programmer(demande(h), { ip: '10.0.2.2' }, 1000);
    if (r.ok || r.erreur !== 'requete_invalide') echecs.push(`heure:${h}`);
  }
  for (const action of [{}, { allumage: '05:00' }, { ...demande('05:00'), fin: '08:00' }, { ...demande('05:00'), duree_min: 1440 }, { allumage: '05:00', desactiver: true }, { desactiver: false }]) {
    const r = await client.programmer(action, { ip: '10.0.2.2' }, 1000);
    if (r.ok || r.erreur !== 'requete_invalide') echecs.push(`action:${JSON.stringify(action)}`);
  }
  try {
    const sw = await fetch('../../site/sw.js', { cache: 'no-store' });
    if (sw.status !== 404) echecs.push(`sw.js:${sw.status}`);
  } catch { echecs.push('sw.js:erreur'); }
  const ok = echecs.length === 0;
  return { r: { ok, erreur: ok ? undefined : `filtre:${echecs.join(',')}` }, texte: ok ? 'Filtre du pont conforme : aucune route générique, le transport natif refuse tout sauf IPv4 privée:6668, sw.js est en 404.' : `Filtre non conforme : ${echecs.join(', ')}.` };
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
    principal(res.r.erreur === 'cle' || res.r.erreur === 'pas_de_cle' ? 'cle' : 'lire');
    // L'adresse est retenue par le code natif, seulement après une lecture, une écriture ou une recherche réussie.
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
