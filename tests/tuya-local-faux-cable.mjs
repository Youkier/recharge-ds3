// Faux câble Tuya 3.5 pour les tests de local/tuya-local.js : un transport simulé qui joue le rôle du câble.
// Écrit indépendamment du module (même protocole, réimplémenté côté câble) ; son exactitude est elle-même
// vérifiée contre les trames fabriquées par tinytuya (tests/tuya-local-vecteurs.json). Clé et identifiants factices.

const sub = globalThis.crypto.subtle;
const enc = new TextEncoder();

export const hex = (u8) => Buffer.from(u8).toString('hex');
export const deHex = (s) => new Uint8Array(Buffer.from(s, 'hex'));
const concat = (...t) => { const o = new Uint8Array(t.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of t) { o.set(x, i); i += x.length; } return o; };
const u32 = (b, i) => new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0, false);

const gcm = (cle) => sub.importKey('raw', cle, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
async function hmac(cle, d) {
  const k = await sub.importKey('raw', cle, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await sub.sign('HMAC', k, d));
}

export async function empaqueterCable(cle, seq, cmd, clairSansRetcode, iv, retcode = 0) {
  const clair = concat(new Uint8Array(new Uint32Array([0]).buffer), clairSansRetcode);
  new DataView(clair.buffer).setUint32(0, retcode, false);
  const entete = new Uint8Array(18);
  entete.set([0, 0, 0x66, 0x99], 0);
  const v = new DataView(entete.buffer);
  v.setUint32(6, seq, false); v.setUint32(10, cmd, false); v.setUint32(14, clair.length + 28, false);
  const ch = new Uint8Array(await sub.encrypt({ name: 'AES-GCM', iv, additionalData: entete.subarray(4), tagLength: 128 }, await gcm(cle), clair));
  return concat(entete, iv, ch, Uint8Array.from([0, 0, 0x99, 0x66]));
}

async function lireTrameClient(cle, trame) {
  const lg = u32(trame, 14);
  const clair = new Uint8Array(await sub.decrypt(
    { name: 'AES-GCM', iv: trame.subarray(18, 30), additionalData: trame.subarray(4, 18), tagLength: 128 },
    await gcm(cle), trame.subarray(30, 18 + lg)));
  return { seq: u32(trame, 6), cmd: u32(trame, 10), clair };
}

const aleatoire = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/**
 * opts.cle         clé réelle du câble (16 caractères)
 * opts.dps         points de données initiaux (copiés)
 * opts.nonceCable, opts.iv (fonction n -> octets) : aléas fixés (facultatif)
 * opts.cleFausse   si la trame 1 ne se déchiffre pas : "repondre" (défaut), "fermer" ou "silence"
 * opts.silenceLecture  ne répond jamais à la lecture
 * opts.ignorerEcriture l'écriture est acceptée mais sans effet
 * opts.transformerEcriture(valeur151) -> valeur réellement appliquée
 * opts.effetsEcriture  { dp: valeur } appliqués en plus à l'écriture (autre point modifié)
 * opts.formatLecture   "dps" (défaut) | "data" | "entete" (corps précédé de « 3.5 » + 12 zéros)
 * opts.decouper        coupe chaque trame envoyée en deux morceaux
 * opts.grouper         regroupe toutes les trames d'une réponse en un seul morceau
 * opts.tAnnonce      champ t de l'annonce d'état (défaut 1)
 * opts.sansAccuse      aucun accusé ni annonce après l'écriture
 * opts.bloquer         recevoir() ne rend jamais la main (teste l'échéance globale)
 * opts.ouvrirEchoue    ouvrir() échoue (hors ligne)
 */
export function fauxCable(opts = {}) {
  const cleCable = enc.encode(opts.cle ?? 'CLE-FACTICE-0000');
  const dps = JSON.parse(JSON.stringify(opts.dps ?? {}));
  const nonceCable = opts.nonceCable ?? aleatoire(16);
  const ivDe = opts.iv ?? aleatoire;
  const etat = { cleSession: null, nonceLocal: null, ouvert: false, ferme: false, seq: 100, attendu: 3 };
  const file = [];
  const journal = { ouvertures: 0, fermetures: 0, commandes: [], ecritures: [], envoyes: [] };
  let tampon = new Uint8Array(0);

  async function envoyerCable(cle, cmd, clair, retcode) {
    return empaqueterCable(cle, ++etat.seq, cmd, clair, ivDe(12), retcode);
  }
  function emettre(trames) {
    const chunks = [];
    if (opts.grouper) chunks.push(concat(...trames));
    else for (const t of trames) {
      if (opts.decouper) { chunks.push(t.slice(0, 20), t.slice(20)); } else chunks.push(t);
    }
    file.push(...chunks);
  }
  const corpsLecture = () => {
    const json = enc.encode(JSON.stringify(opts.formatLecture === 'data' ? { data: { dps } } : { dps }));
    return opts.formatLecture === 'entete' ? concat(enc.encode('3.5'), new Uint8Array(12), json) : json;
  };

  async function traiter(trame) {
    journal.envoyes.push(trame);
    if (etat.attendu === 3) {
      let m;
      try { m = await lireTrameClient(cleCable, trame); } catch {
        const mode = opts.cleFausse ?? 'repondre';
        if (mode === 'fermer') etat.ferme = true;
        else if (mode === 'repondre') {
          emettre([await envoyerCable(cleCable, 4, concat(nonceCable, await hmac(cleCable, new Uint8Array(16))))]);
        }
        return;
      }
      etat.nonceLocal = m.clair;
      emettre([await envoyerCable(cleCable, 4, concat(nonceCable, await hmac(cleCable, m.clair)))]);
      etat.attendu = 5;
      return;
    }
    if (etat.attendu === 5) {
      const m = await lireTrameClient(cleCable, trame);
      if (m.cmd !== 5) throw new Error('trame 5 attendue');
      const attendu = await hmac(cleCable, nonceCable);
      if (hex(m.clair) !== hex(attendu)) throw new Error('HMAC de fin de négociation faux');
      const xor = etat.nonceLocal.map((x, i) => x ^ nonceCable[i]);
      const ch = new Uint8Array(await sub.encrypt({ name: 'AES-GCM', iv: etat.nonceLocal.subarray(0, 12), tagLength: 128 }, await gcm(cleCable), xor));
      etat.cleSession = ch.slice(0, 16);
      etat.attendu = 'session';
      return;
    }
    const m = await lireTrameClient(etat.cleSession, trame);
    journal.commandes.push(m.cmd);
    if (m.cmd === 0x10) {
      if (opts.silenceLecture) return;
      emettre([await envoyerCable(etat.cleSession, 0x10, corpsLecture())]);
    } else if (m.cmd === 0x0d) {
      const corps = JSON.parse(new TextDecoder().decode(m.clair.subarray(15)));
      journal.ecritures.push({ entete: new TextDecoder().decode(m.clair.subarray(0, 3)), corps });
      if (!opts.ignorerEcriture) {
        for (const [k, v] of Object.entries(corps.data.dps)) dps[k] = k === '151' && opts.transformerEcriture ? opts.transformerEcriture(v) : v;
        Object.assign(dps, opts.effetsEcriture ?? {});
      }
      if (!opts.sansAccuse) {
        emettre([
          await envoyerCable(etat.cleSession, 0x0d, new Uint8Array(0)),
          await envoyerCable(etat.cleSession, 8, enc.encode(JSON.stringify({ protocol: 4, t: opts.tAnnonce ?? 1, data: { dps: { '151': dps['151'] } } }))),
        ]);
      }
    } else {
      throw new Error(`commande inattendue du client : ${m.cmd}`);
    }
  }

  const transport = {
    async ouvrir(ip, port) {
      if (opts.ouvrirEchoue) { const e = new Error('x'); e.code = 'hors_ligne'; throw e; }
      journal.ouvertures++;
      journal.port = port;
      journal.ip = ip;
      etat.ouvert = true;
    },
    async envoyer(octets) {
      if (!etat.ouvert || etat.ferme) { const e = new Error('x'); e.code = 'ferme'; throw e; }
      tampon = concat(tampon, octets);
      for (;;) { // une trame par appel normalement ; on gère aussi plusieurs trames d'un coup
        if (tampon.length < 18) return;
        const total = 18 + u32(tampon, 14) + 4;
        if (tampon.length < total) return;
        const trame = tampon.slice(0, total);
        tampon = tampon.slice(total);
        await traiter(trame);
      }
    },
    async recevoir() {
      if (opts.bloquer) return new Promise(() => {});
      if (file.length) return file.shift();
      const e = new Error('x');
      e.code = etat.ferme ? 'ferme' : 'delai';
      throw e;
    },
    fermer() { journal.fermetures++; etat.ouvert = false; },
  };
  return { transport, journal, dps, etat };
}

// Aléas déterministes pour un module de test : rend les octets de la liste, dans l'ordre.
export function aleasDepuis(listeHex) {
  const liste = listeHex.map(deHex);
  let i = 0;
  return { octets(n) { const v = liste[i++]; if (!v || v.length !== n) throw new Error(`aléa inattendu (${n} octets demandés, rang ${i - 1})`); return v; }, get utilises() { return i; } };
}
