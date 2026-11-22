// Garde-fous de l'attente en arrière-plan de la coque (décisions du 2026-11-21 ; essai de faisabilité E0 réussi en CI) :
// service de premier plan connectedDevice dans l'APK publié, non exporté, borné ; rien ne démarre sans un geste ;
// textes de notification fixes ; la page d'essai garde la configuration du câble 15 min au plus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const chemin = (c) => fileURLToPath(new URL(c, import.meta.url));
const lire = (c) => readFileSync(chemin(c), 'utf8');
const sansCommentairesXml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const sansCommentaires = (s) => s.replace(/\/\/.*$/gm, '');
const KT = '../android/src/main/kotlin/fr/rechargeds3/coque/';

test('manifeste principal : sept permissions, service connectedDevice non exporté, rien au démarrage', () => {
  const m = sansCommentairesXml(lire('../android/src/main/AndroidManifest.xml'));
  const permissions = [...m.matchAll(/uses-permission android:name="android\.permission\.(\w+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(permissions, ['ACCESS_NETWORK_STATE', 'CHANGE_NETWORK_STATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CONNECTED_DEVICE', 'INTERNET', 'POST_NOTIFICATIONS', 'WAKE_LOCK']);
  assert.match(m, /<service\s+android:name="\.AttenteWifi"\s+android:exported="false"\s+android:foregroundServiceType="connectedDevice"\s*\/>/);
  assert.equal((m.match(/<service\b/g) || []).length, 1);
  assert.ok(!/BOOT_COMPLETED|EXACT_ALARM|<receiver\b/.test(m));
  assert.ok(!existsSync(chemin('../android/src/debug/AndroidManifest.xml')), 'plus de manifeste propre à la mise au point');
});

test('service : START_NOT_STICKY, verrou de réveil borné, 15 min au plus, filets de la règle 2', () => {
  const k = lire(KT + 'AttenteWifi.kt');
  assert.ok(!/return START_STICKY|START_REDELIVER_INTENT/.test(k));
  assert.match(k, /return START_NOT_STICKY/);
  assert.match(k, /FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE/);
  assert.match(k, /acquire\(VERROU_MAX_MS\)/);
  assert.match(k, /VERROU_MAX_MS = 16L \* 60 \* 1000/);
  assert.match(k, /DUREE_MAX_MS = 15L \* 60 \* 1000/);
  assert.ok(!/\bacquire\(\s*\)/.test(k), 'jamais de verrou sans délai');
  assert.match(k, /private val filet = Runnable \{ terminer\(Attente\.Issue\.INCONNUE\) \}/, '15 min sans résultat : « Résultat inconnu »');
  assert.match(k, /override fun onTaskRemoved[\s\S]*?terminer\(Attente\.Issue\.APPLI_FERMEE\)/, 'appli balayée : « non envoyée »');
  assert.match(k, /PendingIntent\.FLAG_IMMUTABLE/);
  assert.ok(!/FLAG_MUTABLE/.test(k));
  assert.match(k, /PendingIntent\.getService\(\s*this, 1, Intent\(this, AttenteWifi::class\.java\)\.setAction\(ACTION_ANNULER\)/, 'Annuler : intention explicite');
});

test('textes : fixes, dans strings.xml, apostrophes échappées ; la page ne fournit que l\'heure et un résultat fermé', () => {
  const x = lire('../android/src/main/res/values/strings.xml');
  const valeur = (nom) => (x.match(new RegExp(`<string name="${nom}">([^<]*)</string>`)) || [])[1];
  assert.equal(valeur('attente_titre'), 'En attente du Wi-Fi et du câble');
  assert.equal(valeur('attente_texte'), 'Programmation de %1$s dès que le câble répond');
  assert.equal(valeur('resultat_ok_titre'), 'Charge programmée : démarrage %1$s');
  assert.equal(valeur('resultat_ok_texte'), 'Relu sur le câble. Pensez à brancher la voiture ce soir.');
  assert.equal(valeur('resultat_aucune_texte'), 'Demain soir, reprogrammez : sinon la voiture ne chargera pas.');
  assert.equal(valeur('resultat_ko_titre'), 'Programmation non faite');
  assert.equal(valeur('resultat_a_la_main'), 'À régler à la main dans Smart Life : début %1$s.');
  assert.equal(valeur('resultat_verifier'), 'Vérifiez dans Smart Life ; sinon réglez le début à %1$s.');
  assert.equal(valeur('resultat_annulee_titre'), 'Attente annulée');
  assert.equal(valeur('resultat_inconnu_titre'), 'Résultat inconnu');
  assert.equal(valeur('resultat_fermee_titre'), 'Programmation non envoyée');
  assert.equal(valeur('resultat_fermee_texte'), 'L\\\'application a été fermée. À régler à la main dans Smart Life : début %1$s.');
  assert.equal(valeur('resultat_a_la_main_sans_heure'), 'À régler à la main dans Smart Life.');
  for (const [, v] of x.matchAll(/<string name="[^"]+">([^<]*)<\/string>/g)) {
    assert.ok(!/(^|[^\\])'/.test(v), `apostrophe non échappée : ${v}`);
  }
  // Aucun texte de notification ne vient de la page : setContentTitle / setContentText ne prennent que getString(...).
  const k = lire(KT + 'AttenteWifi.kt');
  for (const [, arg] of k.matchAll(/setContent(?:Title|Text)\(([^)]*\)?)\)/g)) {
    assert.ok(/getString\(|^corps$/.test(arg), `texte de notification : ${arg}`);
  }
});

test('pont : opérations d\'attente en version publiée, essaiArrierePlan réservée à la mise au point', () => {
  const pont = sansCommentaires(lire(KT + 'PontLocal.kt'));
  assert.match(pont, /"essaiArrierePlan" -> rep\(if \(estDebug\)/);
  assert.match(pont, /"notifications", "demanderNotifications", "attenteDebut", "attenteEtat" -> attente\(op, q, rep\)/);
  // attenteFin : la configuration gardée côté natif pour l'attente est effacée, puis l'activité traite la fin.
  assert.match(pont, /"attenteFin" -> \{\s*operations\.oublierMemoire\(\)[^\n]*\n\s*attente\(op, q, rep\)/);
  const act = sansCommentaires(lire(KT + 'MainActivity.kt'));
  assert.ok(!/pauseTimers/.test(act));
  assert.match(act, /if \(!AttenteWifi\.actif\) \{\s*pont\.fermerToutAsync\(\)\s*wifi\.arreter\(\)/);
  assert.match(act, /!Attente\.heureValide\(h\) -> repondre\(erreur\("requete_invalide"\)\)/);
  assert.match(act, /!notificationsAutorisees\(\) -> repondre\(erreur\("notifications"\)\)/);
  assert.match(act, /AttenteWifi\.actif -> repondre\(erreur\("occupe"\)\)/);
  assert.match(act, /if \(AttenteWifi\.actif\) abandonnerAttente\(\)/, 'appli fermée pendant l\'attente');
  // Le contrat est décrit dans le client JS du pont.
  const contrat = lire('../android/essai/transport-pont.js');
  for (const op of ['notifications', 'demanderNotifications', 'attenteDebut', 'attenteEtat', 'attenteFin']) assert.ok(contrat.includes(op), op);
});

test('workflow : sept permissions exigées, service contrôlé dans le manifeste compilé, boot et alarmes exactes interdits', () => {
  const w = lire('../.github/workflows/android.yml');
  assert.match(w, /for P in RECEIVE_BOOT_COMPLETED SCHEDULE_EXACT_ALARM USE_EXACT_ALARM/);
  assert.match(w, /ATTENDUES="INTERNET ACCESS_NETWORK_STATE FOREGROUND_SERVICE FOREGROUND_SERVICE_CONNECTED_DEVICE CHANGE_NETWORK_STATE WAKE_LOCK POST_NOTIFICATIONS"/);
  assert.match(w, /dump xmltree --file AndroidManifest\.xml/);
  assert.match(w, /android:exported/);
  assert.match(w, /android:foregroundServiceType/);
  assert.ok(!/\*debug\*\) PERMISES/.test(w), 'même liste pour les deux APK');
});

test('page d\'essai : configuration gardée par le natif avant l\'attente, effacée en fin d\'essai, jamais lue par la page', () => {
  const src = lire('../android/essai/essai.js');
  const corps = src.slice(src.indexOf('async function actionArrierePlan'), src.indexOf('async function actionFiltre'));
  assert.ok(corps.length > 100);
  const iMemoire = corps.indexOf('client.memoriser()');
  const iAttente = corps.indexOf('await patienter(');
  assert.ok(iMemoire > 0 && iAttente > iMemoire, 'la configuration est gardée avant l\'attente (téléphone encore déverrouillé)');
  assert.match(src, /const ATTENTE_MAX_S = 900;/);
  assert.match(corps, /finally \{\s*await client\.oublierMemoire\(\);\s*await client\.appeler\('essaiArrierePlan', \{ quoi: 'fin' \}\);/);
  assert.ok(!/\.cle\b|cleLocale|deviceId/.test(corps), 'la page ne manipule ni clé ni identifiant');
  assert.match(src, /action === 'arriere-plan' && variante === 'debug'/);
  // Côté natif : 15 min au plus, octets mis à zéro.
  const ops = sansCommentaires(lire(KT + 'OperationsCable.kt'));
  assert.match(ops, /dureeMemoireMs: Long = 15 \* 60_000L/);
  assert.match(ops, /memoire\?\.cle\?\.fill\(0\)/);
});
