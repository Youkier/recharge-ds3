// Garde-fous de l'essai de faisabilité E0 (attente en arrière-plan, décision du 2026-11-21) : le service de premier plan
// et ses permissions n'existent que dans la version de mise au point tant que E0 n'a pas réussi ; rien ne démarre sans
// un geste ; la page d'essai lit la configuration du câble avant l'attente et ne la garde pas au-delà de 15 min.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lire = (chemin) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');
const sansCommentairesXml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

test('manifeste publié inchangé : ni service, ni permission de service de premier plan', () => {
  const m = sansCommentairesXml(lire('../android/src/main/AndroidManifest.xml'));
  assert.ok(!/<service\b/.test(m), 'aucun service dans le manifeste principal');
  for (const p of ['FOREGROUND_SERVICE', 'WAKE_LOCK', 'POST_NOTIFICATIONS', 'CHANGE_NETWORK_STATE']) {
    assert.ok(!m.includes(`android.permission.${p}`), p);
  }
});

test('manifeste de mise au point : service connectedDevice non exporté, cinq permissions, aucune au démarrage', () => {
  const m = sansCommentairesXml(lire('../android/src/debug/AndroidManifest.xml'));
  const permissions = [...m.matchAll(/uses-permission android:name="android\.permission\.(\w+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(permissions, ['CHANGE_NETWORK_STATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CONNECTED_DEVICE', 'POST_NOTIFICATIONS', 'WAKE_LOCK']);
  assert.match(m, /<service\s+android:name="\.AttenteWifi"\s+android:exported="false"\s+android:foregroundServiceType="connectedDevice"\s*\/>/);
  assert.ok(!/BOOT_COMPLETED|EXACT_ALARM|<receiver\b|intent-filter/.test(m));
});

test('service : START_NOT_STICKY, verrou de réveil borné, arrêt de lui-même à 15 min', () => {
  const k = lire('../android/src/main/kotlin/fr/rechargeds3/coque/AttenteWifi.kt');
  assert.match(k, /return START_NOT_STICKY/);
  assert.match(k, /FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE/);
  assert.match(k, /PARTIAL_WAKE_LOCK/);
  assert.match(k, /acquire\(VERROU_MAX_MS\)/);
  assert.match(k, /VERROU_MAX_MS = 16L \* 60 \* 1000/);
  assert.match(k, /DUREE_MAX_MS = 15L \* 60 \* 1000/);
  assert.ok(!/\bacquire\(\s*\)/.test(k), 'jamais de verrou sans délai');
});

test('pont : opération essaiArrierePlan réservée à la mise au point ; onStop sans pauseTimers', () => {
  const pont = lire('../android/src/main/kotlin/fr/rechargeds3/coque/PontLocal.kt');
  assert.match(pont, /"essaiArrierePlan" -> rep\(if \(estDebug\)/);
  const act = lire('../android/src/main/kotlin/fr/rechargeds3/coque/MainActivity.kt');
  assert.ok(!/pauseTimers/.test(act.replace(/\/\/.*$/gm, ''))); // hors commentaires
  assert.match(act, /if \(!AttenteWifi\.actif\) \{\s*pont\.fermerToutAsync\(\)\s*wifi\.arreter\(\)/);
});

test('workflow : boot et alarmes exactes interdits, permissions du service seulement dans l\'APK de mise au point', () => {
  const w = lire('../.github/workflows/android.yml');
  assert.match(w, /for P in RECEIVE_BOOT_COMPLETED SCHEDULE_EXACT_ALARM/);
  assert.match(w, /\*debug\*\) PERMISES="\$PERMISES android\.permission\.FOREGROUND_SERVICE /);
  const base = w.match(/PERMISES="(android\.permission\.INTERNET[^"]*)"/);
  assert.ok(base, 'liste de base');
  assert.ok(!/FOREGROUND|WAKE_LOCK|NOTIFICATIONS/.test(base[1]), 'APK publié : liste de base inchangée');
});

test('page d\'essai : configuration lue avant l\'attente, effacée à 15 min au plus et en fin d\'essai', () => {
  const src = lire('../android/essai/essai.js');
  const corps = src.slice(src.indexOf('async function actionArrierePlan'), src.indexOf('// Vérifie que le pont natif refuse'));
  assert.ok(corps.length > 100);
  const iCable = corps.indexOf('client.cable()');
  const iAttente = corps.indexOf('await patienter(');
  assert.ok(iCable > 0 && iAttente > iCable, 'la clé est lue avant l\'attente (téléphone encore déverrouillé)');
  assert.match(src, /const ATTENTE_MAX_S = 900;/);
  assert.match(corps, /setTimeout\(oublierMemoire, ATTENTE_MAX_S \* 1000\)/);
  assert.match(corps, /finally \{\s*oublierMemoire\(\);\s*await client\.appeler\('essaiArrierePlan', \{ quoi: 'fin' \}\);/);
  assert.match(src, /action === 'arriere-plan' && variante === 'debug'/);
});
