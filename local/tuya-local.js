// Protocole local Tuya 3.5 et les deux actions du projet (lot C1 de la phase 3b).
// JavaScript pur, module ES : aucune importation, seulement globalThis.crypto (Web Crypto) ; il tourne à
// l'identique dans Node (essais, tests) et dans une WebView Android.
//
// Ce module n'exporte QUE deux fonctions (règle n°9 : jamais d'envoi de commande quelconque) :
//   lireEtat(cfg, transport)                                          -> { ok, debut, fin, plage_active } | { ok:false, erreur }
//   programmer(cfg, transport, { allumage:"HH:MM" } | { desactiver:true }) -> idem, plus immediat | courte
//
// Garanties (mêmes que worker/src/service.js) :
// - n'écrit que ss et m du dp 151 (x_charge_mode) ; jamais dt, se, le courant ni un autre point ;
// - relit avant d'écrire : objet aux clés exactes m, dt, ss, se, heures valides, mode connu, sinon RIEN n'est envoyé ;
// - relit après l'écriture : succès seulement si le dp 151 relu est celui demandé et qu'aucun autre point non volatil a changé ;
// - une seule connexion, fermée dans tous les cas ; échéance globale de 20 s ; la clé n'apparaît dans aucun message.
//
// cfg = { ip, deviceId, cleLocale, version: "3.5" }. Champs facultatifs, pour les tests : aleas { octets(n) },
// maintenant() -> Date, pause(ms) -> Promise, attentes [ms], delaiGlobalMs, simuler (true : tout sauf l'écriture).
//
// Transport fourni par l'appelant : ouvrir(ip, port, delaiMs) · envoyer(octets) · recevoir(delaiMs) -> octets · fermer().
// Erreurs du transport : objet Error dont .code vaut "hors_ligne" (connexion impossible), "delai" (rien reçu à temps)
// ou "ferme" (connexion fermée par le câble). Tout autre échec du transport est traité comme "hors_ligne".
//
// Protocole : reprise de tinytuya 1.21.1 (tinytuya/core/*.py), détail dans docs/tuya-findings.md (section « lot C1 »).

const PORT = 6668;
const DELAI_GLOBAL_MS = 20_000;
const DELAI_CONNEXION_MS = 5_000;
const DELAI_TRAME_MS = 5_000;
const DELAI_ACCUSE_MS = 2_000;
const ATTENTES_RELECTURE_MS = [500, 1500, 2500];
const LONGUEUR_MAX = 1440; // core/const.py : MAX_PAYLOAD_LENGTH

// core/command_types.py
const CMD_NEG_DEBUT = 3; // SESS_KEY_NEG_START
const CMD_NEG_REPONSE = 4; // SESS_KEY_NEG_RESP
const CMD_NEG_FIN = 5; // SESS_KEY_NEG_FINISH
const CMD_ECRITURE = 0x0d; // CONTROL_NEW (la seule commande d'écriture envoyée par ce module)
const CMD_LECTURE = 0x10; // DP_QUERY_NEW

const DP_PLAGE = '151'; // x_charge_mode (docs/tuya-findings.md, T2)
const DP_VOLATILS = new Set(['101', '102', '105', '109']); // mêmes que tools/tuya-local-test.py
const CLES_PLAGE = ['m', 'dt', 'ss', 'se'];
const MODES_CONNUS = [0, 2]; // 2 = plage active, 0 = charge immédiate
const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

class ErreurLocale extends Error {
  constructor(code) { super(code); this.code = code; }
}

// --- Octets ---
function concat(...tableaux) {
  const out = new Uint8Array(tableaux.reduce((n, t) => n + t.length, 0));
  let i = 0;
  for (const t of tableaux) { out.set(t, i); i += t.length; }
  return out;
}
const u32 = (b, i) => new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0, false);
function ecrireU32(vue, i, n) { vue.setUint32(i, n, false); }
function egaux(a, b) { // comparaison en temps constant (longueurs publiques)
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
// tinytuya : local_key.encode("latin1"). Une clé qui n'a pas 16 octets est refusée (XenonDevice._get_socket).
function cleEnOctets(cle) {
  if (typeof cle !== 'string' || cle.length !== 16) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const c = cle.charCodeAt(i);
    if (c > 255) return null;
    out[i] = c;
  }
  return out;
}

// --- Web Crypto ---
const sub = () => globalThis.crypto.subtle;
async function cleGcm(cle) { return sub().importKey('raw', cle, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
async function hmacSha256(cle, donnees) {
  const k = await sub().importKey('raw', cle, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await sub().sign('HMAC', k, donnees));
}

// --- Trames 6699 (core/message_helper.py : pack_message, parse_header, unpack_message ; core/header.py) ---
// En-tête de 18 octets (">IHIII" : préfixe 0x00006699, 0, numéro de séquence, commande, longueur), puis
// IV (12) + chiffré + étiquette GCM (16), puis le pied 0x00009966. L'AAD du GCM est l'en-tête sans le préfixe
// (14 octets). La longueur vaut 12 + taille du clair + 16. Le clair d'une trame reçue commence par un code
// de retour de 4 octets ; celui d'une trame envoyée n'en a pas.
const PREFIXE = [0x00, 0x00, 0x66, 0x99];
const PIED = [0x00, 0x00, 0x99, 0x66];
const TAILLE_ENTETE = 18;

async function empaqueter(cle, seq, cmd, clair, iv) {
  const entete = new Uint8Array(TAILLE_ENTETE);
  entete.set(PREFIXE, 0);
  const v = new DataView(entete.buffer);
  ecrireU32(v, 6, seq);
  ecrireU32(v, 10, cmd);
  ecrireU32(v, 14, clair.length + 16 + 12);
  const k = await cleGcm(cle);
  const chiffre = new Uint8Array(await sub().encrypt(
    { name: 'AES-GCM', iv, additionalData: entete.subarray(4), tagLength: 128 }, k, clair)); // chiffré + étiquette
  return concat(entete, iv, chiffre, Uint8Array.from(PIED));
}

async function depaqueter(cle, trame) {
  const longueur = u32(trame, 14);
  const iv = trame.subarray(TAILLE_ENTETE, TAILLE_ENTETE + 12);
  const chiffre = trame.subarray(TAILLE_ENTETE + 12, TAILLE_ENTETE + longueur); // chiffré + étiquette
  let clair;
  try {
    const k = await cleGcm(cle);
    clair = new Uint8Array(await sub().decrypt(
      { name: 'AES-GCM', iv, additionalData: trame.subarray(4, TAILLE_ENTETE), tagLength: 128 }, k, chiffre));
  } catch {
    throw new ErreurLocale('cle'); // étiquette refusée : clé fausse, câble réappairé ou trame altérée
  }
  if (clair.length < 4) throw new ErreurLocale('format');
  return { seq: u32(trame, 6), cmd: u32(trame, 10), retcode: u32(clair, 0), payload: clair.subarray(4) };
}

// Extrait une trame complète du tampon, ou null s'il en manque. Se recale sur le préfixe (XenonDevice._receive).
function extraireTrame(ctx) {
  let b = ctx.tampon;
  let i = -1;
  for (let j = 0; j + 4 <= b.length; j++) {
    if (b[j] === PREFIXE[0] && b[j + 1] === PREFIXE[1] && b[j + 2] === PREFIXE[2] && b[j + 3] === PREFIXE[3]) { i = j; break; }
  }
  if (i < 0) { ctx.tampon = b.slice(Math.max(0, b.length - 3)); return null; }
  if (i > 0) b = b.slice(i);
  ctx.tampon = b;
  if (b.length < TAILLE_ENTETE) return null;
  const longueur = u32(b, 14);
  if (longueur < 12 + 16 || longueur > LONGUEUR_MAX) throw new ErreurLocale('format');
  const total = TAILLE_ENTETE + longueur + 4;
  if (b.length < total) return null;
  const trame = b.slice(0, total);
  ctx.tampon = b.slice(total);
  if (!egaux(trame.subarray(total - 4), Uint8Array.from(PIED))) throw new ErreurLocale('format');
  return trame;
}

// --- Transport ---
function erreurTransport(e) {
  const c = e && e.code;
  return new ErreurLocale(c === 'delai' || c === 'ferme' || c === 'hors_ligne' ? c : 'hors_ligne');
}

function tempsRestant(ctx) {
  const r = ctx.echeance - ctx.horloge();
  if (!(r > 0) || ctx.annule) throw new ErreurLocale('delai');
  return r;
}

async function envoyerTrame(ctx, cmd, clair) {
  tempsRestant(ctx);
  const trame = await empaqueter(ctx.cleActive, ctx.seq++, cmd, clair, ctx.aleas.octets(12));
  try { await ctx.transport.envoyer(trame); } catch (e) { throw erreurTransport(e); }
}

// Attend une trame que filtre(msg) accepte ; les autres (annonces d'état, accusés) sont ignorées.
async function attendreTrame(ctx, filtre, delaiMs = DELAI_TRAME_MS) {
  const limite = ctx.horloge() + delaiMs;
  for (;;) {
    let trame = extraireTrame(ctx);
    while (trame) {
      const msg = await depaqueter(ctx.cleActive, trame);
      if (filtre(msg)) return msg;
      trame = extraireTrame(ctx);
    }
    const attente = Math.min(tempsRestant(ctx), limite - ctx.horloge());
    if (!(attente > 0)) throw new ErreurLocale('delai');
    let morceau;
    try { morceau = await ctx.transport.recevoir(attente); } catch (e) { throw erreurTransport(e); }
    if (!(morceau instanceof Uint8Array) || morceau.length === 0) throw new ErreurLocale('ferme');
    ctx.tampon = concat(ctx.tampon, morceau);
  }
}

// --- Négociation de la clé de session (XenonDevice._negotiate_session_key*, version 3.5) ---
// 1. nous : cmd 3, 16 octets aléatoires (nonce local), chiffré avec la clé locale.
// 2. câble : cmd 4, nonce du câble (16) + HMAC-SHA256(clé locale, nonce local) (32). Nous vérifions le HMAC.
// 3. nous : cmd 5, HMAC-SHA256(clé locale, nonce du câble) ; pas de réponse attendue.
// 4. clé de session = AES-GCM(clé locale, IV = 12 premiers octets du nonce local, sans AAD) appliqué à
//    (nonce local XOR nonce du câble) ; on garde les 16 premiers octets du chiffré (l'étiquette est jetée).
async function negocier(ctx) {
  const nonce = ctx.aleas.octets(16);
  ctx.cleActive = ctx.cleLocale;
  ctx.phase = 'negociation';
  await envoyerTrame(ctx, CMD_NEG_DEBUT, nonce);
  const rep = await attendreTrame(ctx, (m) => m.cmd === CMD_NEG_REPONSE);
  if (rep.payload.length < 48) throw new ErreurLocale('cle');
  const nonceCable = rep.payload.slice(0, 16);
  if (!egaux(await hmacSha256(ctx.cleLocale, nonce), rep.payload.subarray(16, 48))) throw new ErreurLocale('cle');
  await envoyerTrame(ctx, CMD_NEG_FIN, await hmacSha256(ctx.cleLocale, nonceCable));
  const xor = nonce.map((x, i) => x ^ nonceCable[i]);
  const k = await cleGcm(ctx.cleLocale);
  const chiffre = new Uint8Array(await sub().encrypt({ name: 'AES-GCM', iv: nonce.subarray(0, 12), tagLength: 128 }, k, xor));
  ctx.cleActive = chiffre.slice(0, 16);
  ctx.phase = 'session';
}

// --- Lecture des points de données (cmd 0x10 « DP_QUERY_NEW », corps « {} », sans en-tête de version) ---
async function lireDps(ctx) {
  await envoyerTrame(ctx, CMD_LECTURE, enc.encode('{}'));
  const msg = await attendreTrame(ctx, (m) => m.cmd === CMD_LECTURE && m.payload.length > 0);
  let p = msg.payload;
  if (p.length >= 3 && p[0] === 0x33 && p[1] === 0x2e && p[2] === 0x35) p = p.subarray(15); // « 3.5 » + 12 zéros (_decode_payload)
  let json;
  try { json = JSON.parse(dec.decode(p)); } catch { throw new ErreurLocale('format'); }
  const dps = json && typeof json === 'object' ? (json.dps ?? json.data?.dps) : null;
  if (!dps || typeof dps !== 'object' || Array.isArray(dps)) throw new ErreurLocale('format');
  return dps;
}

// --- Plage de charge (mêmes contrôles que worker/src/service.js, lirePlage) ---
function lirePlage(valeur) {
  let obj;
  try { obj = JSON.parse(valeur); } catch { throw new ErreurLocale('format'); }
  const cles = obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : [];
  if (cles.join(',') !== CLES_PLAGE.join(',')) throw new ErreurLocale('format');
  if (typeof obj.ss !== 'string' || typeof obj.se !== 'string' || !HEURE_VALIDE.test(obj.ss) || !HEURE_VALIDE.test(obj.se)
    || !Number.isInteger(obj.dt) || !MODES_CONNUS.includes(obj.m)) throw new ErreurLocale('format');
  return obj;
}
const plageDepuisDps = (dps) => {
  if (typeof dps[DP_PLAGE] !== 'string') throw new ErreurLocale('format');
  return lirePlage(dps[DP_PLAGE]);
};
const memePlage = (a, b) => CLES_PLAGE.every((k) => a[k] === b[k]);

// --- Heure de Paris et règle de l'heure déjà passée (même règle que le Worker, décision du 2026-11-14) ---
const formatParis = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function heureParis(date) {
  const p = Object.fromEntries(formatParis.formatToParts(date).map((x) => [x.type, x.value]));
  return `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
function decider(allumage, fin, maintenant) {
  const nowHHMM = heureParis(maintenant);
  const a = minutes(allumage), f = minutes(fin), n = minutes(nowHHMM);
  const dedans = a < f ? n >= a && n < f : a > f ? n >= a || n < f : false;
  return dedans ? { debut: nowHHMM, immediat: true } : { debut: allumage, immediat: false };
}
function moinsUneMinute(hhmm) {
  const m = (minutes(hhmm) + 1439) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// --- Écriture : la SEULE construction d'une commande d'écriture du module ---
// Corps tinytuya (payload_dict « v3.5 », CONTROL -> CONTROL_NEW) : {"protocol":5,"t":<secondes>,"data":{"dps":{"151":"<texte JSON>"}}},
// sans espaces, précédé de l'en-tête de version « 3.5 » + 12 zéros (hors NO_PROTOCOL_HEADER_CMDS).
// Garde-fou : on n'envoie que le dp 151, et la valeur ne peut différer de la valeur relue que par ss et m.
function corpsEcriture(actuelle, debut, t) {
  const voulue = { m: 2, dt: actuelle.dt, ss: debut, se: actuelle.se };
  // dt et se sont recopiés de la valeur relue (contrôlée par le lecteur) : seuls ss et m peuvent changer.
  if (!HEURE_VALIDE.test(voulue.ss) || !HEURE_VALIDE.test(voulue.se)) {
    throw new ErreurLocale('format');
  }
  const json = JSON.stringify({ protocol: 5, t, data: { dps: { [DP_PLAGE]: JSON.stringify(voulue) } } });
  const entete = new Uint8Array(15);
  entete.set([0x33, 0x2e, 0x35], 0);
  return { voulue, clair: concat(entete, enc.encode(json)) };
}

const reponsePlage = (plage, extra = {}) => ({ ok: true, debut: plage.ss, fin: plage.se, plage_active: plage.m === 2, ...extra });

function autresPointsModifies(avant, apres) {
  for (const k of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
    if (k === DP_PLAGE || DP_VOLATILS.has(k)) continue;
    if (JSON.stringify(avant[k]) !== JSON.stringify(apres[k])) return true;
  }
  return false;
}

// --- Cadre commun : validation, connexion unique, échéance globale, fermeture dans tous les cas ---
const pauseParDefaut = (ms) => new Promise((r) => setTimeout(r, ms));

async function executer(cfg, transport, travail) {
  const cle = cleEnOctets(cfg?.cleLocale);
  if (!cle) return { ok: false, erreur: 'cle' };
  if (cfg.version !== undefined && cfg.version !== '3.5') return { ok: false, erreur: 'format' }; // seul le 3.5 est pris en charge
  if (typeof cfg.ip !== 'string' || !cfg.ip) return { ok: false, erreur: 'hors_ligne' };
  const horloge = () => Date.now();
  const delaiGlobal = cfg.delaiGlobalMs ?? DELAI_GLOBAL_MS;
  const ctx = {
    transport, cfg, cleLocale: cle, cleActive: cle, seq: 1, tampon: new Uint8Array(0), phase: 'negociation',
    horloge, echeance: horloge() + delaiGlobal, annule: false,
    aleas: cfg.aleas ?? { octets: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) },
    pause: cfg.pause ?? pauseParDefaut,
    maintenant: cfg.maintenant ?? (() => new Date()),
  };
  let minuteur;
  const echeance = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => { ctx.annule = true; rejeter(new ErreurLocale('delai')); }, delaiGlobal);
  });
  const tache = (async () => {
    try { await transport.ouvrir(cfg.ip, PORT, Math.min(DELAI_CONNEXION_MS, delaiGlobal)); } catch (e) { throw erreurTransport(e); }
    try { await negocier(ctx); } catch (e) {
      // Connexion fermée par le câble pendant la négociation : clé refusée (hypothèse tinytuya ERR_KEY_OR_VER, à confirmer en réel).
      throw e instanceof ErreurLocale && e.code === 'ferme' ? new ErreurLocale('cle') : e;
    }
    ctx.phase = 'session';
    return travail(ctx);
  })();
  tache.catch(() => {}); // une rejection tardive (après échéance) ne doit pas remonter
  try {
    return await Promise.race([tache, echeance]);
  } catch (e) {
    // Seul le code est renvoyé : jamais le message d'une exception (la clé n'apparaît nulle part).
    const code = e instanceof ErreurLocale ? e.code : 'format';
    // Après l'envoi de l'écriture, toute panne (connexion coupée, écran éteint, clé, format) laisse le câble dans un
    // état inconnu : « delai » (incertain, vérifier dans Smart Life), jamais un code qui dirait « rien n'a été modifié ».
    // « ecrit » dit à l'appelant si l'écriture est partie : il ne doit JAMAIS relancer une écriture qui a pu être appliquée.
    if (ctx.ecrit) return { ok: false, erreur: code === 'relecture_differente' ? code : 'delai', ecrit: true };
    return { ok: false, erreur: code === 'ferme' ? 'hors_ligne' : code };
  } finally {
    clearTimeout(minuteur);
    ctx.annule = true;
    try { await Promise.resolve(transport.fermer()); } catch { /* rien à faire */ }
  }
}

// --- Les deux fonctions exposées ---
export async function lireEtat(cfg, transport) {
  return executer(cfg, transport, async (ctx) => reponsePlage(plageDepuisDps(await lireDps(ctx))));
}

function validerAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const cles = Object.keys(action);
  if (cles.length !== 1) return null;
  if (cles[0] === 'allumage' && typeof action.allumage === 'string' && HEURE_VALIDE.test(action.allumage)) return { allumage: action.allumage };
  if (cles[0] === 'desactiver' && action.desactiver === true) return { desactiver: true };
  return null;
}

export async function programmer(cfg, transport, action) {
  const demande = validerAction(action);
  if (!demande) return { ok: false, erreur: 'requete_invalide' };
  return executer(cfg, transport, async (ctx) => {
    const avant = await lireDps(ctx);
    const actuelle = plageDepuisDps(avant); // format inattendu : on s'arrête ici, rien n'est envoyé
    let debut, extra;
    if (demande.desactiver) {
      debut = moinsUneMinute(actuelle.se);
      extra = { courte: true };
    } else {
      const d = decider(demande.allumage, actuelle.se, ctx.maintenant());
      debut = d.debut;
      extra = d.immediat ? { immediat: true } : {};
    }
    const t = Math.floor(ctx.maintenant().getTime() / 1000);
    const { voulue, clair } = corpsEcriture(actuelle, debut, t);
    if (ctx.cfg.simuler === true) return { ok: true, simulation: true, actuelle: reponsePlage(actuelle), a_ecrire: reponsePlage(voulue, extra) };
    if (memePlage(actuelle, voulue)) return reponsePlage(actuelle, extra); // déjà réglé : rien à envoyer

    ctx.ecrit = true; // à partir d'ici, l'écriture a pu être appliquée même si la suite échoue
    await envoyerTrame(ctx, CMD_ECRITURE, clair);
    // Accusé du câble (cmd 0x0d) : sa forme exacte est à confirmer en réel ; son absence n'est pas une erreur,
    // c'est la relecture qui décide.
    try { await attendreTrame(ctx, (m) => m.cmd === CMD_ECRITURE, DELAI_ACCUSE_MS); } catch (e) {
      if (!(e instanceof ErreurLocale) || e.code !== 'delai' || ctx.annule || ctx.echeance - ctx.horloge() <= 0) throw e;
    }

    for (const attente of ctx.cfg.attentes ?? ATTENTES_RELECTURE_MS) {
      if (attente >= tempsRestant(ctx)) throw new ErreurLocale('delai'); // plus le temps de relire : résultat incertain
      await ctx.pause(attente);
      const apres = await lireDps(ctx);
      const relue = plageDepuisDps(apres);
      if (memePlage(relue, voulue)) {
        if (autresPointsModifies(avant, apres)) throw new ErreurLocale('relecture_differente');
        return reponsePlage(relue, extra);
      }
    }
    throw new ErreurLocale('relecture_differente');
  });
}
