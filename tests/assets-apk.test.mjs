// Tests de tools/assets-apk.mjs (lot C3.1) : la liste blanche des fichiers embarqués dans l'APK.
// Rien d'autre que site/** (sauf sw.js), android/essai/** (plus aucun fichier de local/ depuis le lot E2) ; fichiers identiques
// à la source (empreintes) ; sortie déterministe ; refus d'un fichier inattendu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listerFichiers, copierAssets, seulementDebug, EXTENSIONS } from '../tools/assets-apk.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
function tous(dossier, base = dossier) {
  const out = [];
  for (const n of readdirSync(dossier).sort()) {
    const p = join(dossier, n);
    if (statSync(p).isDirectory()) out.push(...tous(p, base));
    else out.push(p.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}
const temp = () => mkdtempSync(join(tmpdir(), 'assets-apk-'));
// Chemin d'un fichier copié : main/<f>, ou debug/<f> pour la page d'essai (version de mise au point seulement).
const copie = (sortie, f) => join(sortie, seulementDebug(f) ? 'debug' : 'main', ...f.split('/'));
const aplatir = (sortie) => tous(sortie).map((f) => f.replace(/^(main|debug)\//, '')).sort();

test('APK publié (release) : la page d\'essai n\'est pas du tout dans la liste, le reste est identique', () => {
  const debug = listerFichiers(RACINE);
  const release = listerFichiers(RACINE, { variante: 'release' });
  assert.ok(!release.some((f) => f.startsWith('android/')), 'page d\'essai dans l\'APK publié');
  assert.deepEqual(release, debug.filter((f) => !f.startsWith('android/essai/')));
  assert.deepEqual(listerFichiers(RACINE, { variante: 'debug' }), debug);
  assert.throws(() => listerFichiers(RACINE, { variante: 'autre' }), /Variante inconnue/);
});

test('copie : la page d\'essai va dans debug/ (jeu de sources de mise au point), tout le reste dans main/', () => {
  const t = temp();
  try {
    const sortie = join(t, 'apk-assets');
    copierAssets({ racine: RACINE, sortie });
    assert.ok(tous(join(sortie, 'debug')).every((f) => f.startsWith('android/essai/')));
    assert.ok(existsSync(join(sortie, 'debug', 'android', 'essai', 'index.html')));
    assert.ok(!tous(join(sortie, 'main')).some((f) => f.startsWith('android/')));
    assert.ok(existsSync(join(sortie, 'main', 'site', 'index.html')));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('la liste est exactement la liste blanche, calculée indépendamment', () => {
  const attendu = [
    ...tous(join(RACINE, 'site')).filter((f) => f !== 'sw.js').map((f) => `site/${f}`),
    ...tous(join(RACINE, 'android', 'essai')).map((f) => `android/essai/${f}`),
  ].sort();
  assert.deepEqual(listerFichiers(RACINE), attendu);
  assert.ok(attendu.length > 10);
});

test('rien d\'autre : ni sw.js, ni transport Node, ni outils, tests, worker, .claude, secrets', () => {
  const liste = listerFichiers(RACINE);
  assert.ok(!liste.includes('site/sw.js'));
  assert.ok(!liste.some((f) => f.startsWith('local/')), "le protocole local n'est plus embarqué : il est en Kotlin");
  for (const f of liste) {
    assert.match(f, /^(site\/|android\/essai\/)/, f);
    assert.ok(!/^(tools|tests|worker|\.claude|\.github|docs|public|dist|android\/(ci|src))\//.test(f), f);
    assert.ok(!/(^|\/)\.[^/]+/.test(f), `fichier caché : ${f}`);
    assert.ok(!/dev\.vars|\.pem$|\.jks$|\.keystore$|\.p12$/i.test(f), f);
    assert.ok(EXTENSIONS.some((e) => f.endsWith(e)), `extension inattendue : ${f}`);
  }
  assert.ok(liste.includes('site/index.html'));
  assert.ok(liste.includes('site/calc.js'));
  assert.ok(liste.includes('android/essai/index.html'));
});

test('copie : mêmes fichiers, empreintes identiques à la source', () => {
  const t = temp();
  try {
    const sortie = join(t, 'apk-assets');
    const liste = copierAssets({ racine: RACINE, sortie });
    assert.deepEqual(aplatir(sortie), liste);
    for (const f of liste) assert.equal(sha(copie(sortie, f)), sha(join(RACINE, ...f.split('/'))), f);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('déterministe : deux copies donnent les mêmes fichiers et les mêmes empreintes, dans le même ordre', () => {
  const t = temp();
  try {
    const sortie = join(t, 'apk-assets');
    const a = copierAssets({ racine: RACINE, sortie });
    const ha = a.map((f) => `${f} ${sha(copie(sortie, f))}`);
    mkdirSync(join(sortie, 'reste-d-un-essai'), { recursive: true }); // vidé à la copie suivante
    const b = copierAssets({ racine: RACINE, sortie });
    const hb = b.map((f) => `${f} ${sha(copie(sortie, f))}`);
    assert.deepEqual(a, [...a].sort());
    assert.deepEqual(ha, hb);
    assert.ok(!existsSync(join(sortie, 'reste-d-un-essai')));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

function fauxDepot(extra = {}) {
  const t = temp();
  const w = (rel, txt = 'x') => { const p = join(t, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, txt); };
  w('site/index.html'); w('site/sw.js'); w('local/tuya-local.js'); w('local/recherche.js'); w('local/transport-node.mjs');
  w('android/essai/index.html'); w('tools/outil.mjs'); w('tests/t.mjs'); w('worker/w.js');
  for (const [k, v] of Object.entries(extra)) w(k, v);
  return t;
}

test('faux dépôt : seuls les fichiers de la liste blanche sont retenus', () => {
  const t = fauxDepot();
  try {
    assert.deepEqual(listerFichiers(t), ['android/essai/index.html', 'site/index.html']);
    assert.deepEqual(listerFichiers(t, { variante: 'release' }), ['site/index.html']);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('un fichier inattendu dans site/ ou android/essai/ fait échouer la copie (rien n\'est embarqué par accident)', () => {
  for (const intrus of ['site/cles.pem', 'site/sauvegarde.bak', 'android/essai/notes.md', 'site/.cache', 'site/sans-extension']) {
    const t = fauxDepot({ [intrus]: 'secret' });
    try {
      assert.throws(() => copierAssets({ racine: t, sortie: join(t, 'dist', 'apk-assets') }), /inattendu|extension/, intrus);
      assert.ok(!existsSync(join(t, 'dist', 'apk-assets')), 'rien n\'est écrit quand la liste est refusée');
    } finally { rmSync(t, { recursive: true, force: true }); }
  }
});

test('un dossier de la liste absent fait échouer', () => {
  const t = fauxDepot();
  rmSync(join(t, 'android', 'essai'), { recursive: true });
  try { assert.throws(() => listerFichiers(t), /absent/); } finally { rmSync(t, { recursive: true, force: true }); }
});

test('dossier de sortie : doit s\'appeler apk-assets et ne pas contenir le dépôt', () => {
  const t = fauxDepot();
  try {
    assert.throws(() => copierAssets({ racine: t, sortie: join(t, 'dist') }), /apk-assets/);
    assert.throws(() => copierAssets({ racine: t, sortie: t }), /apk-assets/);
    assert.ok(existsSync(join(t, 'site', 'index.html')), 'le dépôt n\'a pas été touché');
    const dedans = join(t, 'apk-assets');
    mkdirSync(dedans);
    assert.throws(() => copierAssets({ racine: dedans, sortie: dedans }), /contenir|apk-assets/);
  } finally { rmSync(t, { recursive: true, force: true }); }
});
