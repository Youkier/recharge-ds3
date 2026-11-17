// Tests de la recherche automatique du câble (lot C2, phase 3b) : local/recherche.js et l'adresse enregistrée de
// tools/tuya-local.mjs. Faux réseau uniquement (transports simulés), aucune connexion réelle, clé factice.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as recherche from '../local/recherche.js';
import { localiserCable, candidatsDuReseau, reseauDe, adressePrivee } from '../local/recherche.js';
import { fauxCable } from './tuya-local-faux-cable.mjs';

const CLE = 'CLE-FACTICE-0000';
const AUTRE_CLE = 'AUTRE-CLE-FACT-01';
const dps = () => ({ 101: 202, 102: '{"p":0}', 107: '[6,8,10,13,16]', 109: 'WAIT', 150: 16, 151: JSON.stringify({ m: 2, dt: 0, ss: '03:30', se: '06:00' }), 152: 16 });
const cfg = () => ({ deviceId: 'factice_0000', cleLocale: CLE, version: '3.5', pause: async () => {} });

// Faux réseau : appareils = { ip: options de fauxCable }, ouverts = adresses dont le port 6668 répond sans parler Tuya (clé refusée).
function fauxReseau({ appareils = {}, portsSeuls = [], sondeLente = 0 } = {}) {
  const cables = {};
  for (const [ip, opts] of Object.entries(appareils)) cables[ip] = fauxCable({ cle: CLE, dps: dps(), ...opts });
  const ouvertures = [], sondes = [];
  let actifs = 0, maxActifs = 0;
  const sonder = async (ip) => {
    sondes.push(ip);
    actifs++; maxActifs = Math.max(maxActifs, actifs);
    if (sondeLente) await new Promise((r) => setTimeout(r, sondeLente));
    actifs--;
    return ip in cables || portsSeuls.includes(ip);
  };
  const creerTransport = () => {
    let t = null;
    return {
      async ouvrir(ip, port, d) {
        ouvertures.push(ip);
        if (!(ip in cables)) throw Object.assign(new Error('x'), { code: 'hors_ligne' });
        t = cables[ip].transport;
        return t.ouvrir(ip, port, d);
      },
      envoyer: (o) => t.envoyer(o),
      recevoir: (d) => t.recevoir(d),
      fermer: () => t?.fermer(),
    };
  };
  const ecritures = () => Object.values(cables).flatMap((c) => c.journal.ecritures);
  const commandes = () => Object.values(cables).flatMap((c) => c.journal.commandes);
  return { sonder, creerTransport, ouvertures, sondes, cables, ecritures, commandes, get maxActifs() { return maxActifs; } };
}
const chercher = (r, extra = {}) => localiserCable({ cfg: cfg(), creerTransport: r.creerTransport, sonder: r.sonder, ...extra });
const sansCle = (x) => assert.ok(!JSON.stringify(x).includes(CLE) && !JSON.stringify(x).includes(AUTRE_CLE));

describe('Module pur', () => {
  test('aucun import node:* dans local/recherche.js, un seul import (tuya-local.js)', () => {
    const src = readFileSync(new URL('../local/recherche.js', import.meta.url), 'utf8');
    assert.ok(!/from\s+['"]node:/.test(src));
    assert.deepEqual([...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./tuya-local.js']);
  });
  test('adresses privées, réseau /24 et candidats', () => {
    assert.ok(adressePrivee('192.168.1.48') && adressePrivee('10.1.2.3') && adressePrivee('172.20.0.1'));
    for (const ip of ['8.8.8.8', '192.0.2.1', '127.0.0.1', '192.168.01.1', '192.168.1.256', 'abc', '', null, undefined]) assert.ok(!adressePrivee(ip), String(ip));
    assert.equal(reseauDe('192.168.1.48'), '192.168.1');
    assert.equal(reseauDe('8.8.8.8'), null);
    const c = candidatsDuReseau('192.168.1');
    assert.equal(c.length, 254);
    assert.equal(c[0], '192.168.1.1');
    assert.equal(c[253], '192.168.1.254');
    assert.deepEqual(candidatsDuReseau('8.8.8'), []);
  });
  test('exports attendus', () => {
    assert.deepEqual(Object.keys(recherche).sort(), ['adressePrivee', 'candidatsDuReseau', 'localiserCable', 'reseauDe']);
  });
});

describe('Recherche du câble', () => {
  test('adresse connue qui répond : utilisée, aucune recherche', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.48': {} } });
    const res = await chercher(r, { departs: ['192.168.1.48'] });
    assert.equal(res.ok, true);
    assert.equal(res.ip, '192.168.1.48');
    assert.equal(res.trouve, false);
    assert.equal(res.etat.plage_active, true);
    assert.equal(r.sondes.length, 0);
  });

  test('adresse connue muette puis câble retrouvé ailleurs du même /24', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.77': {} } });
    let annonce = 0;
    const res = await chercher(r, { departs: ['192.168.1.48'], surRecherche: () => annonce++ });
    assert.deepEqual([res.ok, res.ip, res.trouve], [true, '192.168.1.77', true]);
    assert.equal(annonce, 1);
    assert.equal(r.sondes.length, 253); // /24 sans l'adresse déjà essayée
    assert.ok(r.sondes.every((ip) => ip.startsWith('192.168.1.')));
    assert.ok(!r.sondes.includes('192.168.1.48'));
    assert.ok(r.maxActifs <= 32);
    sansCle(res);
  });

  test('adresse enregistrée essayée si TUYA_LOCAL_IP est muette, et son /24 aussi', async () => {
    const r = fauxReseau({ appareils: { '10.0.0.9': {} } });
    const res = await chercher(r, { departs: ['192.168.1.48', '10.0.0.5'] });
    assert.deepEqual([res.ok, res.ip, res.trouve], [true, '10.0.0.9', true]);
    assert.ok(r.ouvertures.slice(0, 2).join() === '192.168.1.48,10.0.0.5');
  });

  test('aucune adresse de départ : /24 de chaque interface du PC', async () => {
    const r = fauxReseau({ appareils: { '172.20.5.30': {} } });
    const res = await chercher(r, { departs: [], interfaces: ['192.168.56.1', '172.20.5.2', '192.168.56.7'] });
    assert.deepEqual([res.ok, res.ip, res.trouve], [true, '172.20.5.30', true]);
    assert.ok(r.sondes.some((ip) => ip.startsWith('192.168.56.')));
    assert.ok(r.sondes.every((ip) => /^(192\.168\.56|172\.20\.5)\./.test(ip)));
  });

  test('adresses de départ non privées ignorées, interfaces non privées ignorées', async () => {
    const r = fauxReseau({ appareils: {} });
    const res = await chercher(r, { departs: ['8.8.8.8', 'pas une adresse', '192.0.2.4'], interfaces: ['8.8.4.4'] });
    assert.deepEqual(res, { ok: false, erreur: 'hors_ligne', recherche: true });
    assert.equal(r.sondes.length, 0);
    assert.equal(r.ouvertures.length, 0);
  });

  test('zéro câble : hors_ligne, recherche signalée', async () => {
    const r = fauxReseau();
    const res = await chercher(r, { departs: ['192.168.1.48'] });
    assert.deepEqual(res, { ok: false, erreur: 'hors_ligne', recherche: true });
  });

  test('deux appareils acceptent la clé : échec, jamais de choix au hasard', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.60': {}, '192.168.1.61': {} } });
    const res = await chercher(r, { departs: ['192.168.1.48'] });
    assert.deepEqual(res, { ok: false, erreur: 'hors_ligne', recherche: true });
  });

  test('port ouvert mais clé refusée : ignoré, aucune lecture de ses données', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.90': { cle: AUTRE_CLE }, '192.168.1.91': {} } });
    const res = await chercher(r, { departs: ['192.168.1.48'] });
    assert.deepEqual([res.ok, res.ip], [true, '192.168.1.91']);
    assert.equal(r.cables['192.168.1.90'].journal.commandes.length, 0); // clé non déchiffrée : jamais de lecture ni d'écriture
    assert.equal(r.cables['192.168.1.90'].journal.ecritures.length, 0);
    assert.ok(r.cables['192.168.1.90'].journal.fermetures >= 1);
  });

  test('port ouvert sans protocole Tuya (aucune réponse) : ignoré', async () => {
    const r = fauxReseau({ portsSeuls: ['192.168.1.5'], appareils: { '192.168.1.91': {} } });
    const res = await chercher(r, { departs: ['192.168.1.48'], delaiLectureMs: 300 });
    assert.deepEqual([res.ok, res.ip], [true, '192.168.1.91']);
  });

  test('un seul appareil avec la clé, mais un autre muet à la négociation : échec seulement si deux câbles', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.60': { cleFausse: 'silence', cle: AUTRE_CLE }, '192.168.1.61': {} } });
    const res = await chercher(r, { departs: [], interfaces: ['192.168.1.2'], delaiLectureMs: 300 });
    assert.deepEqual([res.ok, res.ip], [true, '192.168.1.61']);
  });

  test('échéance globale : la recherche s\'arrête, échec hors_ligne', async () => {
    const t0 = Date.now();
    const res = await localiserCable({
      cfg: cfg(), departs: ['192.168.1.48'], creerTransport: () => { throw new Error('inutile'); },
      sonder: () => new Promise(() => {}), delaiTotalMs: 80,
    });
    assert.deepEqual(res, { ok: false, erreur: 'hors_ligne', recherche: true });
    assert.ok(Date.now() - t0 < 2000);
  });

  test('échéance globale : un câble trouvé trop tard n\'est pas retenu', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.77': {} }, sondeLente: 30 });
    const res = await chercher(r, { departs: ['192.168.1.48'], delaiTotalMs: 60, parallelisme: 2 });
    assert.equal(res.ok, false);
    assert.equal(res.erreur, 'hors_ligne');
  });

  test('aucune écriture ni commande hors négociation et lecture pendant la recherche', async () => {
    const r = fauxReseau({ appareils: { '192.168.1.77': {}, '192.168.1.78': { cle: AUTRE_CLE } } });
    const res = await chercher(r, { departs: ['192.168.1.48'] });
    assert.equal(res.ok, true);
    assert.equal(r.ecritures().length, 0);
    assert.ok(!r.commandes().includes(0x0d)); // aucune commande d'écriture (cmd 0x0d)
  });

  test('transport inattendu qui échoue : traité comme injoignable, sans exception', async () => {
    const res = await localiserCable({
      cfg: cfg(), departs: ['192.168.1.48'], creerTransport: () => { throw new Error(CLE); }, sonder: async () => { throw new Error(CLE); },
      delaiTotalMs: 2000,
    });
    assert.deepEqual(res, { ok: false, erreur: 'hors_ligne', recherche: true });
    sansCle(res);
  });
});

describe('Adresse enregistrée et interfaces (tools/tuya-local.mjs)', () => {
  test('lecture : valide, corrompue, non privée, absente ; écriture : adresse seule', async () => {
    const { lireAdresseEnregistree, enregistrerAdresse, adressesDuPc } = await import('../tools/tuya-local.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'cable-adresse-'));
    try {
      const f = join(dir, 'sous', 'cable-adresse.json');
      assert.equal(lireAdresseEnregistree(f), null); // absent
      enregistrerAdresse('192.168.1.77', f); // crée le dossier
      assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { ip: '192.168.1.77' });
      assert.equal(lireAdresseEnregistree(f), '192.168.1.77');
      writeFileSync(f, '{pas du json');
      assert.equal(lireAdresseEnregistree(f), null);
      writeFileSync(f, JSON.stringify({ ip: '8.8.8.8' }));
      assert.equal(lireAdresseEnregistree(f), null);
      writeFileSync(f, JSON.stringify({ ip: 42 }));
      assert.equal(lireAdresseEnregistree(f), null);
      writeFileSync(f, 'null');
      assert.equal(lireAdresseEnregistree(f), null);
      enregistrerAdresse('8.8.8.8', f); // refusée : fichier inchangé
      assert.equal(readFileSync(f, 'utf8'), 'null');
      enregistrerAdresse('10.0.0.4', f);
      assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { ip: '10.0.0.4' });
      assert.ok(existsSync(f));
    } finally { rmSync(dir, { recursive: true, force: true }); }

    const faux = {
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      wifi: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }],
      vpn: [{ family: 4, address: '10.8.0.2', internal: false }, { family: 'IPv4', address: '203.0.113.5', internal: false }],
    };
    assert.deepEqual(adressesDuPc(faux), ['192.168.1.20', '10.8.0.2']);
  });

  test('chargerConfig : adresse facultative seulement sur demande', async () => {
    const { chargerConfig } = await import('../tools/tuya-local.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'cfg-recherche-'));
    try {
      const chemin = join(dir, 'env-factice');
      writeFileSync(chemin, `TUYA_DEVICE_ID=factice_0000\nTUYA_LOCAL_KEY=${CLE}\n`);
      assert.throws(() => chargerConfig(chemin, {}), /TUYA_LOCAL_IP/);
      const c = chargerConfig(chemin, {}, { ipFacultative: true });
      assert.equal(c.ip, undefined);
      assert.throws(() => chargerConfig(chemin, { TUYA_LOCAL_IP: '8.8.8.8' }, { ipFacultative: true }), /IPv4 privée/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('sonde de port Node : refuse sans connexion toute adresse non privée', async () => {
    const { sonderPort } = await import('../local/transport-node.mjs');
    for (const ip of ['8.8.8.8', '127.0.0.1', 'cable.local', '']) assert.equal(await sonderPort(ip, 50), false, ip);
  });
});
