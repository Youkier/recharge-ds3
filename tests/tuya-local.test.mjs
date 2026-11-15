// Tests de local/tuya-local.js (protocole local Tuya 3.5, lot C1 de la phase 3b).
// Aucun réseau, aucune vraie clé : vecteurs produits par tinytuya (clé factice) et faux câble simulé.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as module_ from '../local/tuya-local.js';
import { lireEtat, programmer } from '../local/tuya-local.js';
import { interpreterReponse } from '../site/service.js';
import { fauxCable, aleasDepuis, hex, deHex } from './tuya-local-faux-cable.mjs';

const V = JSON.parse(readFileSync(new URL('./tuya-local-vecteurs.json', import.meta.url), 'utf8'));
const CLE = V.cle;
const sansPause = async () => {};
const maintenantV = () => new Date(V.maintenant);
const plage = (m, ss, se, dt = 0) => JSON.stringify({ m, dt, ss, se });
const dpsBase = (p151 = plage(2, '03:30', '06:00')) => ({ 101: 202, 102: '{"p":0}', 107: '[6,8,10,13,16]', 109: 'WAIT', 150: 16, 151: p151, 152: 16 });
const cfgDe = (extra = {}) => ({ ip: V.ip, deviceId: V.deviceId, cleLocale: CLE, version: '3.5', pause: sansPause, maintenant: maintenantV, ...extra });
const FAUX = (opts = {}) => fauxCable({ cle: CLE, dps: dpsBase(), ...opts });

describe('Exports (aucune fonction d\'envoi générique)', () => {
  test('seulement lireEtat et programmer', () => {
    assert.deepEqual(Object.keys(module_).sort(), ['lireEtat', 'programmer']);
  });
  test('une seule construction de commande d\'écriture dans le source', () => {
    const src = readFileSync(new URL('../local/tuya-local.js', import.meta.url), 'utf8');
    assert.equal((src.match(/envoyerTrame\(ctx, CMD_ECRITURE/g) || []).length, 1);
    assert.equal((src.match(/CMD_ECRITURE\b/g) || []).length, 3); // définition, envoi, filtre de l'accusé
    assert.equal((src.match(/corpsEcriture\(/g) || []).length, 2); // définition + appel
  });
});

describe('Identifiants factices', () => {
  test('visiblement factices, dans les vecteurs', () => {
    assert.equal(CLE, 'CLE-FACTICE-0000');
    assert.match(V.deviceId, /^factice_/);
    assert.match(V.ip, /^192\.0\.2\./); // plage de documentation RFC 5737
    assert.match(V._avertissement, /FACTICES/);
    assert.equal(V.tinytuya, '1.21.1');
  });
});

// --- Vecteurs tinytuya ---
function transportVecteur(echanges) {
  const file = [], envoyes = [], recus = [];
  return {
    envoyes, recus,
    transport: {
      async ouvrir() {},
      async envoyer(o) {
        const e = echanges[envoyes.length];
        envoyes.push(hex(o));
        if (e) for (const c of e.cable) file.push(deHex(c));
      },
      async recevoir() {
        if (file.length) { const c = file.shift(); recus.push(hex(c)); return c; }
        throw Object.assign(new Error('x'), { code: 'delai' });
      },
      fermer() {},
    },
  };
}

describe('Vecteurs produits par tinytuya', () => {
  test('lecture : mêmes octets envoyés (négociation, lecture) et réponses relues', async () => {
    const t = transportVecteur(V.lecture.echanges);
    const r = await lireEtat(cfgDe({ aleas: aleasDepuis(V.aleas) }), t.transport);
    assert.deepEqual(r, { ok: true, debut: '03:30', fin: '06:00', plage_active: true });
    assert.deepEqual(t.envoyes, V.lecture.echanges.map((e) => e.client));
    assert.deepEqual(t.recus, V.lecture.echanges.flatMap((e) => e.cable));
  });

  test('écriture : mêmes octets envoyés (négociation, lecture, écriture, relecture) et réponses relues', async () => {
    const t = transportVecteur(V.ecriture.echanges);
    const r = await programmer(cfgDe({ aleas: aleasDepuis(V.aleas) }), t.transport, V.ecriture.demande);
    assert.deepEqual(r, { ok: true, debut: '00:15', fin: '06:00', plage_active: true });
    assert.deepEqual(t.envoyes, V.ecriture.echanges.map((e) => e.client));
    assert.deepEqual(t.recus, V.ecriture.echanges.flatMap((e) => e.cable));
  });

  test('le faux câble de test reproduit les trames de tinytuya (négociation, lecture, accusé, annonce)', async () => {
    const ivs = Array.from({ length: 10 }, (_, k) => new Uint8Array(12).fill(0xc0 + k));
    let k = 0;
    const f = fauxCable({
      cle: CLE, dps: V.ecriture.dps_avant, nonceCable: deHex(V.nonce_cable), iv: () => ivs[k++],
      tAnnonce: V.t, effetsEcriture: { 102: V.ecriture.dps_apres['102'] },
    });
    const recus = [];
    const transport = { ...f.transport, async recevoir(d) { const c = await f.transport.recevoir(d); recus.push(hex(c)); return c; } };
    const r = await programmer(cfgDe({ aleas: aleasDepuis(V.aleas) }), transport, V.ecriture.demande);
    assert.equal(r.ok, true);
    assert.deepEqual(f.journal.envoyes.map(hex), V.ecriture.echanges.map((e) => e.client));
    const attendus = V.ecriture.echanges.flatMap((e) => e.cable);
    assert.deepEqual(recus, attendus); // négociation, lecture, accusé, annonce, relecture
  });

  test('la clé de session dérivée (XOR des nonces, AES-GCM, 16 premiers octets) est celle de tinytuya', async () => {
    const nonce = deHex(V.aleas[0]), cable = deHex(V.nonce_cable);
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLE), { name: 'AES-GCM' }, false, ['encrypt']);
    const ch = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.subarray(0, 12), tagLength: 128 }, k, nonce.map((x, i) => x ^ cable[i])));
    assert.equal(hex(ch.slice(0, 16)), V.cle_session);
  });
});

// --- Faux câble ---
describe('Lecture', () => {
  test('état lu, connexion fermée, port 6668', async () => {
    const f = FAUX();
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: true, debut: '03:30', fin: '06:00', plage_active: true });
    assert.equal(f.journal.fermetures, 1);
    assert.equal(f.journal.ouvertures, 1);
    assert.equal(f.journal.port, 6668);
    assert.deepEqual(f.journal.ecritures, []);
  });
  test('plage inactive (m = 0)', async () => {
    const f = FAUX({ dps: dpsBase(plage(0, '03:30', '06:00')) });
    assert.equal((await lireEtat(cfgDe(), f.transport)).plage_active, false);
  });
  test('formats de réponse de lecture : data.dps et en-tête de version', async () => {
    for (const formatLecture of ['data', 'entete']) {
      const f = FAUX({ formatLecture });
      assert.equal((await lireEtat(cfgDe(), f.transport)).ok, true, formatLecture);
    }
  });
  test('trame coupée en deux', async () => {
    const f = FAUX({ decouper: true });
    assert.equal((await lireEtat(cfgDe(), f.transport)).debut, '03:30');
  });
  test('câble hors ligne', async () => {
    const f = FAUX({ ouvrirEchoue: true });
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: false, erreur: 'hors_ligne' });
    assert.equal(f.journal.fermetures, 1);
  });
  test('aucune réponse à la lecture : délai', async () => {
    const f = FAUX({ silenceLecture: true });
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: false, erreur: 'delai' });
    assert.equal(f.journal.fermetures, 1);
  });
  test('échéance globale : un transport qui ne rend jamais la main', async () => {
    const f = FAUX({ bloquer: true });
    const r = await lireEtat(cfgDe({ delaiGlobalMs: 60 }), f.transport);
    assert.deepEqual(r, { ok: false, erreur: 'delai' });
    assert.equal(f.journal.fermetures, 1);
  });
  test('valeur du câble de format inattendu : format', async () => {
    const f = FAUX({ dps: dpsBase('pas du json') });
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: false, erreur: 'format' });
  });
});

describe('Clé fausse', () => {
  test('le câble répond avec sa propre clé : cle', async () => {
    const f = FAUX({ cle: 'AUTRE-CLE-FAUSSE' });
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: false, erreur: 'cle' });
    assert.equal(f.journal.fermetures, 1);
  });
  test('le câble ferme la connexion pendant la négociation : cle', async () => {
    const f = FAUX({ cle: 'AUTRE-CLE-FAUSSE', cleFausse: 'fermer' });
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: false, erreur: 'cle' });
  });
  test('le câble ne répond pas du tout : delai (pas de conclusion sur la clé)', async () => {
    const f = FAUX({ cle: 'AUTRE-CLE-FAUSSE', cleFausse: 'silence' });
    assert.deepEqual(await lireEtat(cfgDe(), f.transport), { ok: false, erreur: 'delai' });
  });
  test('clé de mauvaise longueur ou absente : cle, sans ouvrir de connexion', async () => {
    for (const cleLocale of ['', 'courte', 'x'.repeat(17), undefined, 123, 'é'.repeat(15) + '€']) {
      const f = FAUX();
      assert.deepEqual(await lireEtat(cfgDe({ cleLocale }), f.transport), { ok: false, erreur: 'cle' });
      assert.equal(f.journal.ouvertures, 0);
    }
  });
  test('version autre que 3.5 : refusée sans connexion', async () => {
    const f = FAUX();
    assert.deepEqual(await lireEtat(cfgDe({ version: '3.4' }), f.transport), { ok: false, erreur: 'format' });
    assert.equal(f.journal.ouvertures, 0);
  });
});

describe('Programmer', () => {
  test('écriture normale : seuls ss et m changent, relue conforme', async () => {
    const f = FAUX();
    const r = await programmer(cfgDe(), f.transport, { allumage: '00:15' });
    assert.deepEqual(r, { ok: true, debut: '00:15', fin: '06:00', plage_active: true });
    assert.equal(f.journal.ecritures.length, 1);
    const { entete, corps } = f.journal.ecritures[0];
    assert.equal(entete, '3.5');
    assert.deepEqual(Object.keys(corps), ['protocol', 't', 'data']);
    assert.equal(corps.protocol, 5);
    assert.equal(corps.t, Math.floor(new Date(V.maintenant).getTime() / 1000));
    assert.deepEqual(Object.keys(corps.data.dps), ['151']);
    assert.equal(corps.data.dps['151'], plage(2, '00:15', '06:00'));
    assert.equal(f.journal.fermetures, 1);
  });
  test('plage inactive : m repasse à 2, dt et se recopiés', async () => {
    const f = FAUX({ dps: dpsBase(plage(0, '03:30', '06:15', 3)) });
    const r = await programmer(cfgDe(), f.transport, { allumage: '01:00' });
    assert.equal(r.ok, true);
    assert.equal(f.journal.ecritures[0].corps.data.dps['151'], plage(2, '01:00', '06:15', 3));
  });
  test('déjà réglé : rien n\'est envoyé', async () => {
    const f = FAUX();
    const r = await programmer(cfgDe(), f.transport, { allumage: '03:30' });
    assert.deepEqual(r, { ok: true, debut: '03:30', fin: '06:00', plage_active: true });
    assert.deepEqual(f.journal.ecritures, []);
  });
  test('simulation : tout sauf l\'écriture', async () => {
    const f = FAUX();
    const r = await programmer(cfgDe({ simuler: true }), f.transport, { allumage: '00:15' });
    assert.equal(r.ok, true);
    assert.equal(r.simulation, true);
    assert.equal(r.a_ecrire.debut, '00:15');
    assert.deepEqual(f.journal.ecritures, []);
    assert.equal(f.dps['151'], plage(2, '03:30', '06:00'));
  });
  test('trame coupée en deux et deux réponses dans une trame', async () => {
    for (const opts of [{ decouper: true }, { grouper: true }, { decouper: true, grouper: true }]) {
      const f = FAUX(opts);
      const r = await programmer(cfgDe(), f.transport, { allumage: '00:15' });
      assert.equal(r.ok, true, JSON.stringify(opts));
      assert.equal(f.journal.ecritures.length, 1);
    }
  });
  test('sans accusé ni annonce : la relecture décide', async () => {
    const f = FAUX({ sansAccuse: true });
    assert.equal((await programmer(cfgDe(), f.transport, { allumage: '00:15' })).ok, true);
  });

  test('heure déjà passée dans la plage : démarrage immédiat à l\'heure de Paris (hiver)', async () => {
    const f = FAUX(); // plage 03:30-06:00 ; 03:10 UTC = 04:10 à Paris en hiver
    const r = await programmer(cfgDe({ maintenant: () => new Date('2026-11-17T03:10:00Z') }), f.transport, { allumage: '03:30' });
    assert.deepEqual(r, { ok: true, debut: '04:10', fin: '06:00', plage_active: true, immediat: true });
    assert.equal(f.journal.ecritures[0].corps.data.dps['151'], plage(2, '04:10', '06:00'));
  });
  test('heure déjà passée : fuseau de Paris en été, quel que soit le fuseau du système', async () => {
    const f = FAUX(); // 02:10 UTC = 04:10 à Paris en été (UTC+2)
    const r = await programmer(cfgDe({ maintenant: () => new Date('2026-07-01T02:10:00Z') }), f.transport, { allumage: '03:30' });
    assert.equal(r.debut, '04:10');
    assert.equal(r.immediat, true);
  });
  test('heure déjà passée : plage qui passe minuit', async () => {
    const f = FAUX({ dps: dpsBase(plage(2, '22:00', '06:00')) });
    const r = await programmer(cfgDe({ maintenant: () => new Date('2026-11-16T22:30:00Z') }), f.transport, { allumage: '23:00' }); // 23:30 à Paris
    assert.equal(r.immediat, true);
    assert.equal(r.debut, '23:30');
  });
  test('heure pas encore atteinte : pas de démarrage immédiat', async () => {
    const f = FAUX();
    const r = await programmer(cfgDe({ maintenant: () => new Date('2026-11-17T02:00:00Z') }), f.transport, { allumage: '03:30' });
    assert.equal(r.immediat, undefined);
    assert.equal(r.debut, '03:30');
  });

  test('plage courte : début = fin relue moins une minute', async () => {
    const f = FAUX();
    const r = await programmer(cfgDe(), f.transport, { desactiver: true });
    assert.deepEqual(r, { ok: true, debut: '05:59', fin: '06:00', plage_active: true, courte: true });
    assert.equal(f.journal.ecritures[0].corps.data.dps['151'], plage(2, '05:59', '06:00'));
  });
  test('plage courte : fin à minuit', async () => {
    const f = FAUX({ dps: dpsBase(plage(2, '03:30', '00:00')) });
    const r = await programmer(cfgDe(), f.transport, { desactiver: true });
    assert.equal(r.debut, '23:59');
    assert.equal(r.courte, true);
  });
  test('plage courte, plage inactive : m repasse à 2', async () => {
    const f = FAUX({ dps: dpsBase(plage(0, '03:30', '06:00')) });
    const r = await programmer(cfgDe(), f.transport, { desactiver: true });
    assert.equal(r.plage_active, true);
  });
});

describe('Rien n\'est écrit quand la valeur du câble est inattendue', () => {
  const mauvaises = {
    'clé manquante': '{"m":2,"ss":"03:30","se":"06:00"}',
    'clé en plus': '{"m":2,"dt":0,"ss":"03:30","se":"06:00","x":1}',
    'ordre des clés': '{"dt":0,"m":2,"ss":"03:30","se":"06:00"}',
    'heure invalide': plage(2, '25:00', '06:00'),
    'heure sans zéro': plage(2, '3:30', '06:00'),
    'fin invalide': plage(2, '03:30', '06:60'),
    'mode inconnu': plage(1, '03:30', '06:00'),
    'mode booléen': '{"m":true,"dt":0,"ss":"03:30","se":"06:00"}',
    'dt non entier': '{"m":2,"dt":"0","ss":"03:30","se":"06:00"}',
    'tableau': '[2,0,"03:30","06:00"]',
    'nul': 'null',
    'texte': 'pas du json',
    'vide': '',
  };
  for (const [nom, valeur] of Object.entries(mauvaises)) {
    test(nom, async () => {
      const f = FAUX({ dps: dpsBase(valeur) });
      assert.deepEqual(await programmer(cfgDe(), f.transport, { allumage: '00:15' }), { ok: false, erreur: 'format' });
      assert.deepEqual(f.journal.ecritures, []);
      assert.equal(f.journal.fermetures, 1);
    });
  }
  test('dp 151 absent ou non texte', async () => {
    for (const v of [undefined, 5, { m: 2 }]) {
      const dps = dpsBase();
      if (v === undefined) delete dps['151']; else dps['151'] = v;
      const f = fauxCable({ cle: CLE, dps });
      assert.deepEqual(await programmer(cfgDe(), f.transport, { allumage: '00:15' }), { ok: false, erreur: 'format' });
      assert.deepEqual(f.journal.ecritures, []);
    }
  });
});

describe('Vérification après écriture', () => {
  test('écriture sans effet : relecture_differente', async () => {
    const f = FAUX({ ignorerEcriture: true });
    assert.deepEqual(await programmer(cfgDe(), f.transport, { allumage: '00:15' }), { ok: false, erreur: 'relecture_differente' });
    assert.equal(f.journal.ecritures.length, 1);
    assert.equal(f.journal.fermetures, 1);
  });
  test('le câble applique une autre valeur : relecture_differente', async () => {
    const f = FAUX({ transformerEcriture: () => plage(2, '00:20', '06:00') });
    assert.deepEqual(await programmer(cfgDe(), f.transport, { allumage: '00:15' }), { ok: false, erreur: 'relecture_differente' });
  });
  test('un autre point de réglage change en même temps : relecture_differente', async () => {
    const f = FAUX({ effetsEcriture: { 150: 6 } });
    assert.deepEqual(await programmer(cfgDe(), f.transport, { allumage: '00:15' }), { ok: false, erreur: 'relecture_differente' });
  });
  test('un point apparaît : relecture_differente', async () => {
    const f = FAUX({ effetsEcriture: { 999: true } });
    assert.deepEqual(await programmer(cfgDe(), f.transport, { allumage: '00:15' }), { ok: false, erreur: 'relecture_differente' });
  });
  test('points volatils (101, 102, 105, 109) ignorés', async () => {
    const f = FAUX({ effetsEcriture: { 101: 300, 102: '{"p":33}', 105: 'x', 109: 'WORKING' } });
    assert.equal((await programmer(cfgDe(), f.transport, { allumage: '00:15' })).ok, true);
  });
  test('relecture muette après l\'écriture : delai', async () => {
    const f = FAUX();
    let lectures = 0;
    const transport = { ...f.transport, async envoyer(o) { await f.transport.envoyer(o); },
      async recevoir(d) { if (f.journal.commandes.filter((c) => c === 0x10).length >= 2) { lectures++; throw Object.assign(new Error('x'), { code: 'delai' }); } return f.transport.recevoir(d); } };
    const r = await programmer(cfgDe(), transport, { allumage: '00:15' });
    assert.deepEqual(r, { ok: false, erreur: 'delai' });
    assert.ok(lectures >= 1);
  });
});

describe('Demandes invalides : rien n\'est ouvert', () => {
  const invalides = [
    { allumage: '24:00' }, { allumage: '7:30' }, { allumage: '07:30\n' }, { allumage: ' 07:30' }, { allumage: '07:60' }, { allumage: 730 },
    { allumage: '07:30', desactiver: true }, { allumage: '07:30', extra: 1 }, { desactiver: false }, { desactiver: 1 },
    { courte: true }, {}, null, undefined, 'allumage', ['07:30'], 7,
  ];
  for (const a of invalides) {
    test(JSON.stringify(a) ?? 'undefined', async () => {
      const f = FAUX();
      assert.deepEqual(await programmer(cfgDe(), f.transport, a), { ok: false, erreur: 'requete_invalide' });
      assert.equal(f.journal.ouvertures, 0);
    });
  }
});

describe('Garde-fou : seul le dp 151, et seuls ss et m', () => {
  test('quelle que soit la plage lue, chaque écriture ne change que ss et m du dp 151', async () => {
    const plages = [
      plage(2, '03:30', '06:00'), plage(0, '03:30', '06:00', 5), plage(2, '22:00', '06:00', 1), plage(0, '00:00', '23:59', 9),
      plage(2, '05:59', '06:00'), plage(0, '12:00', '00:00'),
    ];
    const actions = [{ allumage: '00:15' }, { allumage: '23:59' }, { allumage: '04:00' }, { desactiver: true }];
    const instants = ['2026-11-16T22:30:00Z', '2026-11-17T03:10:00Z', '2026-07-01T10:00:00Z'];
    let ecritures = 0;
    for (const p of plages) for (const a of actions) for (const i of instants) {
      const f = FAUX({ dps: dpsBase(p) });
      await programmer(cfgDe({ maintenant: () => new Date(i) }), f.transport, a);
      const avant = JSON.parse(p);
      for (const e of f.journal.ecritures) {
        ecritures++;
        assert.deepEqual(Object.keys(e.corps.data.dps), ['151']);
        const v = JSON.parse(e.corps.data.dps['151']);
        assert.deepEqual(Object.keys(v), ['m', 'dt', 'ss', 'se']);
        assert.equal(v.m, 2);
        assert.equal(v.dt, avant.dt);
        assert.equal(v.se, avant.se);
        assert.match(v.ss, /^([01]\d|2[0-3]):[0-5]\d$/);
      }
      assert.ok(f.journal.ecritures.length <= 1);
      assert.deepEqual(f.journal.commandes.filter((c) => c !== 0x10 && c !== 0x0d), []); // aucune autre commande
    }
    assert.ok(ecritures > 20);
  });
});

describe('La clé n\'apparaît nulle part', () => {
  test('ni dans les résultats, ni dans la console, même si le transport met la clé dans ses erreurs', async () => {
    const sortie = [];
    const orig = {};
    for (const n of ['log', 'warn', 'error', 'info', 'debug']) { orig[n] = console[n]; console[n] = (...a) => sortie.push(a.map(String).join(' ')); }
    const resultats = [];
    try {
      const f1 = FAUX({ cle: 'AUTRE-CLE-FAUSSE' });
      resultats.push(await lireEtat(cfgDe(), f1.transport));
      const f2 = FAUX({ ignorerEcriture: true });
      resultats.push(await programmer(cfgDe(), f2.transport, { allumage: '00:15' }));
      const f3 = FAUX({ dps: dpsBase('pas du json') });
      resultats.push(await programmer(cfgDe(), f3.transport, { allumage: '00:15' }));
      resultats.push(await lireEtat(cfgDe({ cleLocale: 'courte' }), FAUX().transport));
      const piege = new Error(`échec avec la clé ${CLE}`);
      const trans = {
        async ouvrir() {}, async envoyer() { throw piege; }, async recevoir() { throw piege; }, fermer() { throw piege; },
      };
      resultats.push(await lireEtat(cfgDe(), trans));
      resultats.push(await programmer(cfgDe(), { ...trans, ouvrir: async () => { throw piege; } }, { desactiver: true }));
    } finally {
      for (const n of Object.keys(orig)) console[n] = orig[n];
    }
    const tout = JSON.stringify(resultats) + sortie.join('\n');
    const cleHex = hex(new TextEncoder().encode(CLE));
    assert.ok(!tout.includes(CLE) && !tout.includes(cleHex) && !tout.includes(Buffer.from(CLE).toString('base64')));
    for (const r of resultats) assert.deepEqual(Object.keys(r).sort(), ['erreur', 'ok']);
    assert.deepEqual(resultats.map((r) => r.erreur), ['cle', 'relecture_differente', 'format', 'cle', 'hors_ligne', 'hors_ligne']);
  });
});

describe('Compatibilité avec la page (interpreterReponse de site/service.js)', () => {
  test('les succès sont acceptés comme ceux du Worker', async () => {
    let f = FAUX();
    let r = await programmer(cfgDe(), f.transport, { allumage: '00:15' });
    assert.equal(interpreterReponse({ allumage: '00:15' }, 200, r).etat, 'ok');
    f = FAUX();
    r = await programmer(cfgDe({ maintenant: () => new Date('2026-11-17T03:10:00Z') }), f.transport, { allumage: '03:30' });
    assert.equal(interpreterReponse({ allumage: '03:30' }, 200, r).etat, 'ok');
    f = FAUX();
    r = await programmer(cfgDe(), f.transport, { desactiver: true });
    assert.equal(interpreterReponse({ desactiver: true }, 200, r).etat, 'ok');
  });
  test('les échecs sont des KO (cle et format : code « inattendue » tant que site/ ne les connaît pas, lot C4)', () => {
    for (const erreur of ['hors_ligne', 'delai', 'relecture_differente', 'cle', 'format', 'requete_invalide']) {
      const res = interpreterReponse({ allumage: '00:15' }, 200, { ok: false, erreur });
      assert.equal(res.etat, 'ko', erreur);
      assert.ok(res.manuel, erreur);
    }
  });
});

describe('Ligne de commande (tools/tuya-local.mjs) : configuration seulement, jamais de connexion', () => {
  test('chargerConfig lit un fichier factice, exige la clé et l\'adresse, refuse une autre version', async () => {
    const { chargerConfig, parseEnv } = await import('../tools/tuya-local.mjs');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'tuya-local-'));
    try {
      const chemin = join(dir, 'env-factice');
      writeFileSync(chemin, `# factice\nTUYA_DEVICE_ID=${V.deviceId}\nTUYA_LOCAL_KEY="${CLE}"\nTUYA_LOCAL_IP=192.168.0.200\nsans egal\n`);
      assert.deepEqual(chargerConfig(chemin, {}), { ip: '192.168.0.200', deviceId: V.deviceId, cleLocale: CLE, version: '3.5' });
      assert.equal(chargerConfig(chemin, { TUYA_LOCAL_IP: '10.0.0.99' }).ip, '10.0.0.99');
      assert.throws(() => chargerConfig(chemin, { TUYA_LOCAL_IP: V.ip }), /IPv4 privée/); // 192.0.2.x : hors réseau privé
      assert.throws(() => chargerConfig(chemin, { TUYA_LOCAL_VERSION: '3.4' }), /3\.5/);
      writeFileSync(chemin, `TUYA_DEVICE_ID=${V.deviceId}\nTUYA_LOCAL_IP=${V.ip}\n`);
      assert.throws(() => chargerConfig(chemin, {}), (e) => /TUYA_LOCAL_KEY/.test(e.message) && !e.message.includes(V.deviceId));
      writeFileSync(chemin, `TUYA_DEVICE_ID=${V.deviceId}\nTUYA_LOCAL_KEY=${CLE}\n`);
      assert.throws(() => chargerConfig(chemin, {}), /TUYA_LOCAL_IP/);
      assert.deepEqual(parseEnv('export A=1\n#c\nB = "x y"'), { A: '1', B: 'x y' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Relecture du lot C1 : filtre d\'adresses et trames malformées', () => {
  test('transport Node : port 6668 et IPv4 privée seulement', async () => {
    const { adresseAutorisee, creerTransportNode } = await import('../local/transport-node.mjs');
    for (const ip of ['192.168.1.48', '10.0.0.1', '172.16.0.1', '172.31.255.255']) assert.ok(adresseAutorisee(ip, 6668), ip);
    for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '127.0.0.1', '0.0.0.0', '192.168.1.256', '192.168.01.1', 'cable.local', '::1', '']) {
      assert.ok(!adresseAutorisee(ip, 6668), ip);
    }
    assert.ok(!adresseAutorisee('192.168.1.48', 80));
    await assert.rejects(creerTransportNode().ouvrir('8.8.8.8', 6668, 1000), (e) => e.code === 'hors_ligne');
  });

  // Transport qui répond aux envois par des octets fixés : jamais de faux succès, réponse rapide, connexion fermée.
  const transportBrut = (octets) => {
    let ferme = false, servi = false;
    return {
      t: {
        async ouvrir() {}, async envoyer() {},
        async recevoir() { if (servi) return new Uint8Array(0); servi = true; return octets; },
        async fermer() { ferme = true; },
      },
      estFerme: () => ferme,
    };
  };
  const entete = (longueur) => {
    const b = new Uint8Array(18);
    b.set([0, 0, 0x66, 0x99]);
    new DataView(b.buffer).setUint32(14, longueur >>> 0);
    return b;
  };
  const cas = {
    'longueur énorme': entete(0xffffffff),
    'longueur « négative »': entete(0x80000000),
    'longueur nulle': entete(0),
    '100 000 octets nuls': new Uint8Array(100000),
    'octets parasites': Uint8Array.from({ length: 2000 }, (_, i) => (i * 37) & 0xff),
  };
  for (const [nom, octets] of Object.entries(cas)) {
    test(`trame malformée (${nom}) : échec rapide, connexion fermée`, async () => {
      const { t, estFerme } = transportBrut(octets);
      const debut = Date.now();
      const r = await lireEtat(cfgDe(), t);
      assert.equal(r.ok, false);
      assert.ok(['format', 'delai', 'ferme', 'cle', 'hors_ligne'].includes(r.erreur), r.erreur);
      assert.ok(Date.now() - debut < 5000);
      assert.ok(estFerme());
    });
  }
});
