// Logique du Worker Cloudflare de programmation (phase 2b). Module ES, Web Crypto et fetch seulement.
// Point d'entrée : index.js. Ce module peut exporter des fonctions et constantes (tests) ;
// le module principal, lui, ne doit exporter que le gestionnaire (chaque export y est un point d'entrée).
// Routes : POST /api/programmer, GET /api/etat, OPTIONS (CORS). Tout le reste : 404.
// Il n'agit que sur env.TUYA_DEVICE_ID et n'écrit que le début de la plage de charge
// (x_charge_mode : ss et m). Jamais dt, se, courant, x_do_charge, ni une programmation Smart Life.
// Chemins et formats validés sur le câble : voir docs/tuya-findings.md.

export const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CODE_PLAGE = 'x_charge_mode';
const CLES_PLAGE = ['m', 'dt', 'ss', 'se'];
const MODES_CONNUS = [0, 2]; // 2 = plage active, 0 = désactivée (= charge immédiate sur ce câble)
const ENDPOINT_DEFAUT = 'https://openapi.tuyaeu.com';
const DELAI_TUYA_MS = 10_000;
const TAILLE_MAX_CORPS = 512;
const LONGUEUR_MIN_JETON = 32; // en dessous, le jeton est jugé trop faible : tout est refusé
// Relecture après écriture : le câble met quelques secondes à répercuter (la sonde attendait 5 s).
const ATTENTES_RELECTURE_MS = [1500, 2000, 2500];
// Repli si le binding de limitation est absent (développement local) : par isolat, donc approximatif.
const REPLI_LIMITE = { max: 30, fenetreMs: 3_600_000 };

// Codes d'erreur Tuya, source : https://developer.tuya.com/en/docs/iot/error-code?id=K989ruxx88swc
// (documentation lue le 2026-11-14, jamais observés en réel sauf 1106 : voir docs/tuya-findings.md).
const CODES_JETON_EXPIRE = new Set([1010, 1011, 1012, 1400]); // jeton expiré ou invalide : on en redemande un
const CODES_ACCES = new Set([1004, 1013, 1106, 60009001, 28841002, 28841102, 28841105]); // -> « jeton »
const CODES_HORS_LIGNE = new Set([2001, 40000801]);

const STATUTS = {
  hors_ligne: 502, jeton: 502, tuya: 502, relecture_differente: 502, delai: 504,
};

export class ErreurService extends Error {
  constructor(code) { super(code); this.code = code; }
}

// --- Signature (source : https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g) ---
const encodeur = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256hex(texte) {
  return hex(await crypto.subtle.digest('SHA-256', encodeur.encode(texte ?? '')));
}

export function urlAvecParametres(chemin, query = {}) {
  const cles = Object.keys(query).sort();
  return cles.length ? chemin + '?' + cles.map((k) => `${k}=${query[k]}`).join('&') : chemin;
}

export async function signer({ clientId, secret, t, nonce = '', accessToken = '', methode, chemin, query, corps = '', entetesSignes = '' }) {
  const sts = [methode.toUpperCase(), await sha256hex(corps), entetesSignes, urlAvecParametres(chemin, query)].join('\n');
  const cle = await crypto.subtle.importKey('raw', encodeur.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cle, encodeur.encode(clientId + accessToken + t + nonce + sts));
  return hex(sig).toUpperCase();
}

// --- Authentification du client : empreintes SHA-256 comparées par boucle XOR (longueur fixe) ---
export async function jetonValide(entete, attendu) {
  if (typeof attendu !== 'string' || attendu.length < LONGUEUR_MIN_JETON) return false; // secret absent ou trop court : tout est refusé
  const m = /^Bearer (.+)$/.exec(entete || '');
  const fourni = m ? m[1] : '';
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encodeur.encode(fourni)),
    crypto.subtle.digest('SHA-256', encodeur.encode(attendu)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = m ? 0 : 1;
  for (let i = 0; i < 32; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// --- Heure de Paris et règle de l'heure déjà passée (décision du 2026-11-14) ---
const formatParis = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function heureParis(date) {
  const p = Object.fromEntries(formatParis.formatToParts(date).map((x) => [x.type, x.value]));
  return `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// Fonction pure. Si l'heure actuelle (Paris) est dans [allumage, fin), le début écrit est l'heure
// actuelle et immediat vaut true ; sinon on écrit allumage. Tient compte du passage de minuit.
export function decider(allumage, fin, maintenant) {
  const nowHHMM = heureParis(maintenant);
  const a = minutes(allumage), f = minutes(fin), n = minutes(nowHHMM);
  const dedans = a < f ? n >= a && n < f : a > f ? n >= a || n < f : false;
  return dedans ? { debut: nowHHMM, immediat: true } : { debut: allumage, immediat: false };
}

// --- Valeur de la plage (même contrôles que tools/tuya-probe.mjs, formaterDebut) ---
export function lirePlage(valeur) {
  let obj;
  try { obj = JSON.parse(valeur); } catch { throw new ErreurService('tuya'); }
  const cles = obj && typeof obj === 'object' ? Object.keys(obj) : [];
  if (cles.join(',') !== CLES_PLAGE.join(',')) throw new ErreurService('tuya');
  if (typeof obj.ss !== 'string' || typeof obj.se !== 'string' || !HEURE_VALIDE.test(obj.ss) || !HEURE_VALIDE.test(obj.se)
    || !Number.isInteger(obj.dt) || !MODES_CONNUS.includes(obj.m)) throw new ErreurService('tuya');
  return obj;
}

// Ne change que ss et m. dt et se sont recopiés tels quels.
export function nouvellePlage(actuelle, debut) {
  return { ...actuelle, m: 2, ss: debut };
}

// --- Client Tuya ---
let cacheJeton = null; // { cle, valeur, expire }
export function reinitialiserCache() { cacheJeton = null; }

function configTuya(env) {
  if (!env.TUYA_ACCESS_ID || !env.TUYA_ACCESS_SECRET || !env.TUYA_DEVICE_ID) {
    console.error('configuration_incomplete');
    throw new ErreurService('tuya');
  }
  return { id: env.TUYA_ACCESS_ID, secret: env.TUYA_ACCESS_SECRET, device: env.TUYA_DEVICE_ID, endpoint: (env.TUYA_ENDPOINT || ENDPOINT_DEFAUT).replace(/\/+$/, '') };
}

function classer(code, msg) {
  if (CODES_HORS_LIGNE.has(code) || /offline/i.test(String(msg ?? ''))) return 'hors_ligne'; // le repli sur le texte est à confirmer
  if (CODES_ACCES.has(code)) return 'jeton';
  return 'tuya';
}

async function requeteTuya(cfg, deps, methode, chemin, { query = {}, corps = '', accessToken = '' } = {}) {
  const t = String(deps.now().getTime());
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const sign = await signer({ clientId: cfg.id, secret: cfg.secret, t, nonce, accessToken, methode, chemin, query, corps });
  const entetes = { client_id: cfg.id, t, nonce, sign_method: 'HMAC-SHA256', sign };
  if (accessToken) entetes.access_token = accessToken;
  if (corps) entetes['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), deps.delaiMs ?? DELAI_TUYA_MS);
  let json;
  try {
    const rep = await deps.fetch(cfg.endpoint + urlAvecParametres(chemin, query), { method: methode, headers: entetes, body: corps || undefined, signal: ctrl.signal });
    json = await rep.json();
  } catch (e) {
    if (e?.name === 'AbortError' || ctrl.signal.aborted) throw new ErreurService('delai');
    console.error('tuya_reseau_ou_reponse_illisible');
    throw new ErreurService('tuya');
  } finally {
    clearTimeout(minuteur);
  }
  if (!json || json.success !== true) {
    const code = Number(json?.code);
    if (CODES_JETON_EXPIRE.has(code)) throw new ErreurService('jeton_expire'); // interne, jamais renvoyé tel quel
    const type = classer(code, json?.msg);
    console.error('tuya_erreur', type, Number.isFinite(code) ? code : 'inconnu'); // code numérique seulement
    throw new ErreurService(type);
  }
  return json.result;
}

async function obtenirJeton(cfg, deps) {
  const maintenant = deps.now().getTime();
  if (cacheJeton && cacheJeton.cle === cfg.id && cacheJeton.expire > maintenant) return cacheJeton.valeur;
  let r;
  try {
    r = await requeteTuya(cfg, deps, 'GET', '/v1.0/token', { query: { grant_type: 1 } });
  } catch (e) {
    // Échec d'obtention du jeton : l'accès à l'API est en cause, sauf délai ou panne réseau.
    throw new ErreurService(e.code === 'delai' || e.code === 'tuya' ? e.code : 'jeton');
  }
  if (typeof r?.access_token !== 'string' || !(r.expire_time > 0)) throw new ErreurService('tuya');
  // Valable au plus expire_time secondes ; marge de 60 s (ou la moitié si la durée est courte).
  const dureeMs = r.expire_time * 1000;
  cacheJeton = { cle: cfg.id, valeur: r.access_token, expire: maintenant + dureeMs - Math.min(60_000, dureeMs / 2) };
  return r.access_token;
}

export async function appelerTuya(cfg, deps, methode, chemin, options = {}) {
  for (let essai = 0; ; essai++) {
    const accessToken = await obtenirJeton(cfg, deps);
    try {
      return await requeteTuya(cfg, deps, methode, chemin, { ...options, accessToken });
    } catch (e) {
      if (e.code !== 'jeton_expire') throw e;
      cacheJeton = null;
      if (essai >= 1) throw new ErreurService('jeton');
    }
  }
}

// Lecture du point de données de plage (chemin validé : docs/tuya-findings.md, T1).
async function lireValeurPlage(cfg, deps) {
  const r = await appelerTuya(cfg, deps, 'GET', `/v2.0/cloud/thing/${cfg.device}/shadow/properties`);
  const p = Array.isArray(r?.properties) ? r.properties.find((x) => x?.code === CODE_PLAGE) : null;
  if (!p || typeof p.value !== 'string') throw new ErreurService('tuya');
  return lirePlage(p.value);
}

async function ecrirePlage(cfg, deps, plage) {
  const corps = JSON.stringify({ properties: JSON.stringify({ [CODE_PLAGE]: JSON.stringify(plage) }) });
  await appelerTuya(cfg, deps, 'POST', `/v2.0/cloud/thing/${cfg.device}/shadow/properties/issue`, { corps });
}

const memePlage = (a, b) => CLES_PLAGE.every((k) => a[k] === b[k]);

const reponsePlage = (plage, extra = {}) => ({
  ok: true, debut: plage.ss, fin: plage.se, plage_active: plage.m === 2, ...extra,
});

async function etat(env, deps) {
  const cfg = configTuya(env);
  return reponsePlage(await lireValeurPlage(cfg, deps));
}

// Écrit voulue (seuls ss et m changent), relit, ne conclut au succès que si la relecture est conforme.
async function ecrireEtVerifier(cfg, deps, actuelle, voulue, extra = {}) {
  if (!memePlage(actuelle, voulue)) await ecrirePlage(cfg, deps, voulue);
  for (const attente of deps.attentes ?? ATTENTES_RELECTURE_MS) {
    await deps.sleep(attente);
    const relue = await lireValeurPlage(cfg, deps);
    if (memePlage(relue, voulue)) return reponsePlage(relue, extra);
  }
  console.error('relecture_differente');
  throw new ErreurService('relecture_differente');
}

async function programmer(env, deps, allumage) {
  const cfg = configTuya(env);
  const actuelle = await lireValeurPlage(cfg, deps);
  const { debut, immediat } = decider(allumage, actuelle.se, deps.now());
  return ecrireEtVerifier(cfg, deps, actuelle, nouvellePlage(actuelle, debut), immediat ? { immediat: true } : {});
}

// Fin de plage moins une minute (00:00 -> 23:59). Fonction pure, aucune heure en dur.
export function moinsUneMinute(hhmm) {
  const m = (minutes(hhmm) + 1439) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Plage courte : début = fin relue - 1 min, plage activée. Jamais de logique « heure déjà passée ».
async function desactiver(env, deps) {
  const cfg = configTuya(env);
  const actuelle = await lireValeurPlage(cfg, deps);
  return ecrireEtVerifier(cfg, deps, actuelle, nouvellePlage(actuelle, moinsUneMinute(actuelle.se)), { courte: true });
}

// --- Limite d'appels ---
// Mécanisme : binding Rate Limiting de Workers (env.LIMITEUR), voir docs/cloudflare-findings.md.
// Sans binding (wrangler dev local) : repli en mémoire par isolat, avec un avertissement,
// sauf si EXIGER_LIMITEUR vaut "1" (production) : la requête est alors refusée (503).
const appelsRepli = [];
let avertiSansLimiteur = false;
export function reinitialiserLimiteur() { appelsRepli.length = 0; avertiSansLimiteur = false; }

const limiteurPresent = (env) => Boolean(env.LIMITEUR) && typeof env.LIMITEUR.limit === 'function';

async function limiteAtteinte(env, deps) {
  if (limiteurPresent(env)) {
    const { success } = await env.LIMITEUR.limit({ key: 'service' });
    return !success;
  }
  if (!avertiSansLimiteur) {
    avertiSansLimiteur = true;
    console.warn('limiteur_absent : repli en memoire (30 appels/heure par instance), a ne pas utiliser en production');
  }
  const maintenant = deps.now().getTime();
  while (appelsRepli.length && appelsRepli[0] <= maintenant - REPLI_LIMITE.fenetreMs) appelsRepli.shift();
  if (appelsRepli.length >= REPLI_LIMITE.max) return true;
  appelsRepli.push(maintenant);
  return false;
}

// --- HTTP ---
function entetesCors(request, env) {
  const origine = request.headers.get('Origin');
  if (!origine || !env.ORIGINE_AUTORISEE || origine !== env.ORIGINE_AUTORISEE) return { Vary: 'Origin' };
  return { 'Access-Control-Allow-Origin': origine, Vary: 'Origin' };
}

function repondre(request, env, statut, corps, extra = {}) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetesCors(request, env), ...extra },
  });
}

const erreur = (request, env, code, statut = STATUTS[code] ?? 502) => repondre(request, env, statut, { ok: false, erreur: code });

// Valide le corps de POST /api/programmer : exactement {"allumage":"HH:MM"} ou {"desactiver":true}.
export function validerCorps(texte) {
  if (typeof texte !== 'string' || texte.length === 0 || texte.length > TAILLE_MAX_CORPS) return null;
  let obj;
  try { obj = JSON.parse(texte); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const cles = Object.keys(obj);
  if (cles.length !== 1) return null;
  if (cles[0] === 'allumage' && typeof obj.allumage === 'string' && HEURE_VALIDE.test(obj.allumage)) return { allumage: obj.allumage };
  if (cles[0] === 'desactiver' && obj.desactiver === true) return { desactiver: true };
  return null;
}

const ROUTES = { '/api/programmer': 'POST', '/api/etat': 'GET' };

export async function traiter(request, env, deps = {}) {
  deps = { fetch: (...a) => fetch(...a), now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), ...deps };
  const url = new URL(request.url);
  const methode = request.method;

  // Préflight CORS : ne touche ni Tuya ni aucune donnée ; seule l'origine autorisée est acceptée.
  if (methode === 'OPTIONS') {
    const cors = entetesCors(request, env);
    if (!cors['Access-Control-Allow-Origin'] || !(url.pathname in ROUTES)) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
  }

  // Jeton d'abord, avant toute autre logique.
  if (typeof env.JETON_ACCES !== 'string' || env.JETON_ACCES.length < LONGUEUR_MIN_JETON) console.error('configuration_incomplete');
  if (!(await jetonValide(request.headers.get('Authorization'), env.JETON_ACCES))) {
    return repondre(request, env, 401, { ok: false, erreur: 'non_autorise' }, { 'WWW-Authenticate': 'Bearer' });
  }
  // Production : sans limiteur, on refuse plutôt que de retomber sur le repli en mémoire.
  if (env.EXIGER_LIMITEUR === '1' && !limiteurPresent(env)) {
    console.error('limiteur_absent_exige');
    return erreur(request, env, 'tuya', 503);
  }
  let limite;
  try {
    limite = await limiteAtteinte(env, deps);
  } catch {
    // Panne du limiteur : réponse au format du contrat (la page affiche alors le mode manuel).
    console.error('limiteur_en_erreur');
    return erreur(request, env, 'tuya');
  }
  if (limite) {
    return repondre(request, env, 429, { ok: false, erreur: 'trop_de_requetes' }, { 'Retry-After': '60' });
  }

  const attendue = ROUTES[url.pathname];
  if (!attendue) return repondre(request, env, 404, { ok: false, erreur: 'introuvable' });
  if (methode !== attendue) return repondre(request, env, 405, { ok: false, erreur: 'methode_non_autorisee' }, { Allow: attendue });

  try {
    if (url.pathname === '/api/etat') return repondre(request, env, 200, await etat(env, deps));
    // Content-Length exigé et borné avant toute lecture du corps ; la taille est revérifiée après lecture.
    const cl = request.headers.get('Content-Length');
    if (cl === null || !/^[0-9]+$/.test(cl) || Number(cl) > TAILLE_MAX_CORPS) return repondre(request, env, 400, { ok: false, erreur: 'requete_invalide' });
    const corps = validerCorps(await request.text());
    if (!corps) return repondre(request, env, 400, { ok: false, erreur: 'requete_invalide' });
    return repondre(request, env, 200, corps.desactiver ? await desactiver(env, deps) : await programmer(env, deps, corps.allumage));
  } catch (e) {
    const code = e instanceof ErreurService && STATUTS[e.code] ? e.code : 'tuya';
    if (!(e instanceof ErreurService)) console.error('erreur_interne');
    return erreur(request, env, code);
  }
}
