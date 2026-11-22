// Logique du Worker Cloudflare de programmation (phase 2b). Module ES, Web Crypto et fetch seulement.
// Point d'entrée : index.js. Ce module peut exporter des fonctions et constantes (tests) ;
// le module principal, lui, ne doit exporter que le gestionnaire (chaque export y est un point d'entrée).
// Routes : POST /api/programmer, GET /api/etat, OPTIONS (CORS). Tout le reste : 404.
// Il n'agit que sur env.TUYA_DEVICE_ID et n'écrit que la plage de charge (x_charge_mode : ss, se et m, règle 9
// élargie le 2026-11-22). Jamais dt, courant, x_do_charge, ni une programmation Smart Life.
// Chemins et formats validés sur le câble : voir docs/tuya-findings.md.

export const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CODE_PLAGE = 'x_charge_mode';
const CLES_PLAGE = ['m', 'dt', 'ss', 'se'];
const MODES_CONNUS = [0, 2]; // 2 = plage active, 0 = désactivée (= charge immédiate sur ce câble)
const ENDPOINT_DEFAUT = 'https://openapi.tuyaeu.com';
const DELAI_TUYA_MS = 10_000;
// Durée totale d'une requête (tous les appels Tuya et attentes de relecture) : le Worker répond
// « delai » avant que la page n'abandonne (25 s, site/service.js), au lieu d'un faux échec.
const ECHEANCE_MS = 20_000;
const TAILLE_MAX_CORPS = 512;
const LONGUEUR_MIN_JETON = 32; // en dessous, le jeton est jugé trop faible : tout est refusé
// Relecture après écriture : le câble met quelques secondes à répercuter (la sonde attendait 5 s).
const ATTENTES_RELECTURE_MS = [1500, 2000, 2500];
// Limite horaire (SECURITE.md, mesure 5) : appliquée toujours, en plus du binding Cloudflare
// (qui ne permet que des périodes de 10 ou 60 s). En mémoire, par isolat, donc approximative.
const REPLI_LIMITE = { max: 30, fenetreMs: 3_600_000 };

// Codes d'erreur Tuya, source : https://developer.tuya.com/en/docs/iot/error-code?id=K989ruxx88swc
// (documentation lue le 2026-11-14, jamais observés en réel sauf 1106 : voir docs/tuya-findings.md).
const CODES_JETON_EXPIRE = new Set([1010, 1011, 1012, 1400]); // jeton expiré ou invalide : on en redemande un
const CODES_ACCES = new Set([1004, 1013, 1106, 60009001, 28841002, 28841102, 28841105]); // -> « jeton »
const CODES_HORS_LIGNE = new Set([2001, 40000801]);

const STATUTS = {
  hors_ligne: 502, jeton: 502, tuya: 502, relecture_differente: 502, delai: 504, trop_tard: 409,
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

// --- Heure de Paris et règle du démarrage tardif (décision du 2026-11-22) ---
const formatParis = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function heureParis(date) {
  const p = Object.fromEntries(formatParis.formatToParts(date).map((x) => [x.type, x.value]));
  return `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const mod24 = (x) => ((x % 1440) + 1440) % 1440;
const formater = (total) => `${String(Math.floor(mod24(total) / 60)).padStart(2, '0')}:${String(mod24(total) % 60).padStart(2, '0')}`;

export const DUREE_MIN_MAX = 900; // durée de charge demandée : 1 à 900 minutes
export const MARGE_TARDIF_MIN = 10; // un début qui tombe dans moins de 10 minutes est reporté à maintenant + 10 min

// Demande de programmation : { allumage, fin, duree_min, depart }. Tout est revalidé ici (formats, durée entière 1..900,
// et fin comprise entre l'allumage (exclu) et le départ (inclus), en heures murales, minuit compris).
export function validerDemande(d) {
  if (!d || typeof d !== 'object') return false;
  if (![d.allumage, d.fin, d.depart].every((h) => typeof h === 'string' && HEURE_VALIDE.test(h))) return false;
  if (!Number.isInteger(d.duree_min) || d.duree_min < 1 || d.duree_min > DUREE_MIN_MAX) return false;
  const a = minutes(d.allumage);
  const nuit = mod24(minutes(d.depart) - a); // de l'allumage au départ
  const jusquaFin = mod24(minutes(d.fin) - a);
  return nuit > 0 && jusquaFin > 0 && jusquaFin <= nuit;
}

// Minutes depuis minuit (heure murale de Paris), arrondies à la minute SUPÉRIEURE : 23:50:20 -> 23:51.
function minutesParisSuperieures(date) {
  const [h, m] = heureParis(date).split(':').map(Number);
  const reste = date.getUTCSeconds() > 0 || date.getUTCMilliseconds() > 0 ? 1 : 0; // les fuseaux de Paris sont à la minute pile
  return mod24(h * 60 + m + reste);
}

// Fonction pure, appliquée AU MOMENT DE L'ENVOI. Raisonne en heure murale de Paris : la plage se répète chaque nuit, il n'y a pas
// de date. Les nuits de changement d'heure sont traitées en minutes murales, sans viser l'exactitude (60 min d'écart possibles).
//  - 'normal'    : écrire l'allumage et la fin demandés ;
//  - 'tardif'    : l'allumage est passé (maintenant est entre l'allumage et le départ) ou tombe dans moins de 10 min :
//                  début = maintenant + 10 min, fin = min(début + durée, départ) ;
//  - 'trop_tard' : début >= départ, rien n'est écrit ;
//  - 'invalide'  : demande refusée.
export function deciderPlage(demande, maintenant) {
  if (!validerDemande(demande)) return { statut: 'invalide' };
  const a = minutes(demande.allumage);
  const n = minutesParisSuperieures(maintenant);
  const nuit = mod24(minutes(demande.depart) - a);
  const dansLaNuit = mod24(n - a) < nuit; // allumage déjà passé, départ pas encore atteint
  if (!dansLaNuit && mod24(a - n) >= MARGE_TARDIF_MIN) return { statut: 'normal', debut: demande.allumage, fin: demande.fin };
  const avantDepart = mod24(minutes(demande.depart) - n); // minutes jusqu'au prochain départ
  if (avantDepart <= MARGE_TARDIF_MIN) return { statut: 'trop_tard' };
  return { statut: 'tardif', debut: formater(n + MARGE_TARDIF_MIN), fin: formater(n + Math.min(MARGE_TARDIF_MIN + demande.duree_min, avantDepart)) };
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

// Ne change que m, ss et se (la fin est écrite à chaque fois : la plage se répète). dt est recopié tel quel.
export function nouvellePlage(actuelle, debut, fin = actuelle.se) {
  return { ...actuelle, m: 2, ss: debut, se: fin };
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

// Temps restant avant l'échéance globale de la requête ; « delai » s'il est épuisé.
function tempsRestant(deps) {
  const restant = deps.echeance - deps.horloge();
  if (!(restant > 0)) throw new ErreurService('delai');
  return restant;
}

async function requeteTuya(cfg, deps, methode, chemin, { query = {}, corps = '', accessToken = '' } = {}) {
  const delai = Math.min(deps.delaiMs ?? DELAI_TUYA_MS, tempsRestant(deps));
  const t = String(deps.now().getTime());
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const sign = await signer({ clientId: cfg.id, secret: cfg.secret, t, nonce, accessToken, methode, chemin, query, corps });
  const entetes = { client_id: cfg.id, t, nonce, sign_method: 'HMAC-SHA256', sign };
  if (accessToken) entetes.access_token = accessToken;
  if (corps) entetes['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delai);
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

// Écrit voulue (seuls m, ss et se changent), relit, ne conclut au succès que si la relecture est conforme.
async function ecrireEtVerifier(cfg, deps, actuelle, voulue, extra = {}) {
  if (!memePlage(actuelle, voulue)) await ecrirePlage(cfg, deps, voulue);
  for (const attente of deps.attentes ?? ATTENTES_RELECTURE_MS) {
    if (attente >= tempsRestant(deps)) throw new ErreurService('delai'); // plus le temps de relire : résultat incertain
    await deps.sleep(attente);
    const relue = await lireValeurPlage(cfg, deps);
    if (memePlage(relue, voulue)) return reponsePlage(relue, extra);
  }
  console.error('relecture_differente');
  throw new ErreurService('relecture_differente');
}

async function programmer(env, deps, demande) {
  const cfg = configTuya(env);
  const actuelle = await lireValeurPlage(cfg, deps);
  const d = deciderPlage(demande, deps.now()); // heure prise au moment de l'envoi, après la lecture
  if (d.statut === 'trop_tard') throw new ErreurService('trop_tard'); // rien n'est écrit
  if (d.statut !== 'normal' && d.statut !== 'tardif') throw new ErreurService('tuya'); // invalide : déjà refusé par validerCorps
  return ecrireEtVerifier(cfg, deps, actuelle, nouvellePlage(actuelle, d.debut, d.fin), { tardif: d.statut === 'tardif' });
}

// Fin de plage moins une minute (00:00 -> 23:59). Fonction pure, aucune heure en dur.
export function moinsUneMinute(hhmm) {
  const m = (minutes(hhmm) + 1439) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Plage courte : début = fin relue - 1 min, plage activée ; la fin relue est réécrite telle quelle. Jamais de logique « tardif ».
async function desactiver(env, deps) {
  const cfg = configTuya(env);
  const actuelle = await lireValeurPlage(cfg, deps);
  return ecrireEtVerifier(cfg, deps, actuelle, nouvellePlage(actuelle, moinsUneMinute(actuelle.se), actuelle.se), { tardif: false, courte: true });
}

// --- Limite d'appels ---
// Mécanisme : binding Rate Limiting de Workers (env.LIMITEUR), voir docs/cloudflare-findings.md.
// Toujours : 30 appels par heure en mémoire, par isolat. Sans binding (wrangler dev local) : avertissement,
// sauf si EXIGER_LIMITEUR vaut "1" (production) : la requête est alors refusée (503).
const appelsRepli = [];
let avertiSansLimiteur = false;
export function reinitialiserLimiteur() { appelsRepli.length = 0; avertiSansLimiteur = false; }

const limiteurPresent = (env) => Boolean(env.LIMITEUR) && typeof env.LIMITEUR.limit === 'function';

async function limiteAtteinte(env, deps) {
  if (limiteurPresent(env)) {
    const { success } = await env.LIMITEUR.limit({ key: 'service' });
    if (!success) return true;
  } else if (!avertiSansLimiteur) {
    avertiSansLimiteur = true;
    console.warn('limiteur_absent : limite en memoire seule (30 appels/heure par instance), a ne pas utiliser en production');
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

// Valide le corps de POST /api/programmer : exactement {"allumage":"HH:MM","fin":"HH:MM","duree_min":<entier 1..900>,"depart":"HH:MM"}
// (fin comprise entre l'allumage et le départ), ou {"desactiver":true}.
export function validerCorps(texte) {
  if (typeof texte !== 'string' || texte.length === 0 || texte.length > TAILLE_MAX_CORPS) return null;
  let obj;
  try { obj = JSON.parse(texte); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const cles = Object.keys(obj).sort().join(',');
  if (cles === 'desactiver' && obj.desactiver === true) return { desactiver: true };
  if (cles === 'allumage,depart,duree_min,fin' && validerDemande(obj)) {
    return { allumage: obj.allumage, fin: obj.fin, duree_min: obj.duree_min, depart: obj.depart };
  }
  return null;
}

const ROUTES = { '/api/programmer': 'POST', '/api/etat': 'GET' };

export async function traiter(request, env, deps = {}) {
  deps = { fetch: (...a) => fetch(...a), now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), horloge: () => Date.now(), ...deps };
  deps.echeance = deps.horloge() + (deps.echeanceMs ?? ECHEANCE_MS);
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
    return repondre(request, env, 200, corps.desactiver ? await desactiver(env, deps) : await programmer(env, deps, corps));
  } catch (e) {
    const code = e instanceof ErreurService && STATUTS[e.code] ? e.code : 'tuya';
    if (!(e instanceof ErreurService)) console.error('erreur_interne');
    return erreur(request, env, code);
  }
}
