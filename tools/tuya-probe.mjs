#!/usr/bin/env node
// Sonde Tuya (phase 2a) : lectures, relevés et comparaison. Node >= 20, aucune dépendance.
// Usage : node tools/tuya-probe.mjs <action>   (voir `aide`)
// Les identifiants sont lus dans tools/.env ; ils ne sont jamais affichés.
// Cette sonde n'agit que sur TUYA_DEVICE_ID : aucun identifiant d'appareil en argument.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const DELAI_MS = 10_000;
const ENDPOINT_DEFAUT = 'https://openapi.tuyaeu.com';

// --- À DÉTERMINER au test T2 (ne rien deviner) ---------------------------------
// Code du point de données « début de plage de charge » et format de sa valeur.
export const CODE_DEBUT_PLAGE = '';
// Fonction (heure "HH:MM") -> valeur à envoyer, selon le format observé en T2.
export function formaterDebut(_hhmm) {
  throw new Error('Format de la valeur de début de plage non déterminé (T2).');
}

// --- Parseur .env minimal -------------------------------------------------------
export function parseEnv(texte) {
  const out = {};
  for (const brute of String(texte).split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const i = ligne.indexOf('=');
    if (i < 1) continue;
    const cle = ligne.slice(0, i).trim().replace(/^export\s+/, '');
    let val = ligne.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[cle] = val;
  }
  return out;
}

export function chargerConfig(chemin = join(ICI, '.env')) {
  if (!existsSync(chemin)) throw new Error('Fichier tools/.env introuvable.');
  const env = parseEnv(readFileSync(chemin, 'utf8'));
  for (const k of ['TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET', 'TUYA_DEVICE_ID']) {
    if (!env[k]) throw new Error(`Variable manquante dans tools/.env : ${k}`);
  }
  return {
    id: env.TUYA_ACCESS_ID,
    secret: env.TUYA_ACCESS_SECRET,
    device: env.TUYA_DEVICE_ID,
    endpoint: (env.TUYA_ENDPOINT || ENDPOINT_DEFAUT).replace(/\/+$/, ''),
    uid: env.TUYA_UID || '', // facultatif, seulement pour `appareils`
    // Facultatif et temporaire : identifiant d'un AUTRE appareil du compte, seulement pour
    // l'action `isolement` (vérifier que le projet n'y a PAS accès). À retirer après le test.
    testIsolement: env.TUYA_TEST_ISOLEMENT_ID || '',
  };
}

// --- Signature (source : https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g)
export const sha256hex = (s) => createHash('sha256').update(s ?? '', 'utf8').digest('hex');

export function urlAvecParametres(chemin, query = {}) {
  const cles = Object.keys(query).sort();
  if (!cles.length) return chemin;
  return chemin + '?' + cles.map((k) => `${k}=${query[k]}`).join('&');
}

export function chaineASigner(methode, corps, url, entetesSignes = '') {
  return [methode.toUpperCase(), sha256hex(corps), entetesSignes, url].join('\n');
}

export function signer({ clientId, secret, t, nonce = '', accessToken = '', methode, chemin, query, corps = '', entetesSignes = '' }) {
  const sts = chaineASigner(methode, corps, urlAvecParametres(chemin, query), entetesSignes);
  const str = clientId + accessToken + t + nonce + sts;
  return createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

// --- Masquage -------------------------------------------------------------------
const secrets = new Set();
export function masquer(texte) {
  let s = String(texte);
  for (const v of secrets) if (v && v.length >= 4) s = s.split(v).join(v.slice(0, 4) + '…');
  return s;
}
const log = (...a) => console.log(masquer(a.join(' ')));

// --- Appel générique --------------------------------------------------------------
let jetonCache = null; // { valeur, expire }

async function appeler(cfg, methode, chemin, { query = {}, corps = '', avecJeton = true } = {}) {
  const t = String(Date.now());
  const nonce = randomBytes(16).toString('hex');
  const accessToken = avecJeton ? await obtenirJeton(cfg) : '';
  const sign = signer({ clientId: cfg.id, secret: cfg.secret, t, nonce, accessToken, methode, chemin, query, corps });
  const entetes = { client_id: cfg.id, t, nonce, sign_method: 'HMAC-SHA256', sign };
  if (avecJeton) entetes.access_token = accessToken;
  if (corps) entetes['Content-Type'] = 'application/json';
  const rep = await fetch(cfg.endpoint + urlAvecParametres(chemin, query), {
    method: methode,
    headers: entetes,
    body: corps || undefined,
    signal: AbortSignal.timeout(DELAI_MS),
  });
  let json;
  try {
    json = await rep.json();
  } catch {
    throw new Error(`Réponse non JSON (HTTP ${rep.status}).`);
  }
  if (json.success !== true) {
    throw new Error(`Erreur Tuya (HTTP ${rep.status}) code=${json.code} msg=${json.msg}`);
  }
  return json.result;
}

async function obtenirJeton(cfg) {
  if (jetonCache && jetonCache.expire > Date.now() + 60_000) return jetonCache.valeur;
  const r = await appeler(cfg, 'GET', '/v1.0/token', { query: { grant_type: 1 }, avecJeton: false });
  jetonCache = { valeur: r.access_token, expire: Date.now() + r.expire_time * 1000 };
  secrets.add(r.access_token);
  return r.access_token;
}

// Chemins : documentés sur https://developer.tuya.com/en/docs/cloud/device-control?id=K95zu01ksols7
// (/v1.0/devices/...). Variante /v1.0/iot-03/devices/... (skill, non confirmée) via --iot03.
function chemins(cfg, iot03) {
  const base = iot03 ? `/v1.0/iot-03/devices/${cfg.device}` : `/v1.0/devices/${cfg.device}`;
  return {
    base,
    fonctions: `${base}/functions`,
    spec: `${base}/${iot03 ? 'specification' : 'specifications'}`,
    etat: `${base}/status`,
    commandes: `${base}/commands`,
    shadow: `/v2.0/cloud/thing/${cfg.device}/shadow/properties`, // hypothèse
  };
}

// --- Comparaison (hors ligne) ---------------------------------------------------
export function aplatir(releve) {
  const m = new Map();
  for (const p of releve?.status ?? []) m.set(p.code, p.value);
  for (const p of releve?.shadow?.properties ?? []) m.set('shadow:' + (p.code ?? p.dp_id), p.value);
  return m;
}
export function comparerReleves(a, b) {
  const A = aplatir(a), B = aplatir(b);
  const diff = [];
  for (const code of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const va = A.get(code), vb = B.get(code);
    if (!A.has(code)) diff.push({ code, type: 'ajouté', apres: vb });
    else if (!B.has(code)) diff.push({ code, type: 'disparu', avant: va });
    else if (JSON.stringify(va) !== JSON.stringify(vb)) diff.push({ code, type: 'modifié', avant: va, apres: vb });
  }
  return diff;
}

// --- Actions --------------------------------------------------------------------
const vue = (o) => JSON.stringify(o, null, 2);

async function actionToken(cfg) {
  const r = await appeler(cfg, 'GET', '/v1.0/token', { query: { grant_type: 1 }, avecJeton: false });
  secrets.add(r.access_token);
  log('Jeton obtenu :', r.access_token.slice(0, 4) + '…', `(expire dans ${r.expire_time} s)`);
}

async function actionAppareils(cfg) {
  // Source : https://developer.tuya.com/en/docs/cloud/dc413408fe?id=Kc09y2ons2i3b (GET /v1.3/iot-03/devices)
  // Repli : https://developer.tuya.com/en/docs/cloud/cacc9c4989?id=Ka7kk03zdecl4 (GET /v1.0/users/{uid}/devices)
  const essais = [];
  if (cfg.uid) essais.push(['/v1.3/iot-03/devices', { source_type: 'tuyaUser', source_id: cfg.uid, page_size: 200 }, 'list']);
  essais.push(['/v1.3/iot-03/devices', { page_size: 200 }, 'list']);
  if (cfg.uid) essais.push([`/v1.0/users/${cfg.uid}/devices`, {}, null]);
  for (const [chemin, query, cle] of essais) {
    try {
      const r = await appeler(cfg, 'GET', chemin, { query });
      const liste = cle ? r?.[cle] : r;
      if (!Array.isArray(liste) || !liste.length) { log(`${chemin} : liste vide, essai suivant.`); continue; }
      log(`${liste.length} appareil(s) via ${chemin} (nom et catégorie seulement) :`);
      for (const d of liste) log(`- ${d.name} | catégorie : ${d.category}${d.id === cfg.device ? ' | <- câble (TUYA_DEVICE_ID)' : ''}`);
      return;
    } catch (e) { log(`${chemin} : ${e.message}`); }
  }
  log('Aucune liste obtenue. Si besoin, ajouter TUYA_UID (compte Smart Life lié) dans tools/.env.');
}

async function actionLire(cfg, nom, iot03) {
  log(vue(await appeler(cfg, 'GET', chemins(cfg, iot03)[nom])));
}

async function actionReleve(cfg, iot03, shadow) {
  const p = chemins(cfg, iot03);
  const releve = { date: new Date().toISOString(), status: await appeler(cfg, 'GET', p.etat) };
  if (shadow) releve.shadow = await appeler(cfg, 'GET', p.shadow);
  const dossier = join(ICI, 'releves');
  mkdirSync(dossier, { recursive: true });
  const nom = 'releve-' + releve.date.replace(/[:.]/g, '-') + '.json';
  writeFileSync(join(dossier, nom), vue(releve) + '\n');
  log(`Relevé enregistré : tools/releves/${nom} (${releve.status.length} points de données)`);
}

function actionCompare(f1, f2) {
  if (!f1 || !f2) throw new Error('Usage : compare <fichier1> <fichier2>');
  const diff = comparerReleves(JSON.parse(readFileSync(f1, 'utf8')), JSON.parse(readFileSync(f2, 'utf8')));
  if (!diff.length) return log('Aucune différence.');
  for (const d of diff) {
    if (d.type === 'modifié') log(`~ ${d.code} : ${JSON.stringify(d.avant)} -> ${JSON.stringify(d.apres)}`);
    else if (d.type === 'ajouté') log(`+ ${d.code} : ${JSON.stringify(d.apres)}`);
    else log(`- ${d.code} : ${JSON.stringify(d.avant)}`);
  }
}

// Test d'isolement : le projet doit être REFUSÉ sur un appareil autre que le câble.
// Lecture seule (GET), aucune valeur affichée : seulement « refusé » (code Tuya) ou « ACCESSIBLE ».
async function actionIsolement(cfg) {
  if (!cfg.testIsolement) throw new Error('Ajouter temporairement TUYA_TEST_ISOLEMENT_ID (un autre appareil du compte) dans tools/.env.');
  if (cfg.testIsolement === cfg.device) throw new Error("TUYA_TEST_ISOLEMENT_ID doit être un autre appareil que le câble.");
  const id = cfg.testIsolement;
  const essais = [
    ['infos', `/v1.0/iot-03/devices/${id}`],
    ['infos (v1.0)', `/v1.0/devices/${id}`],
    ['état', `/v1.0/iot-03/devices/${id}/status`],
    ['points de données', `/v2.0/cloud/thing/${id}/shadow/properties`],
  ];
  let accessible = 0;
  for (const [nom, chemin] of essais) {
    try {
      const r = await appeler(cfg, 'GET', chemin); // contenu jamais affiché : seulement sa taille
      const taille = Array.isArray(r) ? `${r.length} élément(s)`
        : Array.isArray(r?.properties) ? `${r.properties.length} point(s) de données`
        : r && typeof r === 'object' ? `objet de ${Object.keys(r).length} champ(s)` : `valeur ${r === null || r === undefined || r === '' ? 'vide' : 'non vide'}`;
      const vide = (Array.isArray(r) && !r.length) || (Array.isArray(r?.properties) && !r.properties.length) || r === null || r === undefined || r === '' || (r && typeof r === 'object' && !Object.keys(r).length);
      if (!vide) accessible++;
      log(`${vide ? 'succès mais VIDE' : 'ACCESSIBLE'} : ${nom} -> ${taille} (contenu non affiché)`);
    } catch (e) {
      log(`refusé : ${nom} -> ${e.message}`);
    }
  }
  log(accessible ? `ÉCHEC DE L'ISOLEMENT : ${accessible} lecture(s) acceptée(s) sur un autre appareil.` : "Isolement vérifié : toutes les lectures sur l'autre appareil sont refusées.");
}

export const HEURE_VALIDE =/^([01]\d|2[0-3]):[0-5]\d$/;

async function actionEcrireDebut(cfg, hhmm, confirme, iot03) {
  if (!CODE_DEBUT_PLAGE) {
    throw new Error('ecrire-debut refusée : CODE_DEBUT_PLAGE et formaterDebut() ne sont pas renseignés (à déterminer au test T2).');
  }
  if (!HEURE_VALIDE.test(hhmm || '')) throw new Error('Heure invalide : attendu HH:MM (00:00 à 23:59).');
  const valeur = formaterDebut(hhmm);
  if (!confirme) {
    log(`Simulation : écrirait code=${CODE_DEBUT_PLAGE} valeur=${JSON.stringify(valeur)} sur le câble. Ajouter --confirmer pour envoyer.`);
    return;
  }
  const corps = JSON.stringify({ commands: [{ code: CODE_DEBUT_PLAGE, value: valeur }] });
  log('Réponse :', vue(await appeler(cfg, 'POST', chemins(cfg, iot03).commandes, { corps })));
}

const AIDE = `Actions : token | appareils | fonctions | spec | etat | releve [--shadow] | compare <f1> <f2> | isolement | ecrire-debut <HH:MM> --confirmer
Option --iot03 : utilise les chemins /v1.0/iot-03/devices/... (variante non confirmée).`;

async function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const opt = (n) => argv.includes('--' + n);
  const [action, ...reste] = args;
  if (action === 'compare') return actionCompare(reste[0], reste[1]);
  if (!action || action === 'aide') return console.log(AIDE);
  const cfg = chargerConfig();
  secrets.add(cfg.id); secrets.add(cfg.secret); secrets.add(cfg.device);
  if (cfg.uid) secrets.add(cfg.uid);
  if (cfg.testIsolement) secrets.add(cfg.testIsolement);
  const iot03 = opt('iot03');
  switch (action) {
    case 'token': return actionToken(cfg);
    case 'appareils': return actionAppareils(cfg);
    case 'fonctions': return actionLire(cfg, 'fonctions', iot03);
    case 'spec': return actionLire(cfg, 'spec', iot03);
    case 'etat': return actionLire(cfg, 'etat', iot03);
    case 'releve': return actionReleve(cfg, iot03, opt('shadow'));
    case 'isolement': return actionIsolement(cfg);
    case 'ecrire-debut': return actionEcrireDebut(cfg, reste[0], opt('confirmer'), iot03);
    default: console.log(AIDE); process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('Erreur :', masquer(e.message));
    process.exitCode = 1;
  });
}
