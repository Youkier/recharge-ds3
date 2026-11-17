// Tests de tools/capture.mjs : validation des arguments, sans lancer de navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { preparer, argumentsNavigateur, DOSSIER } from '../tools/capture.mjs';

test('valeurs par défaut : 500 × 800, thème clair, adresse locale ; « / » du début facultatif', () => {
  for (const chemin of ['/', 'index.html', '/index.html']) {
    const c = preparer(['8081', chemin]);
    assert.match(c.url, /^http:\/\/127\.0\.0\.1:8081\/(index\.html)?$/);
    assert.deepEqual([c.largeur, c.hauteur, c.theme], [500, 800, 'clair']);
    assert.equal(c.fichier, join(DOSSIER, 'public-accueil-500x800-clair.png'));
  }
});

test('options et nom de fichier', () => {
  const c = preparer(['8080', '404.html', '--largeur=1280', '--hauteur=2000', '--theme=sombre']);
  assert.equal(c.url, 'http://127.0.0.1:8080/404.html');
  assert.equal(c.fichier, join(DOSSIER, 'perso-404-html-1280x2000-sombre.png'));
});

test('ports, chemins et options refusés', () => {
  for (const args of [
    [], ['80', '/'], ['8082', '/'], ['8081'], ['8081', '//exemple.com/x'], ['8081', '/@exemple.com'],
    ['8081', '@exemple.com'], ['8081', '/a b'], ['8081', '/a\b'], ['8081', 'http://exemple.com/'],
    ['8081', 'C:/Program Files/Git/'], ['8081', '/' + 'a'.repeat(201)],
    ['8081', '/', '--largeur=380'], ['8081', '/', '--largeur=1e3'], ['8081', '/', '--hauteur=99999'],
    ['8081', '/', '--theme=rose'], ['8081', '/', '--remote-debugging-port=9222'], ['8081', '/', 'x'],
  ]) assert.throws(() => preparer(args), Error, JSON.stringify(args));
});

test("navigateur : profil jetable, une seule adresse, locale et en dernier", () => {
  const c = preparer(['8081', '/', '--theme=sombre']);
  const a = argumentsNavigateur(c, 'PROFIL');
  assert.equal(a.at(-1), 'http://127.0.0.1:8081/');
  assert.equal(a.filter((x) => /^https?:/.test(x)).length, 1);
  assert.ok(a.includes('--user-data-dir=PROFIL'));
  assert.ok(a.includes('--force-dark-mode'));
  assert.ok(!argumentsNavigateur(preparer(['8081', '/']), 'P').includes('--force-dark-mode'));
  assert.ok(!a.some((x) => /remote-debugging|load-extension|proxy/.test(x)));
  assert.ok(c.fichier.startsWith(DOSSIER + sep));
});

test('chemins hostiles refusés : antislash réel, Unicode, retour à la ligne, octet nul, // et caractères de contrôle', () => {
  for (const chemin of [String.raw`/a\b`, String.raw`\\exemple.com\x`, '/é', '/\uFF0F\uFF0Fexemple.com', '/a\u202eb', '/a\nb', '/a\0b', '/a\r\nHost: x', '/a#x', '/a;b', '/a:80']) {
    assert.throws(() => preparer(['8081', chemin]), Error, JSON.stringify(chemin));
  }
  assert.throws(() => preparer(['8081', '/', '--theme=sombre\n']), Error);
  assert.throws(() => preparer(['8081', undefined]), Error);
  assert.throws(() => preparer(['8081', 42]), Error);
});

test('chemins avec « .. » ou « %2f » : l\'adresse reste 127.0.0.1 sur le port validé, le fichier reste dans dist/captures', () => {
  for (const chemin of ['/../../x', '/%2e%2e/%2f/x', '/a?b=c&d=%40exemple.com', '/..']) {
    const c = preparer(['8080', chemin]);
    const u = new URL(c.url);
    assert.equal(u.hostname, '127.0.0.1');
    assert.equal(u.port, '8080');
    assert.equal(u.protocol, 'http:');
    assert.ok(c.fichier.startsWith(DOSSIER + sep));
    assert.ok(!c.fichier.slice(DOSSIER.length + 1).includes(sep));
  }
});

test('un chemin commençant par un tiret devient un simple chemin du serveur local, jamais une option du navigateur', () => {
  const c = preparer(['8081', '--remote-debugging-port=9222']);
  assert.equal(c.url, 'http://127.0.0.1:8081/--remote-debugging-port=9222');
  assert.equal(argumentsNavigateur(c, 'P').at(-1), c.url);
});
