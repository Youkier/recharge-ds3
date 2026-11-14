import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  traiter, signer, decider, heureParis, jetonValide, validerCorps, nouvellePlage,
  reinitialiserCache, reinitialiserLimiteur,
} from '../worker/src/index.js';
import { signer as signerSonde } from '../tools/tuya-probe.mjs';

const JETON = 'jeton-de-test-0123456789-abcdefghijklmnop';
const ENV = {
  TUYA_ACCESS_ID: 'idtest1234567890', TUYA_ACCESS_SECRET: 'secrettest1234567890abcdef', TUYA_DEVICE_ID: 'devicetest0987654321',
  JETON_ACCES: JETON, ORIGINE_AUTORISEE: 'https://exemple.github.io', TUYA_ENDPOINT: 'https://openapi.tuyaeu.com',
};
const ACCESS_TOKEN_TUYA = 'tokentuya-abcdef-0123456789';
const NUIT = new Date('2026-11-14T18:00:00Z'); // 19:00 à Paris, hors plage 22:30-06:00

beforeEach(() => { reinitialiserCache(); reinitialiserLimiteur(); });

// --- Câble simulé : une valeur x_charge_mode et un journal des appels ---
function cable({ valeur = { m: 2, dt: 0, ss: '04:00', se: '06:00' }, ignorerEcriture = false, erreurLecture = null, erreurEcriture = null, erreurJeton = null, pendre = false } = {}) {
  const etat = { valeur: JSON.stringify(valeur), appels: [], ecritures: [] };
  etat.fetch = async (url, init = {}) => {
    const u = new URL(url);
    etat.appels.push({ methode: init.method, chemin: u.pathname, url: String(url), entetes: init.headers, corps: init.body });
    if (pendre) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    const rep = (o, statut = 200) => new Response(JSON.stringify(o), { status: statut });
    if (u.pathname === '/v1.0/token') return erreurJeton ? rep(erreurJeton) : rep({ success: true, result: { access_token: ACCESS_TOKEN_TUYA, expire_time: 7200, refresh_token: 'x' } });
    if (u.pathname === `/v2.0/cloud/thing/${ENV.TUYA_DEVICE_ID}/shadow/properties` && init.method === 'GET') {
      if (erreurLecture) return rep(erreurLecture);
      return rep({ success: true, result: { properties: [{ code: 'x_charge_current', dp_id: 150, value: 16 }, { code: 'x_charge_mode', dp_id: 151, type: 'string', value: etat.valeur }] } });
    }
    if (u.pathname === `/v2.0/cloud/thing/${ENV.TUYA_DEVICE_ID}/shadow/properties/issue` && init.method === 'POST') {
      if (erreurEcriture) return rep(erreurEcriture);
      const props = JSON.parse(JSON.parse(init.body).properties);
      etat.ecritures.push(props);
      if (!ignorerEcriture) etat.valeur = props.x_charge_mode;
      return rep({ success: true, result: {} });
    }
    return rep({ success: false, code: 404, msg: 'inattendu' }, 404);
  };
  return etat;
}

const deps = (c, extra = {}) => ({ fetch: c.fetch, now: () => NUIT, sleep: async () => {}, attentes: [0, 0], ...extra });
const req = (chemin, { methode = 'GET', jeton = JETON, corps, origine, entetes = {} } = {}) => new Request('https://w.example' + chemin, {
  method: methode, body: corps, headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(origine ? { Origin: origine } : {}), ...entetes },
});
const appel = async (r, c, env = ENV, extra = {}) => {
  const rep = await traiter(r, env, deps(c, extra));
  return { statut: rep.status, corps: await rep.text().then((t) => (t ? JSON.parse(t) : null)), entetes: rep.headers };
};
const post = (corps, opt = {}) => req('/api/programmer', { methode: 'POST', corps: typeof corps === 'string' ? corps : JSON.stringify(corps), ...opt });

// --- Signature ---
const base = {
  clientId: '1KAD46OrT9HafiKdsXeg', secret: '4OHBOnWOqaEC1mWXOpVL3yV50s0qGSRC', t: '1588925778000', nonce: '5138cc3a9033d69856923fd07b491173',
  entetesSignes: 'area_id:29a33e8796834b1efa6\ncall_id:8afdb70ab2ed11eb85290242ac130003\n',
};
test('signature : vecteurs officiels Tuya (jeton et requête métier)', async () => {
  assert.equal(await signer({ ...base, methode: 'GET', chemin: '/v1.0/token', query: { grant_type: 1 } }), '9E48A3E93B302EEECC803C7241985D0A34EB944F40FB573C7B5C2A82158AF13E');
  assert.equal(await signer({ ...base, accessToken: '3f4eda2bdec17232f67c0b188af3eec1', methode: 'GET', chemin: '/v2.0/apps/schema/users', query: { page_size: 50, page_no: 1 } }),
    'AE4481C692AA80B25F3A7E12C3A5FD9BBF6251539DD78E565A1A72A508A88784');
});
test('signature : identique à celle de la sonde, corps compris', async () => {
  const p = { clientId: 'abc', secret: 'def', t: '1700000000000', nonce: 'n', accessToken: 'tok', methode: 'POST', chemin: '/x/y', corps: '{"a":1}' };
  assert.equal(await signer(p), signerSonde(p));
});

// --- Jeton ---
test('jeton : comparaison correcte, refus des variantes', async () => {
  assert.equal(await jetonValide(`Bearer ${JETON}`, JETON), true);
  for (const e of [null, '', JETON, `bearer ${JETON}`, `Bearer ${JETON}x`, `Bearer ${JETON.slice(1)}`, 'Bearer ', `Bearer  ${JETON}`]) assert.equal(await jetonValide(e, JETON), false, String(e));
  assert.equal(await jetonValide('Bearer ', ''), false);
  assert.equal(await jetonValide('Bearer x', undefined), false);
});
test('401 sans jeton, avec mauvais jeton, ou sans secret configuré, et aucun appel Tuya', async () => {
  for (const [r, env] of [
    [req('/api/etat', { jeton: null }), ENV],
    [req('/api/etat', { jeton: 'mauvais' }), ENV],
    [post({ allumage: '22:30' }, { jeton: null }), ENV],
    [post({ allumage: '22:30' }, { jeton: 'mauvais' }), ENV],
    [req('/api/inconnu', { jeton: null }), ENV],
    [req('/api/etat', { jeton: '' }), { ...ENV, JETON_ACCES: '' }],
    [req('/api/etat'), { ...ENV, JETON_ACCES: undefined }],
  ]) {
    const c = cable();
    const a = await appel(r, c, env);
    assert.equal(a.statut, 401);
    assert.deepEqual(a.corps, { ok: false, erreur: 'non_autorise' });
    assert.equal(c.appels.length, 0);
  }
});

// --- Routage et validation ---
test('routage : 404, 405, 400', async () => {
  const c = cable();
  assert.equal((await appel(req('/'), c)).statut, 404);
  assert.equal((await appel(req('/api/commande', { methode: 'POST', corps: '{}' }), c)).statut, 404);
  assert.equal((await appel(req('/api/etat/'), c)).statut, 404);
  const m1 = await appel(req('/api/etat', { methode: 'POST', corps: '{}' }), c);
  assert.equal(m1.statut, 405); assert.equal(m1.entetes.get('Allow'), 'GET');
  const m2 = await appel(req('/api/programmer'), c);
  assert.equal(m2.statut, 405); assert.equal(m2.entetes.get('Allow'), 'POST');
  assert.equal((await appel(req('/api/programmer', { methode: 'PUT', corps: '{}' }), c)).statut, 405);
  for (const corps of ['', 'pas du json', '[]', 'null', '"22:30"', '{}', '{"allumage":"24:00"}', '{"allumage":"7:30"}', '{"allumage":"22:30 "}', '{"allumage":"22:30\\n"}',
    '{"allumage":2230}', '{"allumage":"22:30","courant":6}', '{"allumage":"22:30","device_id":"autre"}', '{"desactiver":false}', '{"desactiver":"true"}',
    '{"allumage":"22:30","desactiver":true}', '{"code":"x_do_charge","value":true}', '{"allumage":"' + '1'.repeat(600) + '"}']) {
    const a = await appel(post(corps), c);
    assert.equal(a.statut, 400, corps);
    assert.deepEqual(a.corps, { ok: false, erreur: 'requete_invalide' });
  }
  assert.equal(c.ecritures.length, 0);
  assert.deepEqual(validerCorps('{"allumage":"00:00"}'), { allumage: '00:00' });
  assert.deepEqual(validerCorps('{"allumage":"23:59"}'), { allumage: '23:59' });
});
test('l\'identifiant de l\'appareil ne vient que de l\'environnement', async () => {
  const c = cable();
  await appel(req('/api/etat?device_id=autre&id=autre'), c);
  await appel(post({ allumage: '22:30' }, { entetes: { 'X-Device-Id': 'autre' } }), c);
  assert.ok(c.appels.length > 0);
  for (const a of c.appels) assert.ok(!a.url.includes('autre') && (a.chemin === '/v1.0/token' || a.chemin.includes(ENV.TUYA_DEVICE_ID)));
});

// --- Lecture ---
test('GET /api/etat : lecture seule, charge_active null', async () => {
  const c = cable();
  const a = await appel(req('/api/etat'), c);
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps, { ok: true, debut: '04:00', fin: '06:00', plage_active: true, charge_active: null });
  assert.ok(c.appels.every((x) => x.methode === 'GET'));
  assert.equal(c.ecritures.length, 0);
  const d = await appel(req('/api/etat'), cable({ valeur: { m: 0, dt: 0, ss: '04:00', se: '06:00' } }));
  assert.equal(d.corps.plage_active, false);
});
test('GET /api/etat : valeur de plage inattendue -> tuya, sans fuite', async () => {
  for (const valeur of [{ m: 5, dt: 0, ss: '04:00', se: '06:00' }, { m: 2, ss: '04:00', se: '06:00' }, { m: 2, dt: 0, ss: 'x', se: '06:00' }]) {
    const a = await appel(req('/api/etat'), cable({ valeur }));
    assert.equal(a.statut, 502); assert.deepEqual(a.corps, { ok: false, erreur: 'tuya' });
  }
});

// --- Écriture ---
test('écriture : ne change que ss et m, corps au format validé, signé avec le jeton Tuya', async () => {
  const c = cable({ valeur: { m: 0, dt: 7, ss: '04:00', se: '06:00' } });
  const a = await appel(post({ allumage: '22:30' }), c);
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps, { ok: true, debut: '22:30', fin: '06:00', plage_active: true, charge_active: null });
  assert.equal(c.ecritures.length, 1);
  assert.deepEqual(Object.keys(c.ecritures[0]), ['x_charge_mode']);
  assert.deepEqual(JSON.parse(c.ecritures[0].x_charge_mode), { m: 2, dt: 7, ss: '22:30', se: '06:00' });
  const ecr = c.appels.find((x) => x.methode === 'POST');
  assert.equal(ecr.entetes.access_token, ACCESS_TOKEN_TUYA);
  assert.equal(ecr.entetes.client_id, ENV.TUYA_ACCESS_ID);
  assert.equal(ecr.entetes.sign_method, 'HMAC-SHA256');
  assert.match(ecr.entetes.sign, /^[0-9A-F]{64}$/);
  assert.equal(ecr.entetes.sign, await signer({ clientId: ENV.TUYA_ACCESS_ID, secret: ENV.TUYA_ACCESS_SECRET, t: ecr.entetes.t, nonce: ecr.entetes.nonce, accessToken: ACCESS_TOKEN_TUYA, methode: 'POST', chemin: ecr.chemin, corps: ecr.corps }));
  assert.ok(ecr.url.startsWith('https://openapi.tuyaeu.com/'));
  assert.deepEqual(nouvellePlage({ m: 2, dt: 1, ss: '01:00', se: '02:00' }, '03:00'), { m: 2, dt: 1, ss: '03:00', se: '02:00' });
});
test('écriture : jamais d\'autre point que x_charge_mode, jamais m = 0 ni x_do_charge', async () => {
  const c = cable();
  for (const h of ['00:00', '22:30', '23:59', '05:59']) await appel(post({ allumage: h }), c, ENV, { now: () => NUIT });
  for (const e of c.ecritures) { assert.deepEqual(Object.keys(e), ['x_charge_mode']); assert.equal(JSON.parse(e.x_charge_mode).m, 2); }
  assert.ok(c.appels.every((x) => !x.corps || !x.corps.includes('x_do_charge')));
});
test('déjà réglé : pas d\'écriture, succès après relecture', async () => {
  const c = cable({ valeur: { m: 2, dt: 0, ss: '22:30', se: '06:00' } });
  const a = await appel(post({ allumage: '22:30' }), c);
  assert.equal(a.statut, 200); assert.equal(c.ecritures.length, 0); assert.equal(a.corps.debut, '22:30');
});
test('relecture différente -> relecture_differente, jamais de faux succès', async () => {
  const c = cable({ ignorerEcriture: true });
  const a = await appel(post({ allumage: '22:30' }), c);
  assert.equal(a.statut, 502);
  assert.deepEqual(a.corps, { ok: false, erreur: 'relecture_differente' });
  // Le câble corrige dt/se de son côté : aussi refusé.
  const c2 = cable(); const f = c2.fetch;
  c2.fetch = async (u, i) => { const r = await f(u, i); if (i?.method === 'POST') c2.valeur = JSON.stringify({ m: 2, dt: 0, ss: '22:30', se: '07:00' }); return r; };
  assert.equal((await appel(post({ allumage: '22:30' }), c2)).corps.erreur, 'relecture_differente');
});
test('relecture : la valeur peut mettre un peu de temps à changer', async () => {
  const c = cable(); const f = c.fetch; let lectures = 0;
  c.fetch = async (u, i) => {
    const nouvelle = c.valeur;
    const r = await f(u, i);
    if (i?.method === 'GET' && new URL(u).pathname.endsWith('/properties')) { lectures++; if (lectures === 2) return new Response(JSON.stringify({ success: true, result: { properties: [{ code: 'x_charge_mode', value: JSON.stringify({ m: 2, dt: 0, ss: '04:00', se: '06:00' }) }] } })); }
    void nouvelle; return r;
  };
  const a = await appel(post({ allumage: '22:30' }), c, ENV, { attentes: [0, 0, 0] });
  assert.equal(a.statut, 200); assert.equal(a.corps.debut, '22:30');
});

// --- Désactiver ---
test('désactiver -> 501 non_disponible, aucune écriture, aucun appel Tuya', async () => {
  const c = cable();
  const a = await appel(post({ desactiver: true }), c);
  assert.equal(a.statut, 501);
  assert.deepEqual(a.corps, { ok: false, erreur: 'non_disponible' });
  assert.equal(c.ecritures.length, 0);
  assert.ok(c.appels.every((x) => x.methode === 'GET'));
});

// --- Erreurs Tuya ---
test('mapping des erreurs Tuya', async () => {
  const cas = [
    ['lecture : appareil hors ligne (2001)', { erreurLecture: { success: false, code: 2001, msg: 'device is offline' } }, 502, 'hors_ligne'],
    ['lecture : hors ligne (40000801)', { erreurLecture: { success: false, code: 40000801, msg: 'Device offline' } }, 502, 'hors_ligne'],
    ['lecture : message contenant offline', { erreurLecture: { success: false, code: 12345, msg: 'the device is offline now' } }, 502, 'hors_ligne'],
    ['lecture : permission refusée (1106)', { erreurLecture: { success: false, code: 1106, msg: 'permission deny' } }, 502, 'jeton'],
    ['lecture : abonnement expiré', { erreurLecture: { success: false, code: 28841102, msg: 'API subscription expired' } }, 502, 'jeton'],
    ['lecture : code inconnu', { erreurLecture: { success: false, code: 999999, msg: 'secret-interne' } }, 502, 'tuya'],
    ['lecture : trop fréquent (1199)', { erreurLecture: { success: false, code: 1199, msg: 'your requests are too frequent' } }, 502, 'tuya'],
    ['jeton : signature invalide (1004)', { erreurJeton: { success: false, code: 1004, msg: 'sign invalid' } }, 502, 'jeton'],
    ['jeton : réponse d\'erreur inconnue', { erreurJeton: { success: false, code: 4242, msg: 'x' } }, 502, 'tuya'],
    ['jeton : accès refusé 1106', { erreurJeton: { success: false, code: 1106, msg: 'permission deny' } }, 502, 'jeton'],
  ];
  for (const [nom, opt, statut, code] of cas) {
    reinitialiserCache();
    const c = cable(opt);
    const a = await appel(req('/api/etat'), c);
    assert.equal(a.statut, statut, nom);
    assert.deepEqual(a.corps, { ok: false, erreur: code }, nom);
  }
  // Erreur à l'écriture : câble hors ligne.
  const c = cable({ erreurEcriture: { success: false, code: 2001, msg: 'device is offline' } });
  const a = await appel(post({ allumage: '22:30' }), c);
  assert.deepEqual(a.corps, { ok: false, erreur: 'hors_ligne' });
});
test('jeton Tuya expiré : un nouveau est demandé, une seule nouvelle tentative', async () => {
  const c = cable(); const f = c.fetch; let nb = 0;
  c.fetch = async (u, i) => {
    if (new URL(u).pathname.endsWith('/properties') && i.method === 'GET' && nb++ === 0) return new Response(JSON.stringify({ success: false, code: 1010, msg: 'token is expired' }));
    return f(u, i);
  };
  assert.equal((await appel(req('/api/etat'), c)).statut, 200);
  assert.equal(c.appels.filter((x) => x.chemin === '/v1.0/token').length, 2);
  // Toujours expiré : jeton, sans boucle.
  reinitialiserCache();
  const c2 = cable({ erreurLecture: { success: false, code: 1010, msg: 'token is expired' } });
  const a = await appel(req('/api/etat'), c2);
  assert.deepEqual(a.corps, { ok: false, erreur: 'jeton' });
  assert.ok(c2.appels.length <= 5);
});
test('jeton Tuya mis en cache entre deux requêtes, redemandé après expiration', async () => {
  const c = cable();
  await appel(req('/api/etat'), c); await appel(req('/api/etat'), c);
  assert.equal(c.appels.filter((x) => x.chemin === '/v1.0/token').length, 1);
  const plusTard = new Date(NUIT.getTime() + 7200 * 1000);
  await appel(req('/api/etat'), c, ENV, { now: () => plusTard });
  assert.equal(c.appels.filter((x) => x.chemin === '/v1.0/token').length, 2);
});
test('délai de 10 s dépassé -> delai (simulé en 30 ms)', async () => {
  const c = cable({ pendre: true });
  const a = await appel(req('/api/etat'), c, ENV, { delaiMs: 30 });
  assert.equal(a.statut, 504);
  assert.deepEqual(a.corps, { ok: false, erreur: 'delai' });
  const b = await appel(post({ allumage: '22:30' }), c, ENV, { delaiMs: 30 });
  assert.equal(b.corps.erreur, 'delai');
});
test('panne réseau, réponse non JSON, configuration incomplète -> tuya', async () => {
  const c = cable();
  assert.equal((await appel(req('/api/etat'), c, ENV, { fetch: async () => { throw new TypeError('réseau'); } })).corps.erreur, 'tuya');
  assert.equal((await appel(req('/api/etat'), c, ENV, { fetch: async () => new Response('<html>') })).corps.erreur, 'tuya');
  const sans = await appel(req('/api/etat'), c, { ...ENV, TUYA_DEVICE_ID: '' });
  assert.deepEqual(sans.corps, { ok: false, erreur: 'tuya' });
});

// --- Heure déjà passée ---
test('heureParis : été, hiver, minuit', () => {
  assert.equal(heureParis(new Date('2026-07-01T21:30:00Z')), '23:30');
  assert.equal(heureParis(new Date('2026-01-15T22:30:00Z')), '23:30');
  assert.equal(heureParis(new Date('2026-07-01T22:00:00Z')), '00:00');
  assert.equal(heureParis(new Date('2026-01-15T23:00:00Z')), '00:00');
});
test('decider : hors plage, dans la plage, minuit', () => {
  const T = (iso) => new Date(iso);
  // 22:30 -> 06:00, hiver (UTC+1)
  assert.deepEqual(decider('22:30', '06:00', T('2026-01-15T20:00:00Z')), { debut: '22:30', immediat: false }); // 21:00
  assert.deepEqual(decider('22:30', '06:00', T('2026-01-15T21:30:00Z')), { debut: '22:30', immediat: true }); // 22:30 pile
  assert.deepEqual(decider('22:30', '06:00', T('2026-01-15T22:10:00Z')), { debut: '23:10', immediat: true });
  assert.deepEqual(decider('22:30', '06:00', T('2026-01-15T23:00:00Z')), { debut: '00:00', immediat: true }); // minuit
  assert.deepEqual(decider('22:30', '06:00', T('2026-01-16T04:59:00Z')), { debut: '05:59', immediat: true });
  assert.deepEqual(decider('22:30', '06:00', T('2026-01-16T05:00:00Z')), { debut: '22:30', immediat: false }); // 06:00 : fin exclue
  // plage sans passage de minuit
  assert.deepEqual(decider('01:00', '06:00', T('2026-01-15T23:30:00Z')), { debut: '01:00', immediat: false }); // 00:30 : avant le début
  assert.deepEqual(decider('01:00', '06:00', T('2026-01-16T00:30:00Z')), { debut: '01:30', immediat: true });
  assert.deepEqual(decider('01:00', '06:00', T('2026-01-16T05:00:00Z')), { debut: '01:00', immediat: false });
  // début = fin : plage vide, jamais immédiat
  assert.equal(decider('06:00', '06:00', T('2026-01-16T03:00:00Z')).immediat, false);
});
test('decider : passage à l\'heure d\'été (dimanche 2026-03-29, 02:00 -> 03:00)', () => {
  assert.equal(heureParis(new Date('2026-03-29T00:59:00Z')), '01:59');
  assert.equal(heureParis(new Date('2026-03-29T01:00:00Z')), '03:00');
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-03-28T22:30:00Z')), { debut: '23:30', immediat: true }); // veille, encore CET
  assert.deepEqual(decider('02:30', '06:00', new Date('2026-03-29T01:30:00Z')), { debut: '03:30', immediat: true }); // 02:30 n'existe pas
  assert.deepEqual(decider('03:30', '06:00', new Date('2026-03-29T00:59:00Z')), { debut: '03:30', immediat: false }); // 01:59
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-03-29T03:59:00Z')), { debut: '05:59', immediat: true }); // 05:59 CEST
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-03-29T04:00:00Z')), { debut: '22:30', immediat: false }); // 06:00 CEST
});
test('decider : retour à l\'heure d\'hiver (dimanche 2026-10-25, 03:00 -> 02:00)', () => {
  assert.equal(heureParis(new Date('2026-10-25T00:30:00Z')), '02:30'); // CEST
  assert.equal(heureParis(new Date('2026-10-25T01:30:00Z')), '02:30'); // CET : 02:30 existe deux fois
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-10-25T00:30:00Z')), { debut: '02:30', immediat: true });
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-10-25T01:30:00Z')), { debut: '02:30', immediat: true });
  assert.deepEqual(decider('02:45', '06:00', new Date('2026-10-25T01:30:00Z')), { debut: '02:45', immediat: false });
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-10-25T04:59:00Z')), { debut: '05:59', immediat: true }); // CET
  assert.deepEqual(decider('22:30', '06:00', new Date('2026-10-25T05:00:00Z')), { debut: '22:30', immediat: false }); // 06:00 CET
});
test('heure passée : le service écrit l\'heure actuelle et renvoie immediat', async () => {
  const c = cable({ valeur: { m: 2, dt: 0, ss: '04:00', se: '06:00' } });
  const a = await appel(post({ allumage: '22:30' }), c, ENV, { now: () => new Date('2026-01-15T22:10:00Z') });
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps, { ok: true, debut: '23:10', fin: '06:00', plage_active: true, charge_active: null, immediat: true });
  assert.equal(JSON.parse(c.ecritures[0].x_charge_mode).ss, '23:10');
  // heure à venir : pas de champ immediat
  const c2 = cable();
  const b = await appel(post({ allumage: '22:30' }), c2);
  assert.ok(!('immediat' in b.corps));
});
test('heure passée : la fin utilisée est celle relue sur le câble', async () => {
  const c = cable({ valeur: { m: 2, dt: 0, ss: '04:00', se: '23:00' } });
  // 22:10 UTC en hiver = 23:10 Paris, après la fin 23:00 : pas immédiat
  const a = await appel(post({ allumage: '22:30' }), c, ENV, { now: () => new Date('2026-01-15T22:10:00Z') });
  assert.equal(a.corps.debut, '22:30'); assert.ok(!a.corps.immediat);
});

// --- CORS ---
test('CORS : préflight de l\'origine autorisée, refus des autres, sans jeton ni appel Tuya', async () => {
  const c = cable();
  const ok = await traiter(req('/api/programmer', { methode: 'OPTIONS', jeton: null, origine: ENV.ORIGINE_AUTORISEE }), ENV, deps(c));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ENV.ORIGINE_AUTORISEE);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal(ok.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  for (const [origine, chemin] of [['https://autre.example', '/api/etat'], [null, '/api/etat'], [ENV.ORIGINE_AUTORISEE, '/api/autre']]) {
    const r = await traiter(req(chemin, { methode: 'OPTIONS', jeton: null, origine }), ENV, deps(c));
    assert.equal(r.status, 403); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  }
  const sansOrigine = await traiter(req('/api/etat', { methode: 'OPTIONS', jeton: null, origine: 'https://x.example' }), { ...ENV, ORIGINE_AUTORISEE: '' }, deps(c));
  assert.equal(sansOrigine.status, 403);
  assert.equal(c.appels.length, 0);
});
test('CORS : en-têtes sur les réponses (succès et erreur), absents pour une autre origine', async () => {
  const c = cable();
  assert.equal((await appel(req('/api/etat', { origine: ENV.ORIGINE_AUTORISEE }), c)).entetes.get('Access-Control-Allow-Origin'), ENV.ORIGINE_AUTORISEE);
  assert.equal((await appel(req('/api/etat', { origine: ENV.ORIGINE_AUTORISEE, jeton: null }), c)).entetes.get('Access-Control-Allow-Origin'), ENV.ORIGINE_AUTORISEE);
  const autre = await appel(req('/api/etat', { origine: 'https://autre.example' }), c);
  assert.equal(autre.entetes.get('Access-Control-Allow-Origin'), null);
  assert.equal(autre.entetes.get('Access-Control-Allow-Origin') === '*', false);
});

// --- Limite d'appels ---
test('429 quand le binding de limitation refuse ; la requête n\'atteint pas Tuya', async () => {
  const c = cable(); let appels = 0;
  const env = { ...ENV, LIMITEUR: { limit: async () => ({ success: ++appels <= 2 }) } };
  assert.equal((await appel(req('/api/etat'), c, env)).statut, 200);
  assert.equal((await appel(req('/api/etat'), c, env)).statut, 200);
  const nb = c.appels.length;
  const r = await appel(req('/api/etat'), c, env);
  assert.equal(r.statut, 429); assert.equal(r.corps.ok, false); assert.equal(c.appels.length, nb);
  // un mauvais jeton reste 401 et ne consomme pas le quota
  let n = 0; const env2 = { ...ENV, LIMITEUR: { limit: async () => { n++; return { success: true }; } } };
  assert.equal((await appel(req('/api/etat', { jeton: 'mauvais' }), c, env2)).statut, 401); assert.equal(n, 0);
});
test('limiteur en panne : réponse JSON du contrat, aucun appel Tuya', async () => {
  const c = cable(); const orig = console.error; console.error = () => {};
  try {
    const env = { ...ENV, LIMITEUR: { limit: async () => { throw new Error('panne'); } } };
    const r = await appel(post({ allumage: '01:00' }), c, env);
    assert.equal(r.corps.ok, false); assert.equal(r.corps.erreur, 'tuya'); assert.equal(c.appels.length, 0);
  } finally { console.error = orig; }
});
test('repli sans binding : avertissement une fois, 429 au-delà de 30 appels par heure', async () => {
  const c = cable(); const avert = []; const orig = console.warn; console.warn = (...a) => avert.push(a.join(' '));
  try {
    let dernier;
    for (let i = 0; i < 31; i++) dernier = await appel(req('/api/etat'), c);
    assert.equal(dernier.statut, 429);
    assert.equal(avert.length, 1); assert.match(avert[0], /limiteur_absent/);
    const plusTard = new Date(NUIT.getTime() + 3_600_001);
    assert.equal((await appel(req('/api/etat'), c, ENV, { now: () => plusTard })).statut, 200);
  } finally { console.warn = orig; }
});

// --- Fuites ---
test('aucune fuite de secret dans les réponses ni dans les journaux', async () => {
  const sortie = []; const o = { l: console.log, e: console.error, w: console.warn };
  console.log = console.error = console.warn = (...a) => sortie.push(a.map(String).join(' '));
  const secrets = [ENV.TUYA_ACCESS_ID, ENV.TUYA_ACCESS_SECRET, ENV.TUYA_DEVICE_ID, JETON, ACCESS_TOKEN_TUYA, 'secret-interne'];
  const textes = [];
  try {
    const scenarios = [
      [req('/api/etat'), cable()],
      [req('/api/etat', { jeton: 'mauvais' }), cable()],
      [req('/api/nimporte'), cable()],
      [post({ allumage: '22:30' }), cable()],
      [post({ allumage: '22:30' }), cable({ ignorerEcriture: true })],
      [post({ desactiver: true }), cable()],
      [post('{oups'), cable()],
      [req('/api/etat'), cable({ erreurLecture: { success: false, code: 999999, msg: 'secret-interne ' + ENV.TUYA_ACCESS_SECRET } })],
      [req('/api/etat'), cable({ erreurJeton: { success: false, code: 1004, msg: 'sign invalid ' + ENV.TUYA_ACCESS_ID } })],
      [req('/api/etat'), cable({ pendre: true }), { delaiMs: 20 }],
    ];
    for (const [r, c, extra] of scenarios) {
      reinitialiserCache();
      const rep = await traiter(r, ENV, deps(c, extra));
      textes.push(await rep.text(), [...rep.headers].map(([k, v]) => `${k}: ${v}`).join('\n'));
    }
  } finally { Object.assign(console, { log: o.l, error: o.e, warn: o.w }); }
  const tout = textes.join('\n') + '\n' + sortie.join('\n');
  for (const s of secrets) assert.ok(!tout.includes(s), `fuite : ${s.slice(0, 4)}…`);
});
