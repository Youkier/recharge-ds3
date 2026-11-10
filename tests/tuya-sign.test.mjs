import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signer, parseEnv, comparerReleves, sha256hex, urlAvecParametres, chaineASigner, HEURE_VALIDE } from '../tools/tuya-probe.mjs';

// Vecteurs publiés : https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g
const base = {
  clientId: '1KAD46OrT9HafiKdsXeg',
  secret: '4OHBOnWOqaEC1mWXOpVL3yV50s0qGSRC',
  t: '1588925778000',
  nonce: '5138cc3a9033d69856923fd07b491173',
  entetesSignes: 'area_id:29a33e8796834b1efa6\ncall_id:8afdb70ab2ed11eb85290242ac130003\n',
};

test('signature : vecteur officiel, requête de jeton', () => {
  const s = signer({ ...base, methode: 'GET', chemin: '/v1.0/token', query: { grant_type: 1 } });
  assert.equal(s, '9E48A3E93B302EEECC803C7241985D0A34EB944F40FB573C7B5C2A82158AF13E');
});

test('signature : vecteur officiel, requête métier', () => {
  const s = signer({ ...base, accessToken: '3f4eda2bdec17232f67c0b188af3eec1', methode: 'GET',
    chemin: '/v2.0/apps/schema/users', query: { page_size: 50, page_no: 1 } });
  assert.equal(s, 'AE4481C692AA80B25F3A7E12C3A5FD9BBF6251539DD78E565A1A72A508A88784');
});

test('hash du corps vide et tri des paramètres', () => {
  assert.equal(sha256hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(urlAvecParametres('/x', { b: 2, a: 1 }), '/x?a=1&b=2');
  assert.equal(chaineASigner('get', '', '/x'), 'GET\n' + sha256hex('') + '\n\n/x');
});

test('parseur .env', () => {
  const e = parseEnv('# commentaire\nA=1\n\nexport B = "deux"\nC=a=b\r\nD=\'x\'\nvide\n');
  assert.deepEqual(e, { A: '1', B: 'deux', C: 'a=b', D: 'x' });
});

test('compare : ajouts, retraits, modifications', () => {
  const a = { status: [{ code: 'switch', value: true }, { code: 'cur', value: 16 }, { code: 'old', value: 1 }] };
  const b = { status: [{ code: 'switch', value: true }, { code: 'cur', value: 10 }, { code: 'new', value: 'x' }] };
  assert.deepEqual(comparerReleves(a, b), [
    { code: 'cur', type: 'modifié', avant: 16, apres: 10 },
    { code: 'new', type: 'ajouté', apres: 'x' },
    { code: 'old', type: 'disparu', avant: 1 },
  ]);
  assert.deepEqual(comparerReleves(a, a), []);
});

test('heure HH:MM stricte', () => {
  assert.ok(HEURE_VALIDE.test('00:00') && HEURE_VALIDE.test('23:59'));
  for (const x of ['24:00', '7:30', '12:60', '12:30 ', '']) assert.ok(!HEURE_VALIDE.test(x));
});
