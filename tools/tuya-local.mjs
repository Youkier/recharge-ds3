#!/usr/bin/env node
// Pilotage LOCAL du câble depuis le PC (lot C2 de la phase 3b) : mêmes fonctions que la coque Android,
// celles de local/tuya-local.js, avec un transport TCP Node. Aucune dépendance.
//
//   node tools/tuya-local.mjs etat
//   node tools/tuya-local.mjs ecrire-debut HH:MM [--fin=06:00] [--duree=MIN] [--depart=07:30] [--confirmer]
//   node tools/tuya-local.mjs desactiver [--fin=06:00] [--confirmer]
//   ... --trace : affiche chaque trame envoyée et reçue (sens, commande, séquence, longueur, code retour, texte JSON
//                 de session) pour diagnostiquer ; jamais la clé, l'identifiant du câble ni les octets chiffrés.
//
// Sans --confirmer, rien n'est écrit : le câble est lu, et l'écriture qui serait faite est affichée.
// Lit tools/.env : TUYA_DEVICE_ID, TUYA_LOCAL_KEY, TUYA_LOCAL_IP (variable d'environnement prioritaire) et,
// en option, TUYA_LOCAL_VERSION (3.5 seulement). Aucune valeur secrète n'est jamais affichée (ni clé, ni identifiant).
// N'agit que sur TUYA_DEVICE_ID, et n'écrit que ss, se et m du dp 151 (démarrage tardif du 2026-11-22 : début décalé à maintenant + 10 min
// si l'heure est dépassée). Les options --fin, --duree et --depart reprennent le contrat de la coque Android.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { programmer } from '../local/tuya-local.js';
import { localiserCable } from '../local/recherche.js';
import { creerTransportNode, adresseAutorisee, sonderPort } from '../local/transport-node.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FICHIER_ADRESSE = join(ICI, 'releves', 'cable-adresse.json'); // dossier ignoré par git ; adresse seulement
const AIDE = 'Actions : etat | ecrire-debut <HH:MM> [--fin=HH:MM] [--duree=MIN] [--depart=HH:MM] [--confirmer] | desactiver [--fin=HH:MM] [--confirmer]';

export function parseEnv(texte) {
  const out = {};
  for (const brute of String(texte).split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const i = ligne.indexOf('=');
    if (i < 1) continue;
    const cle = ligne.slice(0, i).trim().replace(/^export\s+/, '');
    let val = ligne.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[cle] = val;
  }
  return out;
}

export function chargerConfig(chemin = join(ICI, '.env'), env = process.env, { ipFacultative = false } = {}) {
  if (!existsSync(chemin)) throw new Error('Fichier tools/.env introuvable.');
  const f = parseEnv(readFileSync(chemin, 'utf8'));
  for (const k of ['TUYA_DEVICE_ID', 'TUYA_LOCAL_KEY']) if (!f[k]) throw new Error(`Variable manquante dans tools/.env : ${k}`);
  const ip = env.TUYA_LOCAL_IP || f.TUYA_LOCAL_IP;
  if (!ip && !ipFacultative) throw new Error('TUYA_LOCAL_IP manquante (tools/.env ou variable d\'environnement) : adresse du câble sur le Wi-Fi.');
  if (ip && !adresseAutorisee(ip, 6668)) throw new Error('TUYA_LOCAL_IP refusée : adresse IPv4 privée attendue (192.168.x.x, 10.x.x.x ou 172.16 à 31.x.x).');
  const version = env.TUYA_LOCAL_VERSION || f.TUYA_LOCAL_VERSION || '3.5';
  if (version !== '3.5') throw new Error('Seul le protocole 3.5 est pris en charge (TUYA_LOCAL_VERSION).');
  return { ip, deviceId: f.TUYA_DEVICE_ID, cleLocale: f.TUYA_LOCAL_KEY, version };
}

// Dernière adresse trouvée : adresse seulement, jamais de clé ni d'identifiant. Fichier absent, corrompu ou adresse non privée : ignoré.
export function lireAdresseEnregistree(chemin = FICHIER_ADRESSE) {
  try {
    const ip = JSON.parse(readFileSync(chemin, 'utf8'))?.ip;
    return typeof ip === 'string' && adresseAutorisee(ip, 6668) ? ip : null;
  } catch { return null; }
}

export function enregistrerAdresse(ip, chemin = FICHIER_ADRESSE) {
  if (!adresseAutorisee(ip, 6668) || lireAdresseEnregistree(chemin) === ip) return;
  try {
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, JSON.stringify({ ip }) + '\n');
  } catch { /* l'enregistrement est un confort : son échec ne bloque rien */ }
}

// Adresses IPv4 privées des interfaces du PC (pour fouiller leur /24 faute d'adresse de départ).
export function adressesDuPc(interfaces = networkInterfaces()) {
  const out = [];
  for (const liste of Object.values(interfaces)) {
    for (const a of liste ?? []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && adresseAutorisee(a.address, 6668)) out.push(a.address);
    }
  }
  return out;
}

const MESSAGES = {
  hors_ligne: 'Câble injoignable : PC sur le même Wi-Fi, adresse correcte, Smart Life fermée (une seule connexion locale).',
  delai: 'Le câble n\'a pas répondu à temps (Smart Life ouverte sur le câble ? câble occupé ?).',
  cle: 'Négociation refusée : clé locale périmée (elle change à chaque appairage) ou mauvaise version.',
  format: 'Valeur du câble inattendue (ou version non prise en charge) : rien n\'a été écrit.',
  relecture_differente: 'Le câble n\'a pas la valeur demandée après l\'écriture, ou un autre point a changé : vérifier dans Smart Life.',
  requete_invalide: 'Demande invalide : heures HH:MM, durée 1 à 1439 minutes, fin entre le début et le départ.',
  trop_tard: 'Trop tard : le départ est à 10 minutes ou moins, rien n\'a été écrit.',
};

const NOMS_CMD = { 3: 'NEG_DEBUT', 4: 'NEG_REPONSE', 5: 'NEG_FIN', 8: 'STATUS', 0x0d: 'CONTROL_NEW', 0x10: 'DP_QUERY_NEW' };

// Ligne de journal d'une trame ou d'une étape (voir cfg.trace dans local/tuya-local.js). Aucune valeur secrète n'y arrive :
// le module masque la clé et l'identifiant, et ne donne jamais les octets chiffrés.
export function formaterTrace(e) {
  const t = `[+${String(e.ms).padStart(5)} ms]`;
  if (e.note) return `${t} ${e.note}`;
  const nom = NOMS_CMD[e.cmd] ?? '?';
  const ret = e.retcode === undefined ? '' : ` retcode=${e.retcode}`;
  const txt = e.texte === undefined ? '' : ` ${e.texte}`;
  return `${t} ${e.sens} cmd=0x${e.cmd.toString(16).padStart(2, '0')} ${nom} seq=${e.seq} long=${e.longueur}${ret}${txt}`;
}

const plageTexte = (r) => `${r.debut}–${r.fin}, plage ${r.plage_active ? 'active' : 'désactivée (charge immédiate)'}`;

async function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const confirme = argv.includes('--confirmer');
  const trace = argv.includes('--trace') ? (e) => console.log(formaterTrace(e)) : undefined;
  const action = args[0];
  if (!action || action === 'aide') { console.log(AIDE); return 0; }
  if (!['etat', 'ecrire-debut', 'desactiver'].includes(action)) { console.log(AIDE); return 1; }
  let demande = null;
  const option = (nom, defaut) => { const a = argv.find((x) => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; };
  if (action === 'ecrire-debut') {
    if (!HEURE_VALIDE.test(args[1] ?? '')) { console.error('Heure invalide : attendu HH:MM (00:00 à 23:59).'); return 1; }
    // Contrat du 2026-11-22 : début, fin de la plage (06:00 par défaut), durée de charge (de l'allumage à la fin par défaut), départ (07:30).
    const fin = option('fin', '06:00');
    const depart = option('depart', '07:30');
    const m = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    const duree = Number(option('duree', ((m(fin) - m(args[1])) % 1440 + 1440) % 1440 || 1));
    demande = { allumage: args[1], fin, duree_min: duree, depart };
  } else if (action === 'desactiver') {
    if (args.length > 1) { console.error('desactiver ne prend pas d\'heure.'); return 1; }
    demande = { desactiver: true, fin: option('fin', '06:00') }; // fin des heures creuses : début = fin - 1 min
  }
  let cfg;
  try { cfg = chargerConfig(undefined, undefined, { ipFacultative: true }); } catch (e) { console.error(e.message); return 1; }

  // Adresse du câble : TUYA_LOCAL_IP, puis la dernière trouvée ; si elle ne répond pas, recherche sur le réseau (lecture seule).
  const { ip: ipConfig, ...cfgBase } = cfg;
  const cfgSansIp = action === 'etat' && trace ? { ...cfgBase, trace } : cfgBase;
  const loc = await localiserCable({
    cfg: cfgSansIp, departs: [ipConfig, lireAdresseEnregistree()].filter(Boolean), interfaces: adressesDuPc(),
    creerTransport: creerTransportNode, sonder: sonderPort,
    surRecherche: () => console.log('Adresse du câble inconnue ou muette : recherche sur le réseau (jusqu\'à 30 s)...'),
  });
  if (!loc.ok) {
    console.error(`ECHEC (${loc.erreur}) : ${MESSAGES[loc.erreur]}`);
    if (loc.recherche) console.error('Recherche sur le réseau sans résultat : aucun câble, ou plusieurs appareils acceptent la clé. Rien n\'a été écrit.');
    return 1;
  }
  if (loc.trouve) console.log(`Câble trouvé à ${loc.ip}`);
  enregistrerAdresse(loc.ip);
  cfg = { ...cfg, ip: loc.ip };

  const transport = creerTransportNode();
  if (action === 'etat') {
    const r = loc.etat;
    if (!r.ok) { console.error(`ECHEC (${r.erreur}) : ${MESSAGES[r.erreur] ?? ''}`); return 1; }
    console.log(`Plage de charge (dp 151) : ${plageTexte(r)}.`);
    return 0;
  }
  const r = await programmer({ ...cfg, simuler: !confirme, ...(trace ? { trace } : {}) }, transport, demande);
  if (!r.ok) { console.error(`ECHEC (${r.erreur}) : ${MESSAGES[r.erreur] ?? ''}`); return 1; }
  if (r.simulation) {
    console.log(`Valeur actuelle : ${plageTexte(r.actuelle)}.`);
    console.log(`Valeur à écrire : ${plageTexte(r.a_ecrire)}${r.a_ecrire.tardif ? ' (heure de début dépassée : démarrage tardif, maintenant + 10 min)' : ''}${r.a_ecrire.courte ? ' (plage courte : pas de charge)' : ''}.`);
    console.log('Simulation : rien n\'a été envoyé. Ajouter --confirmer pour écrire.');
    return 0;
  }
  console.log(`Écrit et relu : ${plageTexte(r)}${r.tardif ? ' (démarrage tardif)' : ''}${r.courte ? ' (plage courte)' : ''}. Valeur relue conforme, aucun autre point modifié.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { console.error('Erreur inattendue.'); process.exitCode = 1; });
}
