import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const racine = new URL('../', import.meta.url);
const source = readFileSync(new URL('tools/cle-locale-qr.py', racine), 'utf8');
const gitignore = readFileSync(new URL('.gitignore', racine), 'utf8');

// Expressions interdites dans un affichage : clé, jeton, code utilisateur, identifiant du câble.
const INTERDIT = /\b(obtenue|connue|cle|local_key|token|info|user_code|device_id|terminal_id|rep|ancien|nouveau|env)\b/;

function appelsAffichage() {
  // print( et SystemExit( : une instruction par ligne (le test l'impose).
  return source.split('\n').filter((l) => /^\s*(print|raise SystemExit)\(/.test(l) || /\bprint\(/.test(l));
}

test('chaque print / SystemExit est sur une ligne, avec un littéral ou une f-string', () => {
  const lignes = appelsAffichage();
  assert.ok(lignes.length >= 8);
  for (const l of lignes) {
    // Seule exception : SystemExit(str(e)) pour les messages littéraux de chercher_cle (sans secret).
    if (l.trim() === 'raise SystemExit(str(e))') continue;
    assert.match(l, /(print|SystemExit)\(f?["'].*["']\)\s*$/, `affichage non littéral : ${l.trim()}`);
  }
});

test('aucun affichage ne contient une variable de clé, jeton, code ou identifiant', () => {
  for (const l of appelsAffichage()) {
    // Variables interpolées : ce qui est entre accolades.
    const expressions = [...l.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
    for (const e of expressions) {
      if (e === 'len(obtenue)') continue; // longueur seulement, jamais la valeur
      assert.doesNotMatch(e, INTERDIT, `expression interdite dans : ${l.trim()}`);
    }
  }
  // Seules interpolations admises : chemin du QR, nombre d'appareils, verdict, longueur, type d'erreur.
  const admises = new Set(['CHEMIN_QR', 'len(manager.device_map)', 'verdict', 'len(obtenue)', 'type(e).__name__']);
  for (const l of appelsAffichage()) {
    for (const m of l.matchAll(/\{([^}]*)\}/g)) {
      assert.ok(admises.has(m[1]), `interpolation non prévue : ${m[1]}`);
    }
  }
});

test('le code utilisateur vient de la variable d’environnement, pas de la ligne de commande', () => {
  assert.match(source, /os\.environ\.pop\("TUYA_CODE_UTILISATEUR"/);
  assert.doesNotMatch(source, /user_code\s*=.*argv/);
});

test('aucun fichier de session écrit, QR supprimé et jeton oublié en fin', () => {
  assert.match(source, /finally:[\s\S]*manager\.unload\(\)[\s\S]*supprimer_qr\(\)/);
  assert.doesNotMatch(source, /json\.dump|pickle|token_info|\.json["']/);
});

test('le script ne touche qu’au fichier d’environnement et à sa sauvegarde, et seulement avec --enregistrer', () => {
  assert.match(source, /"--enregistrer" in argv/);
  assert.match(source, /\.env\.bak/);
  assert.match(source, /0o600/);
});

test('.gitignore couvre dist/ et les fichiers de secrets de tools/', () => {
  const lignes = gitignore.split('\n').map((l) => l.trim());
  assert.ok(lignes.includes('dist/'));
  // Motif des fichiers d'environnement (dont la sauvegarde .bak), écrit sans guillemet devant le point.
  assert.ok(lignes.includes(['', 'env*'].join('.')));
});

test('CLIENT_ID de Home Assistant : usage personnel documenté', () => {
  assert.match(source, /JAMAIS les reprendre dans une\s+# appli diffusée/);
});
