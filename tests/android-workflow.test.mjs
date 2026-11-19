// Garde-fous de .github/workflows/android.yml (lot C3) : pas de déclencheur pull_request, permissions minimales, actions
// épinglées par empreinte de commit, secrets et signature cantonnés au job « signer » (C3.5). Lecture du fichier seulement.
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

// Découpe du workflow par job (indentation de deux espaces sous « jobs: »).
function jobs() {
  const corps = sansCommentaires.slice(sansCommentaires.indexOf('\njobs:'));
  const parts = corps.split(/\n  (?=[\w-]+:\s*\n)/).slice(1);
  return Object.fromEntries(parts.map((p) => [p.slice(0, p.indexOf(':')), p]));
}

test('secrets et signature seulement dans le job « signer », sans code du dépôt', () => {
  const j = jobs();
  assert.ok(j.signer, 'job signer présent');
  for (const [nom, corps] of Object.entries(j)) {
    if (nom === 'signer') continue;
    assert.ok(!/secrets\./i.test(corps), `${nom} : aucune référence à secrets.*`);
    assert.ok(!/(keystore|apksigner|jarsigner|signingConfig|\.jks|\.p12|storePassword|environment:)/i.test(corps), `${nom} : pas de signature`);
  }
  const s = j.signer;
  assert.match(s, /environment: android-signature/);
  assert.match(s, /if: github\.ref == 'refs\/heads\/main'/);
  assert.ok(!/actions\/checkout@|setup-gradle|setup-java|setup-node|gradle|node |bash android/.test(s), "signer n'exécute aucun code du dépôt");
  const secrets = [...s.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(secrets, ['APK_KEYSTORE_B64', 'APK_KEYSTORE_PASSWORD']);
  assert.ok(!/secrets\./.test(s.split('run: |')[1] ?? ''), 'secrets passés par env, jamais dans run');
  assert.ok(/rm -f "\$CLE"/.test(s), 'clé effacée après usage');
  assert.match(s, /2b2a896b9edb49ed8f22ddd4f6dfdc825b47cf5f3931837bff9796b4a0512033/, 'empreinte du certificat vérifiée');
});

test('ni publication ni déploiement, aucun jeton persistant', () => {
  assert.ok(!/(git push|gh release|gh api|deploy-pages)/.test(sansCommentaires), 'ni publication ni déploiement');
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
