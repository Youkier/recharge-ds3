// Tests du client du pont de la coque (android/essai/transport-pont.js, lot C3.1) contre un pont SIMULÉ en JavaScript
// qui applique le contrat décrit dans l'en-tête de transport-pont.js (le vrai pont est PontLocal.kt, testé en JUnit et
// sur émulateur). On vérifie que lireEtat, programmer et localiserCable, non modifiés, fonctionnent par ce pont, et que
// la page d'essai ne garde ni ne journalise la clé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fauxCable } from './tuya-local-faux-cable.mjs';
import { lireEtat, programmer } from '../local/tuya-local.js';
import { localiserCable } from '../local/recherche.js';
import { creerClientPont, enBase64, deBase64 } from '../android/essai/transport-pont.js';

const CLE = 'CLE-FACTICE-0000';
const plage = (m, ss, se) => JSON.stringify({ m, dt: 0, ss, se });
const dpsBase = () => ({ 101: 202, 109: 'WAIT', 150: 16, 151: plage(2, '03:30', '06:00'), 152: 16 });
const lire = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Pont simulé. cables : { ip: dps partagés } ; seules ces adresses « répondent ». autres : { ip: clé } d'appareils Tuya
// qui ouvrent le port 6668 mais avec une autre clé (prises, ampoules… d'un particulier).
function faussePont({ cables, cle = CLE, retard = 0, autres = {} }) {
  const pont = { onmessage: null, journal: [], ouvertes: 0, fermees: 0, courant: null, reserve: false, occupes: 0 };
  const filtre = (ip, port) => port === 6668 && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(ip) && !/(^|\.)0\d/.test(ip);
  let compteur = 0;
  const repondre = (n, r) => setTimeout(() => pont.onmessage({ data: JSON.stringify({ n, ...r }) }), retard);
  pont.postMessage = (texte) => {
    const q = JSON.parse(texte);
    pont.journal.push(q.op);
    const { n, op } = q;
    (async () => {
      if (op === 'demarrage') return repondre(n, { ok: true, variante: 'debug', auto: null });
      if (op === 'prefixeWifi') return repondre(n, { ok: true, prefixe: '10.0.2' });
      if (op === 'cable') return repondre(n, { ok: true, configure: true, deviceId: 'ID-FACTICE', cle });
      if (op === 'sonder') {
        if (!filtre(q.ip, 6668)) return repondre(n, { ok: false, erreur: 'refuse' });
        return repondre(n, { ok: true, ouvert: q.ip in cables || q.ip in autres });
      }
      if (op === 'ouvrir') {
        if (!filtre(q.ip, q.port)) return repondre(n, { ok: false, erreur: 'refuse' });
        // Comme Registre.reserver() : la place est prise dès la demande, avant que la connexion aboutisse.
        if (pont.courant || pont.reserve) { pont.occupes++; return repondre(n, { ok: false, erreur: 'occupe' }); }
        if (!(q.ip in cables) && !(q.ip in autres)) return repondre(n, { ok: false, erreur: 'injoignable' });
        pont.reserve = true;
        if (autres[q.ip] === 'MUET') { // port ouvert, n'envoie jamais rien
          pont.reserve = false;
          pont.courant = { id: ++compteur, ip: q.ip, muet: true };
          pont.ouvertes++;
          return repondre(n, { ok: true, cx: pont.courant.id });
        }
        const f = q.ip in cables ? fauxCable({ cle: CLE, dps: cables[q.ip] }) : fauxCable({ cle: autres[q.ip], dps: dpsBase() });
        await f.transport.ouvrir(q.ip, q.port);
        pont.reserve = false;
        pont.courant = { id: ++compteur, f, ip: q.ip };
        pont.ouvertes++;
        return repondre(n, { ok: true, cx: pont.courant.id });
      }
      const c = pont.courant;
      if (op === 'fermer') { if (c && c.id === q.cx) { if (c.f) c.f.transport.fermer(); if (c.ip in cables) cables[c.ip] = c.f.dps; pont.courant = null; pont.fermees++; } return repondre(n, { ok: true }); }
      if (!c || c.id !== q.cx) return repondre(n, { ok: false, erreur: 'cx_inconnu' });
      if (c.muet) {
        if (op === 'envoyer') return repondre(n, { ok: true });
        if (op === 'recevoir') return setTimeout(() => repondre(n, { ok: false, erreur: 'delai' }), q.delai);
      }
      if (op === 'envoyer') {
        const o = deBase64(q.d);
        if (o.length > 2048) return repondre(n, { ok: false, erreur: 'refuse' });
        await c.f.transport.envoyer(o);
        cables[c.ip] = c.f.dps;
        return repondre(n, { ok: true });
      }
      if (op === 'recevoir') {
        try { return repondre(n, { ok: true, d: enBase64(await c.f.transport.recevoir(q.delai)) }); } catch (e) { return repondre(n, { ok: false, erreur: e.code }); }
      }
      return repondre(n, { ok: false, erreur: 'operation_inconnue' });
    })();
  };
  return pont;
}
const cfg = (extra = {}) => ({ deviceId: 'ID-FACTICE', cleLocale: CLE, version: '3.5', attentes: [5, 5, 5], ...extra });

test('base64 : aller-retour sur tous les octets', () => {
  const o = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(deBase64(enBase64(o)), o);
  assert.deepEqual(deBase64(enBase64(new Uint8Array(0))), new Uint8Array(0));
});

test('lireEtat par le pont, sans modifier le module', async () => {
  const pont = faussePont({ cables: { '10.0.2.2': dpsBase() } });
  const client = creerClientPont(pont);
  const r = await lireEtat({ ...cfg(), ip: '10.0.2.2' }, client.creerTransport());
  assert.deepEqual(r, { ok: true, debut: '03:30', fin: '06:00', plage_active: true });
  assert.equal(pont.ouvertes, 1);
  assert.equal(pont.fermees, 1, 'la connexion est fermée à la fin');
  assert.equal(pont.courant, null);
});

test('programmer puis relire : l\'écriture persiste, rien d\'autre ne change', async () => {
  const cables = { '10.0.2.2': dpsBase() };
  const client = creerClientPont(faussePont({ cables }));
  const w = await programmer({ ...cfg(), ip: '10.0.2.2' }, client.creerTransport(), { allumage: '05:00' });
  assert.equal(w.ok, true, JSON.stringify(w));
  const r = await lireEtat({ ...cfg(), ip: '10.0.2.2' }, client.creerTransport());
  assert.equal(r.debut, w.debut);
  assert.equal(r.fin, '06:00');
  assert.equal(cables['10.0.2.2'][150], 16);
});

test('clé fausse : erreur cle (le pont simulé garde la bonne clé côté câble)', async () => {
  const client = creerClientPont(faussePont({ cables: { '10.0.2.2': dpsBase() } }));
  const r = await lireEtat({ ...cfg({ cleLocale: 'AUTRE-CLE-FAUSSE' }), ip: '10.0.2.2' }, client.creerTransport());
  assert.deepEqual(r, { ok: false, erreur: 'cle' });
});

test('adresse refusée par le pont : hors_ligne pour le module, motif conservé dans le client', async () => {
  const pont = faussePont({ cables: {} });
  const client = creerClientPont(pont);
  const r = await lireEtat({ ...cfg(), ip: '8.8.8.8' }, client.creerTransport());
  assert.equal(r.erreur, 'hors_ligne');
  assert.equal(client.dernierMotif, 'refuse');
  assert.equal(pont.ouvertes, 0);
});

test('une seule connexion de données à la fois : la seconde attend la fermeture de la première, sans occupe', async () => {
  const pont = faussePont({ cables: { '10.0.2.2': dpsBase() } });
  const client = creerClientPont(pont);
  const a = client.creerTransport(); const b = client.creerTransport();
  await a.ouvrir('10.0.2.2', 6668, 1000);
  let bOuvert = false;
  const ob = b.ouvrir('10.0.2.2', 6668, 1000).then(() => { bOuvert = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bOuvert, false, 'b attend son tour');
  await a.fermer(); await a.fermer(); // idempotent
  await ob;
  assert.equal(bOuvert, true);
  assert.equal(pont.occupes, 0);
  await b.fermer();
  assert.equal(pont.courant, null);
});

test('le tour est rendu après un échec d\'ouverture et après un abandon pendant l\'attente', async () => {
  const pont = faussePont({ cables: { '10.0.2.2': dpsBase() } });
  const client = creerClientPont(pont);
  const muet = client.creerTransport();
  await assert.rejects(muet.ouvrir('10.0.2.99', 6668, 200), (e) => e.code === 'hors_ligne'); // injoignable
  await muet.fermer();
  const a = client.creerTransport(); const abandonne = client.creerTransport(); const c = client.creerTransport();
  await a.ouvrir('10.0.2.2', 6668, 1000);
  const oAb = abandonne.ouvrir('10.0.2.2', 6668, 1000).catch((e) => e.code);
  await abandonne.fermer(); // échéance du module pendant l'attente du tour
  await a.fermer();
  assert.equal(await oAb, 'ferme');
  await c.ouvrir('10.0.2.2', 6668, 1000); // le tour n'est pas resté pris
  await c.fermer();
  assert.equal(pont.courant, null);
});

test('recherche chez un particulier : d\'autres appareils Tuya ouvrent le port, le câble est quand même trouvé', async () => {
  const autres = { '10.0.2.2': 'AUTRE-CLE-000001', '10.0.2.3': 'AUTRE-CLE-000002', '10.0.2.4': 'AUTRE-CLE-000003' };
  const pont = faussePont({ cables: { '10.0.2.5': dpsBase() }, autres });
  const client = creerClientPont(pont);
  const r = await localiserCable({ cfg: cfg(), departs: [], interfaces: ['10.0.2.1'], creerTransport: client.creerTransport, sonder: client.sonder });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ip, '10.0.2.5');
  assert.equal(pont.occupes, 0, 'aucune lecture refusée pour « occupe »');
  assert.equal(pont.courant, null);
});

test('recherche : deux appareils muets avant le câble ne consomment pas le délai de lecture du câble', async () => {
  const pont = faussePont({ cables: { '10.0.2.5': dpsBase() }, autres: { '10.0.2.2': 'MUET', '10.0.2.3': 'MUET' } });
  const client = creerClientPont(pont);
  // Délai de lecture réduit à 300 ms : deux muets en file (2 × 300 ms) dépasseraient le délai du câble s'il courait
  // pendant l'attente.
  const r = await localiserCable({ cfg: cfg(), departs: [], interfaces: ['10.0.2.1'], creerTransport: client.creerTransport, sonder: client.sonder, delaiLectureMs: 300 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ip, '10.0.2.5');
  assert.equal(pont.occupes, 0);
  assert.equal(pont.courant, null);
});

test('fermer() pendant l\'ouverture (échéance globale) : la connexion arrivée trop tard est refermée', async () => {
  const pont = faussePont({ cables: { '10.0.2.2': dpsBase() }, retard: 30 });
  const client = creerClientPont(pont);
  const t = client.creerTransport();
  const ouverture = t.ouvrir('10.0.2.2', 6668, 1000).catch((e) => e.code);
  await t.fermer(); // le module a abandonné
  assert.equal(await ouverture, 'ferme');
  assert.equal(pont.courant, null, 'aucune connexion restée ouverte');
});

test('localiserCable sans adresse : retrouve le câble par les sondes du pont', async () => {
  const pont = faussePont({ cables: { '10.0.2.2': dpsBase() } });
  const client = creerClientPont(pont);
  const r = await localiserCable({ cfg: cfg(), departs: [], interfaces: ['10.0.2.1'], creerTransport: client.creerTransport, sonder: client.sonder });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ip, '10.0.2.2');
  assert.equal(r.trouve, true);
  assert.equal(pont.courant, null);
  assert.equal(pont.journal.filter((o) => o === 'sonder').length, 254);
});

test('adresse muette puis câble trouvé dans le même réseau', async () => {
  const client = creerClientPont(faussePont({ cables: { '10.0.2.2': dpsBase() } }));
  const r = await localiserCable({ cfg: cfg(), departs: ['10.0.2.250'], interfaces: [], creerTransport: client.creerTransport, sonder: client.sonder });
  assert.equal(r.ok, true);
  assert.equal(r.ip, '10.0.2.2');
  assert.equal(r.trouve, true);
});

test('pont muet : réponse pont_muet au lieu d\'un blocage', async () => {
  const client = creerClientPont({ postMessage() {}, onmessage: null }, { margeMs: 10 });
  const t0 = Date.now();
  const r = await client.appeler('variante', {}, 1);
  assert.deepEqual([r.ok, r.erreur], [false, 'pont_muet']);
  assert.ok(Date.now() - t0 < 5000);
});

test('la page d\'essai ne garde ni ne journalise la clé : pas de stockage, une seule ligne ESSAI', () => {
  for (const f of ['../android/essai/essai.js', '../android/essai/transport-pont.js']) {
    const src = lire(f).replace(/\/\/.*$/gm, ''); // sans les commentaires
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|location\.(hash|search)|history\./.test(src), f);
  }
  const src = lire('../android/essai/essai.js');
  const logs = src.match(/console\.\w+\(/g) || [];
  assert.deepEqual(logs, ['console.log('], 'un seul appel de console, celui de la ligne ESSAI');
  assert.ok(/console\.log\('ESSAI ' \+ JSON\.stringify\(ligne\)\)/.test(src));
  assert.ok(!/ligne\s*=\s*\{[^}]*(cle|cleLocale|deviceId)/.test(src), 'la ligne ESSAI ne contient ni clé ni identifiant');
  assert.ok(!/textContent\s*=[^;]*(cleLocale|\.cle\b)/.test(src), 'la clé n\'est jamais affichée');
  // Les en-têtes des fichiers de la page ne chargent rien hors de l'origine de l'application.
  const html = lire('../android/essai/index.html');
  assert.ok(!/https?:\/\//.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')), 'aucune ressource distante');
  assert.match(html, /script-src 'self'/);
});
