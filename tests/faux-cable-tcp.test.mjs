// Tests de tools/faux-cable-tcp.mjs (lot C3.1) : le faux câble des tests, exposé en TCP, doit se comporter comme
// celui des essais sur émulateur : écoute en local seulement, points de données partagés, sonde sans effet.
// Ce fichier ouvre des sockets sur 127.0.0.1 : il figure dans les exceptions de tests/garde-fous-depot.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lireEtat, programmer } from '../local/tuya-local.js';
import { demarrerFauxCableTcp, CLE_FACTICE, DPS_INITIAUX } from '../tools/faux-cable-tcp.mjs';

// Transport TCP minimal pour les tests (le port 6668 et le filtre d'adresses de transport-node.mjs ne conviennent pas
// à un port éphémère sur 127.0.0.1). Même interface : ouvrir · envoyer · recevoir · fermer.
function transportTcp(port) {
  let s = null; let recus = []; let fini = false; let reveil = null;
  const signaler = () => { if (reveil) { const r = reveil; reveil = null; r(); } };
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    ouvrir() {
      return new Promise((ok, ko) => {
        s = net.createConnection({ host: '127.0.0.1', port });
        s.once('connect', ok);
        s.on('data', (d) => { recus.push(new Uint8Array(d)); signaler(); });
        s.on('close', () => { fini = true; signaler(); });
        s.on('error', () => { fini = true; ko(err('hors_ligne')); signaler(); });
      });
    },
    envoyer(o) { return new Promise((ok, ko) => s.write(o, (e) => (e ? ko(err('ferme')) : ok()))); },
    async recevoir(delai) {
      if (!recus.length && !fini) await new Promise((ok) => { const t = setTimeout(() => { reveil = null; ok(); }, delai); reveil = () => { clearTimeout(t); ok(); }; });
      if (recus.length) { const m = recus; recus = []; const out = new Uint8Array(m.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of m) { out.set(x, i); i += x.length; } return out; }
      throw err(fini ? 'ferme' : 'delai');
    },
    fermer() { if (s) s.destroy(); },
  };
}

const cfg = (extra = {}) => ({ ip: '127.0.0.1', deviceId: 'ID-FACTICE', cleLocale: CLE_FACTICE, version: '3.5', attentes: [20, 20, 20], ...extra });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function avecServeur(fn, opts = {}) {
  const srv = await demarrerFauxCableTcp({ port: 0, ...opts });
  try { await fn(srv); } finally { await srv.arreter(); }
}

test('écoute 127.0.0.1 seulement, jamais toutes les interfaces', async () => {
  await avecServeur(async (srv) => {
    assert.equal(srv.adresse, '127.0.0.1');
    assert.ok(srv.port > 0);
  });
  const src = readFileSync(fileURLToPath(new URL('../tools/faux-cable-tcp.mjs', import.meta.url)), 'utf8');
  assert.ok(/host:\s*ADRESSE/.test(src) && /const ADRESSE = "127\.0\.0\.1"/.test(src));
  assert.ok(!/0\.0\.0\.0|::/.test(src.replace(/\/\/.*$/gm, '')), 'aucune adresse de toutes les interfaces dans le code');
});

test('lecture par le module réel, par TCP : plage initiale', async () => {
  await avecServeur(async (srv) => {
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    assert.deepEqual(r, { ok: true, debut: '03:30', fin: '06:00', plage_active: true });
  });
});

test('une écriture persiste : relecture sur une autre connexion', async () => {
  await avecServeur(async (srv) => {
    const w = await programmer(cfg(), transportTcp(srv.port), { allumage: '05:10' });
    assert.equal(w.ok, true, JSON.stringify(w));
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    assert.equal(r.ok, true);
    assert.equal(r.debut, w.debut, 'même début relu sur la connexion suivante');
    assert.equal(r.fin, '06:00', 'la fin n\'a pas changé');
    const dps = srv.dps();
    assert.equal(dps['150'], DPS_INITIAUX['150'], 'aucun autre point modifié');
    assert.equal(dps['152'], DPS_INITIAUX['152']);
    assert.equal(JSON.parse(dps['151']).se, '06:00');
  });
});

test('clé fausse : erreur cle, rien n\'est écrit', async () => {
  await avecServeur(async (srv) => {
    const r = await programmer(cfg({ cleLocale: 'AUTRE-CLE-FAUSSE' }), transportTcp(srv.port), { allumage: '05:10' });
    assert.deepEqual(r, { ok: false, erreur: 'cle' });
    assert.equal(srv.dps()['151'], DPS_INITIAUX['151']);
  });
});

test('une sonde (connexion puis fermeture sans données) ne casse rien', async () => {
  await avecServeur(async (srv) => {
    for (let i = 0; i < 5; i++) {
      await new Promise((ok) => { const s = net.createConnection({ host: '127.0.0.1', port: srv.port }); s.once('connect', () => { s.destroy(); ok(); }); });
    }
    for (let i = 0; i < 50 && srv.stats.fermees < 5; i++) await attendre(10);
    assert.equal(srv.stats.sondes, 5);
    assert.equal(srv.stats.actives, 0);
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    assert.equal(r.ok, true, 'le câble répond encore après les sondes');
    assert.equal(srv.dps()['151'], DPS_INITIAUX['151']);
  });
});

test('deux connexions en parallèle : lectures indépendantes', async () => {
  await avecServeur(async (srv) => {
    const [a, b] = await Promise.all([lireEtat(cfg(), transportTcp(srv.port)), lireEtat(cfg(), transportTcp(srv.port))]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });
});

test('arrêt : toutes les connexions sont fermées', async () => {
  const srv = await demarrerFauxCableTcp({ port: 0 });
  const s = net.createConnection({ host: '127.0.0.1', port: srv.port });
  await new Promise((ok) => s.once('connect', ok));
  const ferme = new Promise((ok) => s.once('close', ok));
  await srv.arreter();
  await ferme;
  assert.equal(srv.stats.actives, 0);
});
