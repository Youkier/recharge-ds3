import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  traiter, signer, deciderPlage, moinsUneMinute, heureParis, jetonValide, validerCorps, nouvellePlage,
  reinitialiserCache, reinitialiserLimiteur,
} from '../worker/src/service.js';
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
  method: methode, body: corps, headers: { ...(typeof corps === 'string' ? { 'Content-Length': String(new TextEncoder().encode(corps).length) } : {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(origine ? { Origin: origine } : {}), ...entetes },
});
const appel = async (r, c, env = ENV, extra = {}) => {
  const rep = await traiter(r, env, deps(c, extra));
  return { statut: rep.status, corps: await rep.text().then((t) => (t ? JSON.parse(t) : null)), entetes: rep.headers };
};
// Demande complète : début, fin des heures creuses, durée de charge, départ (contrat du 2026-11-22).
const dem = (allumage, o = {}) => ({ allumage, fin: '06:00', duree_min: 420, depart: '07:30', ...o });
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
    [post(dem('22:30'), { jeton: null }), ENV],
    [post(dem('22:30'), { jeton: 'mauvais' }), ENV],
    [req('/api/inconnu', { jeton: null }), ENV],
    [req('/api/etat', { jeton: '' }), { ...ENV, JETON_ACCES: '' }],
    [req('/api/etat'), { ...ENV, JETON_ACCES: undefined }],
    [req('/api/etat', { jeton: 'court-mais-identique' }), { ...ENV, JETON_ACCES: 'court-mais-identique' }], // moins de 32 caractères
    [req('/api/etat', { jeton: 'x'.repeat(31) }), { ...ENV, JETON_ACCES: 'x'.repeat(31) }],
  ]) {
    const c = cable();
    const a = await appel(r, c, env);
    assert.equal(a.statut, 401);
    assert.deepEqual(a.corps, { ok: false, erreur: 'non_autorise' });
    assert.equal(c.appels.length, 0);
  }
});

test('jeton de 32 caractères : accepté ; trop court : configuration_incomplete journalisé', async () => {
  const j32 = 'x'.repeat(32); const journal = []; const o = console.error; console.error = (...a) => journal.push(a.join(' '));
  try {
    assert.equal((await appel(req('/api/etat', { jeton: j32 }), cable(), { ...ENV, JETON_ACCES: j32 })).statut, 200);
    assert.equal(journal.length, 0);
    const a = await appel(req('/api/etat', { jeton: 'court' }), cable(), { ...ENV, JETON_ACCES: 'court' });
    assert.equal(a.statut, 401); assert.deepEqual(journal, ['configuration_incomplete']);
  } finally { console.error = o; }
  assert.equal(await jetonValide('Bearer court', 'court'), false);
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
  assert.deepEqual(validerCorps(JSON.stringify(dem('00:00'))), dem('00:00'));
  assert.deepEqual(validerCorps(JSON.stringify(dem('23:59', { fin: '06:00' }))), dem('23:59'));
  assert.deepEqual(validerCorps('{"desactiver":true}'), { desactiver: true });
  // L'ancien contrat (allumage seul) et tout champ manquant, en trop ou mal typé sont refusés.
  for (const o of ['{"allumage":"00:00"}', '{"allumage":"22:30","fin":"06:00"}', '{"allumage":"22:30","fin":"06:00","duree_min":420}',
    JSON.stringify({ ...dem('22:30'), courant: 6 }), JSON.stringify({ ...dem('22:30'), desactiver: true }),
    JSON.stringify(dem('22:30', { duree_min: '420' })), JSON.stringify(dem('22:30', { duree_min: 420.5 })), JSON.stringify(dem('22:30', { duree_min: 0 })),
    JSON.stringify(dem('22:30', { duree_min: 901 })), JSON.stringify(dem('22:30', { duree_min: null })), JSON.stringify(dem('22:30', { fin: '08:00' })),
    JSON.stringify(dem('22:30', { fin: '22:30' })), JSON.stringify(dem('22:30', { depart: '22:30' })), JSON.stringify(dem('22:30', { depart: '7:30' })),
    JSON.stringify(dem('22:30', { fin: 600 })), JSON.stringify(dem('22:30', { depart: '07:30 ' }))]) assert.equal(validerCorps(o), null, o);
});
test('corps invalide sémantiquement : 400, aucun appel Tuya', async () => {
  for (const corps of [dem('22:30', { fin: '08:00' }), dem('22:30', { duree_min: 901 }), dem('22:30', { depart: '05:00' }), { allumage: '22:30' }]) {
    const c = cable();
    const a = await appel(post(corps), c);
    assert.equal(a.statut, 400); assert.deepEqual(a.corps, { ok: false, erreur: 'requete_invalide' });
    assert.equal(c.appels.length, 0);
  }
});
test('l\'identifiant de l\'appareil ne vient que de l\'environnement', async () => {
  const c = cable();
  await appel(req('/api/etat?device_id=autre&id=autre'), c);
  await appel(post(dem('22:30'), { entetes: { 'X-Device-Id': 'autre' } }), c);
  assert.ok(c.appels.length > 0);
  for (const a of c.appels) assert.ok(!a.url.includes('autre') && (a.chemin === '/v1.0/token' || a.chemin.includes(ENV.TUYA_DEVICE_ID)));
});

test('corps : Content-Length absent, non numérique ou > 512 -> 400 avant lecture du corps', async () => {
  const c = cable(); const corps = JSON.stringify(dem('22:30'));
  for (const cl of [undefined, 'abc', '-1', '1e2', '513', '99999999999']) {
    const r = post(corps); r.headers.delete('Content-Length');
    if (cl !== undefined) r.headers.set('Content-Length', cl);
    let lu = false; const orig = r.text.bind(r); r.text = () => { lu = true; return orig(); };
    const a = await appel(r, c);
    assert.equal(a.statut, 400, String(cl)); assert.deepEqual(a.corps, { ok: false, erreur: 'requete_invalide' });
    assert.equal(lu, false, 'corps lu malgré un Content-Length refusé : ' + cl);
  }
  assert.equal(c.appels.length, 0);
  // Content-Length valide mais corps réel trop grand : refusé par la vérification après lecture.
  const gros = post('{"allumage":"' + '1'.repeat(600) + '"}', { entetes: { 'Content-Length': '40' } });
  assert.equal((await appel(gros, c)).statut, 400);
  assert.equal((await appel(post(corps), c)).statut, 200);
});

// --- Lecture ---
test('GET /api/etat : lecture seule, sans charge_active', async () => {
  const c = cable();
  const a = await appel(req('/api/etat'), c);
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps, { ok: true, debut: '04:00', fin: '06:00', plage_active: true });
  assert.ok(c.appels.every((x) => x.methode === 'GET'));
  assert.equal(c.ecritures.length, 0);
  const d = await appel(req('/api/etat'), cable({ valeur: { m: 0, dt: 0, ss: '04:00', se: '06:00' } }));
  assert.equal(d.corps.plage_active, false);
});
test('GET /api/etat : valeur de plage inattendue -> tuya, sans fuite', async () => {
  for (const valeur of [{ m: 5, dt: 0, ss: '04:00', se: '06:00' }, { m: 2, ss: '04:00', se: '06:00' }, { m: 2, dt: 0, ss: 'x', se: '06:00' },
    { m: 2, dt: 0, ss: ['04:00'], se: '06:00' }, { m: 2, dt: 0, ss: '04:00', se: ['06:00'] }, { m: 2, dt: {}, ss: '04:00', se: '06:00' },
    { m: 2, dt: '0', ss: '04:00', se: '06:00' }, { m: 2, dt: 1.5, ss: '04:00', se: '06:00' }, { m: 1, dt: 0, ss: '04:00', se: '06:00' }, { m: 2, dt: null, ss: '04:00', se: '06:00' }]) {
    const a = await appel(req('/api/etat'), cable({ valeur }));
    assert.equal(a.statut, 502); assert.deepEqual(a.corps, { ok: false, erreur: 'tuya' });
  }
});

// --- Écriture ---
test('écriture : ne change que m, ss et se, corps au format validé, signé avec le jeton Tuya', async () => {
  const c = cable({ valeur: { m: 0, dt: 7, ss: '04:00', se: '06:00' } });
  const a = await appel(post(dem('22:30')), c);
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps, { ok: true, debut: '22:30', fin: '06:00', plage_active: true, tardif: false });
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
  assert.deepEqual(nouvellePlage({ m: 0, dt: 1, ss: '01:00', se: '02:00' }, '03:00', '05:30'), { m: 2, dt: 1, ss: '03:00', se: '05:30' });
});
test('écriture : la fin demandée est écrite (la fin du câble est remplacée, dt recopié)', async () => {
  const c = cable({ valeur: { m: 2, dt: 3, ss: '04:00', se: '07:30' } }); // fin repoussée un soir précédent
  const a = await appel(post(dem('22:30', { fin: '06:00' })), c);
  assert.equal(a.statut, 200);
  assert.deepEqual(JSON.parse(c.ecritures[0].x_charge_mode), { m: 2, dt: 3, ss: '22:30', se: '06:00' });
  assert.equal(a.corps.fin, '06:00');
  const c2 = cable();
  await appel(post(dem('22:00', { fin: '03:30', duree_min: 330 })), c2);
  assert.deepEqual(JSON.parse(c2.ecritures[0].x_charge_mode), { m: 2, dt: 0, ss: '22:00', se: '03:30' });
});
test('démarrage tardif : début = maintenant + 10 min, fin bornée par le départ, tardif: true', async () => {
  const c = cable();
  const a = await appel(post(dem('23:00')), c, ENV, { now: () => new Date('2026-11-16T22:50:00Z') }); // 23:50 à Paris
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps, { ok: true, debut: '00:00', fin: '07:00', plage_active: true, tardif: true });
  assert.deepEqual(JSON.parse(c.ecritures[0].x_charge_mode), { m: 2, dt: 0, ss: '00:00', se: '07:00' });
  assert.deepEqual(Object.keys(c.ecritures[0]), ['x_charge_mode']);
  const c2 = cable();
  const b = await appel(post(dem('23:00')), c2, ENV, { now: () => new Date('2026-11-17T04:50:00Z') }); // 05:50
  assert.deepEqual(b.corps, { ok: true, debut: '06:00', fin: '07:30', plage_active: true, tardif: true });
  // À plus de 10 minutes du début : écriture normale.
  const c3 = cable();
  const n = await appel(post(dem('23:00')), c3, ENV, { now: () => new Date('2026-11-16T21:50:00Z') }); // 22:50 : pile +10
  assert.deepEqual(n.corps, { ok: true, debut: '23:00', fin: '06:00', plage_active: true, tardif: false });
});
test('trop tard : rien n\'est écrit, erreur trop_tard (409)', async () => {
  const c = cable();
  const a = await appel(post(dem('23:00')), c, ENV, { now: () => new Date('2026-11-17T06:20:00Z') }); // 07:20, départ 07:30
  assert.equal(a.statut, 409);
  assert.deepEqual(a.corps, { ok: false, erreur: 'trop_tard' });
  assert.equal(c.ecritures.length, 0);
  assert.ok(c.appels.every((x) => x.methode === 'GET' || x.chemin === '/v1.0/token'));
});
test('démarrage tardif : relecture différente -> relecture_differente', async () => {
  const c = cable({ ignorerEcriture: true });
  const a = await appel(post(dem('23:00')), c, ENV, { now: () => new Date('2026-11-16T22:50:00Z') });
  assert.deepEqual(a.corps, { ok: false, erreur: 'relecture_differente' });
});
test('deciderPlage : quelques cas directs (le fichier commun est dans plage-tardif-cas.test.mjs)', () => {
  assert.deepEqual(deciderPlage(dem('23:00'), new Date('2026-11-16T20:00:00Z')), { statut: 'normal', debut: '23:00', fin: '06:00' });
  assert.deepEqual(deciderPlage(dem('23:00'), new Date('2026-11-16T22:50:00Z')), { statut: 'tardif', debut: '00:00', fin: '07:00' });
  assert.deepEqual(deciderPlage(dem('23:00'), new Date('2026-11-17T06:20:00Z')), { statut: 'trop_tard' });
  assert.deepEqual(deciderPlage({ allumage: '23:00' }, new Date('2026-11-16T20:00:00Z')), { statut: 'invalide' });
});
test('écriture : jamais d\'autre point que x_charge_mode, jamais m = 0 ni x_do_charge', async () => {
  const c = cable();
  for (const h of ['00:00', '22:30', '23:59', '05:59']) await appel(post(dem(h)), c, ENV, { now: () => NUIT });
  for (const e of c.ecritures) { assert.deepEqual(Object.keys(e), ['x_charge_mode']); assert.equal(JSON.parse(e.x_charge_mode).m, 2); }
  assert.ok(c.appels.every((x) => !x.corps || !x.corps.includes('x_do_charge')));
});
test('déjà réglé : pas d\'écriture, succès après relecture', async () => {
  const c = cable({ valeur: { m: 2, dt: 0, ss: '22:30', se: '06:00' } });
  const a = await appel(post(dem('22:30')), c);
  assert.equal(a.statut, 200); assert.equal(c.ecritures.length, 0); assert.equal(a.corps.debut, '22:30');
});
test('relecture différente -> relecture_differente, jamais de faux succès', async () => {
  const c = cable({ ignorerEcriture: true });
  const a = await appel(post(dem('22:30')), c);
  assert.equal(a.statut, 502);
  assert.deepEqual(a.corps, { ok: false, erreur: 'relecture_differente' });
  // Le câble corrige dt/se de son côté : aussi refusé.
  const c2 = cable(); const f = c2.fetch;
  c2.fetch = async (u, i) => { const r = await f(u, i); if (i?.method === 'POST') c2.valeur = JSON.stringify({ m: 2, dt: 0, ss: '22:30', se: '07:00' }); return r; };
  assert.equal((await appel(post(dem('22:30')), c2)).corps.erreur, 'relecture_differente');
});
test('relecture : la valeur peut mettre un peu de temps à changer', async () => {
  const c = cable(); const f = c.fetch; let lectures = 0;
  c.fetch = async (u, i) => {
    const nouvelle = c.valeur;
    const r = await f(u, i);
    if (i?.method === 'GET' && new URL(u).pathname.endsWith('/properties')) { lectures++; if (lectures === 2) return new Response(JSON.stringify({ success: true, result: { properties: [{ code: 'x_charge_mode', value: JSON.stringify({ m: 2, dt: 0, ss: '04:00', se: '06:00' }) }] } })); }
    void nouvelle; return r;
  };
  const a = await appel(post(dem('22:30')), c, ENV, { attentes: [0, 0, 0] });
  assert.equal(a.statut, 200); assert.equal(a.corps.debut, '22:30');
});

// --- Désactiver ---
test('désactiver : plage courte, début = se - 1 min, la fin relue est réécrite telle quelle', async () => {
  for (const [se, debut] of [['06:00', '05:59'], ['07:00', '06:59'], ['00:00', '23:59'], ['00:01', '00:00']]) {
    const c = cable({ valeur: { m: 0, dt: 7, ss: '22:30', se } });
    const a = await appel(post({ desactiver: true }), c);
    assert.equal(a.statut, 200);
    assert.deepEqual(a.corps, { ok: true, debut, fin: se, plage_active: true, tardif: false, courte: true });
    assert.equal(c.ecritures.length, 1);
    assert.deepEqual(Object.keys(c.ecritures[0]), ['x_charge_mode']);
    assert.deepEqual(JSON.parse(c.ecritures[0].x_charge_mode), { m: 2, dt: 7, ss: debut, se });
    assert.ok(c.appels.every((x) => !x.corps || !x.corps.includes('x_do_charge')));
  }
  assert.equal(moinsUneMinute('10:00'), '09:59');
});
test('désactiver : jamais tardif, même si l’heure est dans la nuit', async () => {
  const c = cable({ valeur: { m: 2, dt: 0, ss: '22:30', se: '06:00' } });
  const a = await appel(post({ desactiver: true }), c, ENV, { now: () => new Date('2026-01-15T23:10:00Z') }); // 00:10 Paris, dans la plage
  assert.equal(a.statut, 200);
  assert.equal(a.corps.tardif, false);
  assert.ok(!('immediat' in a.corps));
  assert.equal(a.corps.debut, '05:59');
});
test('désactiver : relecture différente -> relecture_differente', async () => {
  const c = cable({ ignorerEcriture: true });
  const a = await appel(post({ desactiver: true }), c);
  assert.equal(a.statut, 502);
  assert.deepEqual(a.corps, { ok: false, erreur: 'relecture_differente' });
});
test('désactiver : déjà en plage courte -> pas d’écriture, succès', async () => {
  const c = cable({ valeur: { m: 2, dt: 0, ss: '05:59', se: '06:00' } });
  const a = await appel(post({ desactiver: true }), c);
  assert.equal(a.statut, 200); assert.equal(c.ecritures.length, 0); assert.equal(a.corps.courte, true);
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
  const a = await appel(post(dem('22:30')), c);
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
  const b = await appel(post(dem('22:30')), c, ENV, { delaiMs: 30 });
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
test('heure d\'été et d\'hiver : heureParis suit le changement d\'heure (dimanche 2026-03-29 et 2026-10-25)', () => {
  assert.equal(heureParis(new Date('2026-03-29T00:59:00Z')), '01:59');
  assert.equal(heureParis(new Date('2026-03-29T01:00:00Z')), '03:00');
  assert.equal(heureParis(new Date('2026-10-25T00:30:00Z')), '02:30'); // CEST
  assert.equal(heureParis(new Date('2026-10-25T01:30:00Z')), '02:30'); // CET : 02:30 existe deux fois
});
test('nuit de changement d\'heure : minutes murales, sans viser l\'exactitude (documenté)', () => {
  // 29 mars 2026, 01:50 CET : début = 02:00 (heure qui n'existe pas), fin bornée par le départ ; le câble l'interprète selon son horloge.
  assert.deepEqual(deciderPlage(dem('23:00'), new Date('2026-03-29T00:50:00Z')), { statut: 'tardif', debut: '02:00', fin: '07:30' });
  // 25 octobre 2026, 02:30 existe deux fois : même résultat pour les deux.
  assert.deepEqual(deciderPlage(dem('23:00'), new Date('2026-10-25T00:30:00Z')), { statut: 'tardif', debut: '02:40', fin: '07:30' });
  assert.deepEqual(deciderPlage(dem('23:00'), new Date('2026-10-25T01:30:00Z')), { statut: 'tardif', debut: '02:40', fin: '07:30' });
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

test('Vary: Origin sur toutes les réponses, avec ou sans Origin correspondante', async () => {
  const c = cable();
  for (const origine of [undefined, 'https://autre.example', ENV.ORIGINE_AUTORISEE]) {
    for (const r of [req('/api/etat', { origine }), req('/api/etat', { origine, jeton: null }), req('/api/inconnu', { origine }), post('{}', { origine })]) {
      assert.equal((await appel(r, c)).entetes.get('Vary'), 'Origin');
    }
  }
  const pre = await traiter(req('/api/etat', { methode: 'OPTIONS', jeton: null, origine: 'https://autre.example' }), ENV, deps(c));
  assert.equal(pre.status, 403); assert.equal(pre.headers.get('Vary'), 'Origin');
  const ok = await traiter(req('/api/etat', { methode: 'OPTIONS', jeton: null, origine: ENV.ORIGINE_AUTORISEE }), ENV, deps(c));
  assert.equal(ok.headers.get('Vary'), 'Origin');
});

// --- Limite d'appels ---
test('EXIGER_LIMITEUR=1 : sans binding (ou sans méthode limit) -> 503 tuya, journal fixe, aucun appel Tuya', async () => {
  const c = cable(); const journal = []; const o = console.error; console.error = (...a) => journal.push(a.join(' '));
  try {
    for (const lim of [undefined, null, {}, { limit: 'pas une fonction' }]) {
      const a = await appel(req('/api/etat'), c, { ...ENV, EXIGER_LIMITEUR: '1', LIMITEUR: lim });
      assert.equal(a.statut, 503); assert.deepEqual(a.corps, { ok: false, erreur: 'tuya' });
    }
    assert.equal(c.appels.length, 0);
    assert.deepEqual([...new Set(journal)], ['limiteur_absent_exige']);
    // avec le binding : normal ; sans jeton : toujours 401 d'abord
    const env = { ...ENV, EXIGER_LIMITEUR: '1', LIMITEUR: { limit: async () => ({ success: true }) } };
    assert.equal((await appel(req('/api/etat'), c, env)).statut, 200);
    assert.equal((await appel(req('/api/etat', { jeton: 'mauvais' }), c, { ...ENV, EXIGER_LIMITEUR: '1' })).statut, 401);
  } finally { console.error = o; }
  // EXIGER_LIMITEUR autre que "1" : repli en mémoire conservé
  const w = console.warn; console.warn = () => {};
  try { assert.equal((await appel(req('/api/etat'), c, { ...ENV, EXIGER_LIMITEUR: '0' })).statut, 200); } finally { console.warn = w; }
});
test('wrangler.toml : limiteur exigé, journaux désactivés, adresses explicites', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8').replace(/\r/g, '').replace(/^\s*#.*$/gm, '');
  assert.match(t, /^EXIGER_LIMITEUR = "1"$/m);
  assert.match(t, /^\[observability\]\s*\nenabled = false$/m);
  assert.match(t, /^workers_dev = true$/m);
  assert.match(t, /^preview_urls = false$/m);
  assert.match(t, /^\[\[ratelimits\]\]$/m);
});
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
    const r = await appel(post(dem('01:00')), c, env);
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
      [post(dem('22:30')), cable()],
      [post(dem('22:30')), cable({ ignorerEcriture: true })],
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

// Cloudflare traite chaque export du module principal comme un point d'entrée :
// index.js ne doit exporter que le gestionnaire par défaut (sinon wrangler refuse de démarrer).
test('point d\'entrée : index.js n\'exporte que le gestionnaire par défaut', async () => {
  const mod = await import('../worker/src/index.js');
  assert.deepEqual(Object.keys(mod), ['default']);
  assert.equal(typeof mod.default.fetch, 'function');
});

// --- Ajouts de relecture (critères 2b) ---
test('bon jeton : toute autre méthode HTTP est refusée (405), aucun appel Tuya, aucune écriture', async () => {
  const c = cable();
  for (const chemin of ['/api/etat', '/api/programmer']) {
    for (const methode of ['DELETE', 'PATCH', 'PUT', 'HEAD']) {
      const a = await appel(req(chemin, { methode }), c);
      assert.equal(a.statut, 405, `${methode} ${chemin}`);
    }
  }
  assert.equal((await appel(req('/api/etat', { methode: 'POST', corps: '{"allumage":"22:30"}' }), c)).statut, 405);
  assert.equal((await appel(req('/api/programmer', { methode: 'GET' }), c)).statut, 405);
  // paramètres d'URL ignorés : la route /api/programmer?allumage=... en POST sans corps valide reste un 400
  assert.equal((await appel(req('/api/programmer?allumage=22:30', { methode: 'POST', corps: '' }), c)).statut, 400);
  assert.equal(c.appels.length, 0);
  assert.equal(c.ecritures.length, 0);
});

test('appareil : toutes les actions (état, programmer, désactiver) ne visent que TUYA_DEVICE_ID', async () => {
  const c = cable();
  await appel(req('/api/etat'), c);
  await appel(post(dem('23:00')), c);
  await appel(post({ desactiver: true }), c);
  const chemins = c.appels.map((a) => a.chemin);
  assert.ok(chemins.length >= 5);
  for (const p of chemins) {
    assert.ok(p === '/v1.0/token' || p === `/v2.0/cloud/thing/${ENV.TUYA_DEVICE_ID}/shadow/properties` || p === `/v2.0/cloud/thing/${ENV.TUYA_DEVICE_ID}/shadow/properties/issue`, p);
  }
  // un autre identifiant dans l'env change la cible, jamais autre chose
  const c2 = cable();
  const rep = await appel(req('/api/etat'), c2, { ...ENV, TUYA_DEVICE_ID: 'autre-appareil-123' });
  assert.equal(rep.corps.erreur, 'tuya'); // le câble simulé ne connaît pas cet identifiant : pas de succès
});

test('erreurs à l\'écriture (POST) : chaque cause reste distincte, jamais ok:true', async () => {
  const cas = [
    [{ erreurEcriture: { success: false, code: 2001, msg: 'device is offline' } }, 'hors_ligne'],
    [{ erreurEcriture: { success: false, code: 1106, msg: 'permission deny' } }, 'jeton'],
    [{ erreurEcriture: { success: false, code: 999999, msg: 'x' } }, 'tuya'],
    [{ ignorerEcriture: true }, 'relecture_differente'],
    [{ pendre: true, delai: true }, 'delai'],
  ];
  const vus = new Set();
  for (const [opt, code] of cas) {
    reinitialiserCache();
    const { delai, ...o } = opt;
    for (const corps of [dem('22:30'), { desactiver: true }]) {
      const c = cable(o);
      const a = await appel(post(corps), c, ENV, delai ? { delaiMs: 30 } : {});
      assert.equal(a.corps.ok, false, code);
      assert.equal(a.corps.erreur, code);
      assert.ok(a.statut >= 500, code);
      assert.ok(!('debut' in a.corps));
      reinitialiserCache();
    }
    vus.add(code);
  }
  assert.equal(vus.size, 5);
});

test('journaux du Worker : jamais d\'autre argument qu\'un libellé fixe ou un code numérique (contrôle du source)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../worker/src/service.js', import.meta.url), 'utf8');
  const appelsConsole = [...src.matchAll(/console\.(?:log|error|warn|info|debug)\(([^;]*)\);/g)].map((m) => m[1]);
  assert.ok(appelsConsole.length >= 7);
  for (const args of appelsConsole) {
    assert.ok(!/env\.|request|headers|Authorization|msg|json|secret|jeton|token|\.message|\.stack|\be\b(?!\.code)/i.test(args.replace(/'[^']*'/g, "''").replace(/\/\/.*$/, '')) || /^'[^']*'(, type, Number\.isFinite\(code\) \? code : 'inconnu')?/.test(args), args);
  }
  assert.ok(!/console\.\w+\([^)]*(env\.|request\.|\.msg|\.stack)/.test(src));
});

// --- Corrections après la relecture sécurité (2026-11-15) ---
test('limite horaire : 30 appels par heure même quand le binding accepte, sans appel Tuya au-delà', async () => {
  const c = cable(); let n = 0;
  const env = { ...ENV, EXIGER_LIMITEUR: '1', LIMITEUR: { limit: async () => { n++; return { success: true }; } } };
  for (let i = 0; i < 30; i++) assert.equal((await appel(req('/api/etat'), c, env)).statut, 200, `appel ${i + 1}`);
  const nb = c.appels.length;
  const r = await appel(req('/api/etat'), c, env);
  assert.equal(r.statut, 429); assert.equal(r.corps.erreur, 'trop_de_requetes'); assert.equal(c.appels.length, nb);
  assert.equal(n, 31);
  // une heure plus tard, de nouveau permis
  const plusTard = new Date(NUIT.getTime() + 3_600_001);
  assert.equal((await appel(req('/api/etat'), c, env, { now: () => plusTard })).statut, 200);
});
test('limite horaire : un refus du binding ne consomme pas le quota horaire', async () => {
  const c = cable(); let refuser = true;
  const env = { ...ENV, LIMITEUR: { limit: async () => ({ success: !refuser }) } };
  for (let i = 0; i < 40; i++) assert.equal((await appel(req('/api/etat'), c, env)).statut, 429);
  refuser = false;
  assert.equal((await appel(req('/api/etat'), c, env)).statut, 200);
});
test('échéance globale : appels Tuya lents -> « delai » avant 20 s, jamais de succès', async () => {
  // Horloge simulée : chaque appel Tuya « dure » 8 s ; chaque attente avance aussi l'horloge.
  for (const corps of [dem('01:00'), { desactiver: true }]) {
    reinitialiserCache();
    const c = cable(); let t = 0; const fetchLent = c.fetch;
    c.fetch = async (...a) => { t += 8000; return fetchLent(...a); };
    const r = await appel(post(corps), c, ENV, { horloge: () => t, sleep: async (ms) => { t += ms; }, attentes: [1500, 2000, 2500] });
    assert.equal(r.corps.ok, false, JSON.stringify(corps)); assert.equal(r.corps.erreur, 'delai'); assert.equal(r.statut, 504);
    assert.ok(t <= 24_000, `durée simulée ${t} ms`);
  }
});
test('échéance globale : le délai de chaque appel Tuya est réduit au temps restant', async () => {
  const c = cable({ pendre: true }); let t = 0; const delais = [];
  const st = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => { delais.push(ms); return st(f, 5, ...a); };
  try {
    const r = await appel(req('/api/etat'), c, ENV, { horloge: () => t, echeanceMs: 4000 });
    assert.equal(r.corps.erreur, 'delai');
  } finally { globalThis.setTimeout = st; }
  assert.ok(delais.length >= 1 && delais[0] === 4000, `délais : ${delais}`);
});
test('échéance globale : requête rapide inchangée (succès normal)', async () => {
  const c = cable(); let t = 0;
  const r = await appel(post(dem('01:00')), c, ENV, { horloge: () => t, sleep: async (ms) => { t += ms; }, attentes: [1500, 2000, 2500] });
  assert.equal(r.corps.ok, true); assert.equal(r.corps.debut, '01:00');
});
