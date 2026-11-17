#!/usr/bin/env node
// Captures d'écran des pages servies en local, pour l'ergonome et le testeur inconnu.
//
//   node tools/capture.mjs <port> <chemin> [--largeur=500] [--hauteur=800] [--theme=clair|sombre]
//
// <port>   8080 : page personnelle (site/) ; 8081 : site public (dist/public/). Le serveur local doit
//          tourner (python -m http.server --bind 127.0.0.1 …, voir CLAUDE.md « Commandes utiles »).
// <chemin> chemin de la page sur ce serveur : « index.html », « 404.html », « guides/x/ »… Le « / » du
//          début est facultatif ; dans Git Bash, l'omettre (Git Bash convertit « /… » en chemin Windows).
//
// N'ouvre que http://127.0.0.1:<port><chemin>, avec Microsoft Edge (ou Google Chrome) sans fenêtre et un
// profil jetable créé dans dist/captures/ : ni cookie, ni compte, ni extension, ni réglage enregistré du
// navigateur de Mathieu ; chaque capture montre donc une première visite. Aucune variable d'environnement
// ne change le navigateur lancé ni l'adresse ouverte. Écrit dist/captures/<nom>.png (dist/ est ignoré
// par git) et affiche son chemin, à lire ensuite avec l'outil Read.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DOSSIER = join(RACINE, 'dist', 'captures');
const PORTS = { 8080: 'perso', 8081: 'public' };
// Chemin local seulement : ni « : », ni « @ », ni « \ », ni espace ; « // » au début est refusé à part.
const CHEMIN_VALIDE = /^\/[A-Za-z0-9\-._~/?=&%,+]{0,200}$/;
const NAVIGATEURS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const AIDE = 'Usage : node tools/capture.mjs <8080|8081> <chemin, ex. index.html> [--largeur=500] [--hauteur=800] [--theme=clair|sombre]';

function entier(texte, min, max, nom) {
  if (!/^\d{1,4}$/.test(texte)) throw new Error(`${nom} : nombre entier attendu.`);
  const n = Number(texte);
  if (n < min || n > max) throw new Error(`${nom} : entre ${min} et ${max}.`);
  return n;
}

// Valide les arguments et rend { url, largeur, hauteur, theme, fichier }. Lève une erreur sinon.
export function preparer(args) {
  const [port, brut, ...options] = args;
  if (!Object.hasOwn(PORTS, port ?? '')) throw new Error('Port refusé : 8080 (page personnelle) ou 8081 (site public).');
  const chemin = typeof brut === 'string' && !brut.startsWith('/') ? `/${brut}` : brut;
  if (typeof chemin !== 'string' || !CHEMIN_VALIDE.test(chemin) || chemin.startsWith('//')) {
    throw new Error('Chemin refusé : chemin local (lettres, chiffres, / ? = & % , + - . _ ~), par exemple index.html.');
  }
  let largeur = 500;
  let hauteur = 800;
  let theme = 'clair';
  for (const o of options) {
    const m = /^--(largeur|hauteur|theme)=(.*)$/.exec(o);
    if (!m) throw new Error(`Option inconnue : ${o}`);
    // Edge et Chrome sans fenêtre ne descendent pas sous ~500 px de large (constaté le 2026-11-17 : à 380 px,
    // la page est mise en page à 500 px puis rognée). La vue téléphone (380 px) demande une émulation mobile,
    // pas encore disponible : 500 px est la largeur la plus étroite fidèle.
    if (m[1] === 'largeur') largeur = entier(m[2], 500, 1920, 'Largeur');
    else if (m[1] === 'hauteur') hauteur = entier(m[2], 400, 6000, 'Hauteur');
    else if (m[2] === 'clair' || m[2] === 'sombre') theme = m[2];
    else throw new Error('Thème : clair ou sombre.');
  }
  const url = `http://127.0.0.1:${port}${chemin}`;
  const u = new URL(url);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.port !== port) throw new Error('Adresse refusée.');
  const page = chemin === '/' || chemin === '/index.html' ? 'accueil' : (chemin.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page');
  const fichier = join(DOSSIER, `${PORTS[port]}-${page}-${largeur}x${hauteur}-${theme}.png`);
  return { url, largeur, hauteur, theme, fichier };
}

// Arguments du navigateur : profil jetable, rien d'autre que l'adresse locale validée (en dernier).
export function argumentsNavigateur(c, profil) {
  return [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profil}`,
    '--force-device-scale-factor=2', `--window-size=${c.largeur},${c.hauteur}`,
    '--run-all-compositor-stages-before-draw', '--virtual-time-budget=4000',
    ...(c.theme === 'sombre' ? ['--force-dark-mode'] : []),
    `--screenshot=${c.fichier}`,
    c.url,
  ];
}

async function main(argv) {
  let c;
  try { c = preparer(argv); } catch (e) { console.error(e.message); console.error(AIDE); return 1; }
  const navigateur = NAVIGATEURS.find((p) => existsSync(p));
  if (!navigateur) { console.error('Aucun navigateur trouvé (Microsoft Edge ou Google Chrome).'); return 1; }
  try {
    const r = await fetch(c.url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (r.status !== 200) { console.error(`La page répond ${r.status} : chemin à vérifier.`); return 1; }
  } catch {
    console.error(`Serveur local injoignable sur ${c.url} : le lancer d'abord (CLAUDE.md, « Commandes utiles »).`);
    return 1;
  }
  mkdirSync(DOSSIER, { recursive: true });
  rmSync(c.fichier, { force: true });
  const profil = mkdtempSync(join(DOSSIER, 'profil-'));
  try {
    execFileSync(navigateur, argumentsNavigateur(c, profil), { stdio: 'ignore', timeout: 60000 });
  } catch {
    // Le navigateur peut rendre un code d'erreur alors que la capture est écrite : le fichier fait foi.
  } finally {
    try { rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* profil encore verrouillé : dist/ est ignoré par git */ }
  }
  if (!existsSync(c.fichier)) { console.error('Capture impossible : aucun fichier produit par le navigateur.'); return 1; }
  console.log(c.fichier);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { console.error('Erreur inattendue.'); process.exitCode = 1; });
}
