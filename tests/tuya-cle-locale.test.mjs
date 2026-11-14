import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poserCle } from '../tools/tuya-probe.mjs';

test('poserCle ajoute la ligne en fin de fichier', () => {
  assert.equal(poserCle('A=1\nB=2\n', 'abc'), 'A=1\nB=2\nTUYA_LOCAL_KEY=abc\n');
  assert.equal(poserCle('A=1', 'abc'), 'A=1\nTUYA_LOCAL_KEY=abc\n');
});

test('poserCle remplace une clé existante sans toucher au reste', () => {
  assert.equal(poserCle('A=1\nTUYA_LOCAL_KEY=vieille\nB=2\n', 'neuve'), 'A=1\nTUYA_LOCAL_KEY=neuve\nB=2\n');
  assert.equal(poserCle('TUYA_LOCAL_KEY=\nB=2\n', 'neuve'), 'TUYA_LOCAL_KEY=neuve\nB=2\n');
});

test('poserCle conserve le séparateur CRLF', () => {
  assert.equal(poserCle('A=1\r\nTUYA_LOCAL_KEY=vieille\r\nB=2\r\n', 'neuve'), 'A=1\r\nTUYA_LOCAL_KEY=neuve\r\nB=2\r\n');
  assert.equal(poserCle('A=1\r\nB=2\r\n', 'neuve'), 'A=1\r\nB=2\r\nTUYA_LOCAL_KEY=neuve\r\n');
});

test('poserCle supprime les doublons : une seule ligne au final', () => {
  const r = poserCle('TUYA_LOCAL_KEY=a\nB=2\nexport TUYA_LOCAL_KEY=b\nTUYA_LOCAL_KEY=c\n', 'neuve');
  assert.equal(r, 'TUYA_LOCAL_KEY=neuve\nB=2\n');
  assert.equal(r.match(/TUYA_LOCAL_KEY/g).length, 1);
});

test('poserCle gère le préfixe export', () => {
  assert.equal(poserCle('export TUYA_LOCAL_KEY=vieille\nB=2\n', 'neuve'), 'TUYA_LOCAL_KEY=neuve\nB=2\n');
});

test('poserCle refuse les clés avec saut de ligne, retour chariot, espace ou caractère non imprimable', () => {
  for (const mauvaise of ['ab\ncd', 'ab\rcd', 'ab cd', 'ab\tcd', 'abc\n', '', 'clé', 'a\x00b', null, 42]) {
    assert.throws(() => poserCle('A=1\n', mauvaise), /refusée/);
  }
});

test("poserCle n'affiche pas la valeur refusée dans l'erreur", () => {
  assert.throws(() => poserCle('A=1\n', 'secretX\nINJECT=1'), (e) => !e.message.includes('secretX'));
});

test('poserCle accepte une clé valide et l’ajoute en fin de fichier', () => {
  assert.equal(poserCle('A=1\n\n\n', 'Ab1!~'), 'A=1\nTUYA_LOCAL_KEY=Ab1!~\n');
});
