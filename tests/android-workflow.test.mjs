// Garde-fous de .github/workflows/android.yml (lot C3) : pas de déclencheur pull_request, permissions minimales, actions
// épinglées par empreinte de commit, aucun secret, aucune clé de signature. Lecture du fichier seulement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../.github/workflows/android.yml', import.meta.url)), 'utf8');
const sansCommentaires = src.replace(/^\s*#.*$/gm, '').replace(/\s#\s.*$/gm, '');

test('déclencheurs : push sur main filtré et lancement à la main, jamais pull_request', () => {
  assert.ok(!/pull_request/.test(sansCommentaires), 'aucun déclencheur pull_request ni pull_request_target');
  assert.match(sansCommentaires, /\n\s+push:\s*\n\s+branches: \[main\]/);
  assert.match(sansCommentaires, /workflow_dispatch:/);
  for (const chemin of ['android/**', 'site/**', 'local/**', 'tools/assets-apk.mjs', 'tools/faux-cable-tcp.mjs']) {
    assert.ok(sansCommentaires.includes(`"${chemin}"`), chemin);
  }
});

test('permissions : lecture du contenu seulement, aucune écriture', () => {
  assert.match(sansCommentaires, /\npermissions:\s*\n\s+contents: read\n/);
  assert.ok(!/(contents|pages|id-token|actions|packages|pull-requests|checks|deployments): write/.test(sansCommentaires));
});

test('actions épinglées par empreinte de commit de 40 caractères', () => {
  const utilisations = [...sansCommentaires.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(utilisations.length >= 8, `actions trouvées : ${utilisations.length}`);
  for (const u of utilisations) assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, u);
  const noms = new Set(utilisations.map((u) => u.split('@')[0]));
  for (const attendu of ['actions/checkout', 'actions/setup-node', 'actions/setup-java', 'gradle/actions/setup-gradle', 'actions/upload-artifact', 'actions/download-artifact']) {
    assert.ok(noms.has(attendu), attendu);
  }
});

test('aucun secret, aucune clé de signature, aucune écriture hors artefacts', () => {
  assert.ok(!/secrets\./i.test(sansCommentaires), 'aucune référence à secrets.*');
  assert.ok(!/(keystore|apksigner|jarsigner|signingConfig|\.jks|storePassword)/i.test(sansCommentaires), 'pas de signature dans ce workflow (C3.5, job séparé)');
  assert.ok(!/(git push|gh release|gh api|deploy-pages|environment:)/.test(sansCommentaires), 'ni publication ni déploiement');
  assert.ok(!/persist-credentials: true/.test(sansCommentaires));
  const recuperations = (sansCommentaires.match(/actions\/checkout@/g) || []).length;
  const sansPersistance = (sansCommentaires.match(/persist-credentials: false/g) || []).length;
  assert.equal(sansPersistance, recuperations, 'chaque récupération du code sans jeton persistant');
});

test('jobs : construire puis émulateur en matrice API 35 et 36', () => {
  assert.match(sansCommentaires, /\n  construire:/);
  assert.match(sansCommentaires, /\n  emulateur:/);
  assert.match(sansCommentaires, /needs: construire/);
  assert.match(sansCommentaires, /api: \[35, 36\]/);
});
