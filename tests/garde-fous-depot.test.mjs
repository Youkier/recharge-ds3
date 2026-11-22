// Garde-fou du dépôt : `node --test "tests/**/*.test.mjs"` se lance sans demande d'autorisation,
// alors que les agents écrivent librement dans tests/ et local/. Ces fichiers ne doivent donc ni lire
// un fichier de secrets, ni ouvrir une connexion réseau, ni lancer un processus, sauf les exceptions
// listées ci-dessous. C'est un fil d'alarme contre l'erreur, pas une barrière contre un code
// délibérément déguisé : la relecture par testeur-relecteur reste nécessaire (SECURITE.md, règle n°11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CE_FICHIER = relative(RACINE, fileURLToPath(import.meta.url)).split(sep).join('/');

function fichiers(dossier) {
  const out = [];
  for (const nom of readdirSync(join(RACINE, dossier))) {
    const rel = `${dossier}/${nom}`;
    if (statSync(join(RACINE, rel)).isDirectory()) out.push(...fichiers(rel));
    else if (/\.(m?js|cjs|py)$/.test(nom)) out.push(rel);
  }
  return out;
}

const REGLES = [
  { nom: 'fichier de secrets', motif: /tools[\\/]+\.env|\.dev\.vars|['"`]\.env\b/, permis: [] },
  { nom: 'connexion réseau', motif: /node:(net|dgram|http|https|http2|tls)\b|require\(\s*['"](net|dgram|http|https|http2|tls)['"]/, permis: ['local/transport-node.mjs', 'tests/faux-cable-tcp.test.mjs'] }, // 2e : sockets sur 127.0.0.1 vers le faux câble (lot C3.1)
  { nom: 'lancement de processus', motif: /child_process|node:worker_threads|subprocess|os\.system/, permis: ['tests/public-build.test.mjs'] },
];

test('tests/ et local/ : ni secrets, ni réseau, ni processus hors exceptions', () => {
  const fautes = [];
  for (const f of [...fichiers('tests'), ...fichiers('local')]) {
    if (f === CE_FICHIER) continue;
    const src = readFileSync(join(RACINE, f), 'utf8');
    for (const r of REGLES) if (r.motif.test(src) && !r.permis.includes(f)) fautes.push(`${f} : ${r.nom}`);
  }
  assert.deepEqual(fautes, []);
});

// Écriture vers un fichier de sécurité : `node --test` et quelques outils se lancent sans demande, alors que
// modifier .claude/, tools/hooks/, .github/, .gitignore, worker/wrangler.toml, CLAUDE.md ou SECURITE.md en demande une.
// Fil d'alarme : un fichier qui écrit ou supprime ET cite un de ces chemins est signalé.
const ECRITURE = /writeFile|appendFile|createWriteStream|\brmSync\b|\bunlink|\brename(Sync)?\(|copyFile|\bcpSync\b|open\([^)]*['"][wax]\+?['"]/;
const PROTEGES = /\.claude\b|tools[\\/]+hooks|\.github\b|\.gitignore|CLAUDE\.md|SECURITE\.md|hooksPath|wrangler\.toml/;
const ECRITURE_PERMIS = [
  'tests/assets-apk.test.mjs', // écrit et supprime dans un dossier temporaire ; .claude et .github n'y sont que dans une assertion de refus
  'tools/capture.mjs', // supprime une capture et un profil jetable dans dist/ ; CLAUDE.md n'est cité que dans un message
];
const OUTILS_SANS_DEMANDE = ['tools/build-public.mjs', 'tools/capture.mjs', 'tools/gen-icons.mjs'];

test('tests/, local/ et outils lancés sans demande : aucune écriture vers un fichier de sécurité', () => {
  const fautes = [];
  for (const f of [...fichiers('tests'), ...fichiers('local'), ...OUTILS_SANS_DEMANDE]) {
    if (f === CE_FICHIER || ECRITURE_PERMIS.includes(f)) continue;
    const src = readFileSync(join(RACINE, f), 'utf8');
    if (ECRITURE.test(src) && PROTEGES.test(src)) fautes.push(f);
  }
  assert.deepEqual(fautes, []);
});

test('exception child_process : seulement `git status` en lecture', () => {
  const src = readFileSync(join(RACINE, 'tests/public-build.test.mjs'), 'utf8');
  const appels = src.match(/execFileSync\(\s*["'][^"']+["']/g) || [];
  for (const a of appels) assert.match(a, /execFileSync\(\s*["'](git|.*execPath.*)["']/);
  for (const m of src.matchAll(/execFileSync\(\s*"git",\s*\[([^\]]*)\]/g)) assert.match(m[1], /^\s*"status"/);
});
