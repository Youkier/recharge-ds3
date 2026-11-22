// Tests de tools/faux-cable-tcp.mjs (lot C3.1) : le faux câble des tests, exposé en TCP, doit se comporter comme
// celui des essais sur émulateur : écoute en local seulement, points de données partagés, sonde sans effet.
// Ce fichier ouvre des sockets sur 127.0.0.1 : il figure dans les exceptions de tests/garde-fous-depot.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lireEtat, programmer } from '../local/tuya-local.js';
import { demarrerFauxCableTcp, lireArguments, CLE_FACTICE, DPS_INITIAUX } from '../tools/faux-cable-tcp.mjs';

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

const cfg = (extra = {}) => ({ ip: '127.0.0.1', deviceId: 'ID-FACTICE', cleLocale: CLE_FACTICE, version: '3.5', attentes: [20, 20, 20], maintenant: () => new Date('2026-11-17T14:00:00Z'), ...extra }); // 15:00 à Paris : écriture normale
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
    const w = await programmer(cfg(), transportTcp(srv.port), { allumage: '05:10', fin: '06:00', duree_min: 420, depart: '07:30' });
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
    const r = await programmer(cfg({ cleLocale: 'AUTRE-CLE-FAUSSE' }), transportTcp(srv.port), { allumage: '05:10', fin: '06:00', duree_min: 420, depart: '07:30' });
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

// --- Options des scénarios de cas atypiques (revue UX du 2026-11-22) ---

test('lireArguments : valeurs par défaut, options valides, refus du reste', () => {
  assert.deepEqual(lireArguments([]), { port: 6668, plage: null, delaiReponseMs: 0, silenceApresEcriture: false });
  assert.deepEqual(
    lireArguments(['--port=7000', '--plage=00:35-06:00', '--delai-reponse=3000', '--silence-apres-ecriture']),
    { port: 7000, plage: { debut: '00:35', fin: '06:00' }, delaiReponseMs: 3000, silenceApresEcriture: true });
  for (const mauvais of ['--plage=25:00-06:00', '--plage=0:35-06:00', '--plage=00:35', '--delai-reponse=-1', '--delai-reponse=31000',
    '--port=70000', '--host=0.0.0.0', 'x']) {
    assert.throws(() => lireArguments([mauvais]), Error, mauvais);
  }
});

test('plage initiale : relue par le module réel, autres points inchangés', async () => {
  await avecServeur(async (srv) => {
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    assert.deepEqual(r, { ok: true, debut: '00:35', fin: '06:00', plage_active: true });
    const dps = srv.dps();
    assert.equal(dps['150'], DPS_INITIAUX['150']);
    assert.equal(dps['152'], DPS_INITIAUX['152']);
  }, { plage: { debut: '00:35', fin: '06:00' } });
  await avecServeur(async (srv) => {
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    assert.deepEqual(r, { ok: true, debut: '05:59', fin: '06:00', plage_active: true }, 'plage « pas de charge »');
  }, { plage: { debut: '05:59', fin: '06:00' } });
  await assert.rejects(() => demarrerFauxCableTcp({ port: 0, plage: { debut: '24:00', fin: '06:00' } }), /plage invalide/);
});

test('délai de réponse : la lecture aboutit, mais pas plus vite que le retard', async () => {
  await avecServeur(async (srv) => {
    const t0 = Date.now();
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    const duree = Date.now() - t0;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(duree >= 2 * 250 - 30, `deux réponses retardées de 250 ms (négociation, lecture) : ${duree} ms`);
  }, { delaiReponseMs: 250 });
  await avecServeur(async (srv) => {
    const t0 = Date.now();
    const r = await lireEtat(cfg(), transportTcp(srv.port));
    assert.equal(r.ok, true);
    assert.ok(Date.now() - t0 < 200, 'sans retard : réponse immédiate');
  });
});

test("délai plus long que l'échéance du client : « delai », rien n'est écrit", async () => {
  await avecServeur(async (srv) => {
    const r = await lireEtat(cfg({ delaiGlobalMs: 300 }), transportTcp(srv.port));
    assert.equal(r.ok, false);
    assert.equal(r.erreur, 'delai');
    assert.equal(srv.stats.ecritures, 0);
  }, { delaiReponseMs: 600 });
});

test("silence après l'écriture : appliquée, puis plus de réponse, résultat incertain, une seule écriture vue", async () => {
  const lignes = [];
  await avecServeur(async (srv) => {
    const w = await programmer(cfg({ delaiGlobalMs: 1500 }), transportTcp(srv.port), { allumage: '05:10', fin: '06:00', duree_min: 420, depart: '07:30' });
    assert.deepEqual(w, { ok: false, erreur: 'delai', ecrit: true }, 'écriture partie, relecture sans réponse : incertain');
    assert.equal(srv.stats.ecritures, 1);
    assert.equal(JSON.parse(srv.dps()['151']).ss, '05:10', "l'écriture a bien été appliquée par le câble");
    // Une nouvelle connexion reste sans réponse (le câble est muet pour tout le monde) et n'écrit rien.
    const r = await lireEtat(cfg({ delaiGlobalMs: 400 }), transportTcp(srv.port));
    assert.equal(r.ok, false);
    assert.equal(srv.stats.ecritures, 1, 'aucune seconde écriture');
    assert.deepEqual(lignes.filter((l) => l.includes('écriture reçue')), ['écriture reçue (1)']);
    assert.ok(!lignes.join(' ').includes('05:10'), 'le journal ne contient pas la valeur écrite');
  }, { silenceApresEcriture: true, journal: (l) => lignes.push(l) });
});

test("sans l'option de silence, l'écriture est comptée une fois et la relecture aboutit", async () => {
  await avecServeur(async (srv) => {
    const w = await programmer(cfg(), transportTcp(srv.port), { allumage: '05:10', fin: '06:00', duree_min: 420, depart: '07:30' });
    assert.equal(w.ok, true, JSON.stringify(w));
    assert.equal(srv.stats.ecritures, 1);
  });
});
