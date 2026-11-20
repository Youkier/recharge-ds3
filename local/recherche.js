// Recherche automatique du câble sur le réseau local (lot C2 de la phase 3b).
// Module pur : aucun import node:*, réutilisable dans la WebView du téléphone. Le transport TCP et la sonde de port
// sont fournis par l'appelant (creerTransport(), sonder(ip, delaiMs)).
//
// Principe : une adresse n'est jamais « le câble » parce que son port 6668 est ouvert, mais parce que lireEtat()
// (local/tuya-local.js) y réussit : seule la bonne clé passe la négociation, donc aucune lecture de points de données ni
// aucune écriture n'est possible sur un autre appareil. Cette recherche ne fait que lire.
//
//   localiserCable({ cfg, departs, interfaces, creerTransport, sonder, ... })
//     -> { ok:true, ip, trouve, etat } | { ok:false, erreur:'hors_ligne', recherche }
//   cfg : { deviceId, cleLocale, version?, ... } sans ip. Seuls des codes d'erreur sont rendus : la clé n'apparaît nulle part.

import { lireEtat } from './tuya-local.js';

const PARALLELISME = 32;
const DELAI_SONDE_MS = 400;
const DELAI_TOTAL_MS = 30_000;
const DELAI_LECTURE_MS = 8_000;

// IPv4 privée en notation décimale stricte (10/8, 172.16/12, 192.168/16).
export function adressePrivee(ip) {
  if (typeof ip !== 'string') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n, i) => n > 255 || String(n) !== m[i + 1])) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

// « 192.168.1.48 » -> « 192.168.1 » (réseau /24), null si l'adresse n'est pas une IPv4 privée.
export function reseauDe(ip) {
  return adressePrivee(ip) ? ip.split('.').slice(0, 3).join('.') : null;
}

// Les 254 adresses d'hôte d'un /24 (.1 à .254).
export function candidatsDuReseau(prefixe) {
  if (!adressePrivee(`${prefixe}.1`)) return [];
  return Array.from({ length: 254 }, (_, i) => `${prefixe}.${i + 1}`);
}

async function pool(elements, n, tache, arret) {
  let i = 0;
  const travailleur = async () => {
    while (!arret() && i < elements.length) await tache(elements[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, elements.length) }, travailleur));
}

export async function localiserCable(opts) {
  const {
    cfg, departs = [], interfaces = [], creerTransport, sonder,
    parallelisme = PARALLELISME, delaiSondeMs = DELAI_SONDE_MS,
    delaiTotalMs = DELAI_TOTAL_MS, delaiLectureMs = DELAI_LECTURE_MS,
    surRecherche = null,
  } = opts;
  let annule = false;
  let recherche = false;

  // Lectures une par une : un transport (le pont de la coque Android) peut n'accepter qu'une connexion à la fois, et
  // chez un particulier d'autres appareils Tuya ouvrent aussi le port 6668. Le délai de lecture ne court qu'une fois
  // le tour venu ; l'échéance totale (delaiTotalMs) borne l'ensemble. Les sondes restent en parallèle.
  let fileLectures = Promise.resolve();
  const lire = (ip) => {
    const tour = fileLectures.then(async () => {
      if (annule) return { ok: false, erreur: 'hors_ligne' };
      try { return await lireEtat({ ...cfg, ip, delaiGlobalMs: delaiLectureMs }, creerTransport()); } catch { return { ok: false, erreur: 'hors_ligne' }; }
    });
    fileLectures = tour.then(() => {}, () => {});
    return tour;
  };

  const travail = (async () => {
    // 1 et 2 : adresses de départ, dans l'ordre, sans doublon ni adresse non privée.
    const essayees = [];
    for (const ip of departs) {
      if (annule) break;
      if (!adressePrivee(ip) || essayees.includes(ip)) continue;
      essayees.push(ip);
      const r = await lire(ip);
      if (r.ok) return { ok: true, ip, trouve: false, etat: r };
    }
    // 3 : réseaux à fouiller = /24 des adresses de départ, à défaut /24 des interfaces du PC.
    const reseaux = [];
    for (const ip of (essayees.length ? essayees : interfaces)) {
      const r = reseauDe(ip);
      if (r && !reseaux.includes(r)) reseaux.push(r);
    }
    const candidats = [];
    for (const r of reseaux) for (const c of candidatsDuReseau(r)) if (!essayees.includes(c) && !candidats.includes(c)) candidats.push(c);
    recherche = true;
    if (surRecherche) { try { surRecherche(); } catch { /* sans effet */ } }

    // 4 : port ouvert, puis négociation de la clé sur ces seules adresses.
    const trouves = [];
    await pool(candidats, parallelisme, async (ip) => {
      let ouvert = false;
      try { ouvert = (await sonder(ip, delaiSondeMs)) === true; } catch { ouvert = false; }
      if (!ouvert || annule) return;
      const r = await lire(ip);
      if (r.ok) trouves.push({ ip, etat: r });
    }, () => annule || trouves.length > 1);

    // 5 : exactement un câble, sinon échec (jamais de choix au hasard).
    if (!annule && trouves.length === 1) return { ok: true, ip: trouves[0].ip, trouve: true, etat: trouves[0].etat };
    return { ok: false, erreur: 'hors_ligne', recherche: true };
  })();
  travail.catch(() => {});

  let minuteur;
  const echeance = new Promise((resolve) => {
    minuteur = setTimeout(() => { annule = true; resolve({ ok: false, erreur: 'hors_ligne', recherche }); }, delaiTotalMs);
  });
  try {
    return await Promise.race([travail, echeance]);
  } catch {
    return { ok: false, erreur: 'hors_ligne', recherche };
  } finally {
    clearTimeout(minuteur);
    annule = true;
  }
}
