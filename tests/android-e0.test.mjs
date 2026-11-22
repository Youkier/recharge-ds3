// Garde-fous de l'attente en arrière-plan de la coque (décisions des 2026-11-21 et 2026-11-22, lot E3) :
// service de premier plan connectedDevice dans l'APK publié, non exporté, borné, hôte du pilote natif ; rien ne démarre sans un
// geste ; textes de notification fixes, début et fin ; configuration du câble gardée 15 min au plus, en octets.
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

test('service : START_NOT_STICKY, verrou de réveil borné, 15 min au plus, filets de la règle 2, hôte du pilote', () => {
  const k = lire(KT + 'AttenteWifi.kt');
  assert.ok(!/return START_STICKY|START_REDELIVER_INTENT/.test(k));
  assert.match(k, /return START_NOT_STICKY/);
  assert.match(k, /FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE/);
  assert.match(k, /acquire\(VERROU_MAX_MS\)/);
  assert.match(k, /VERROU_MAX_MS = 16L \* 60 \* 1000/);
  assert.match(k, /DUREE_MAX_MS = 15L \* 60 \* 1000/);
  assert.ok(!/\bacquire\(\s*\)/.test(k), 'jamais de verrou sans délai');
  // 15 min sans résultat : le pilote clôt l'attente en « inconnu » (jamais de silence).
  assert.match(k, /private val filet = Runnable \{ Thread \{ pilote\.finaliserInconnu\(\) \}\.start\(\) \}/);
  assert.match(k, /principal\.postDelayed\(filet, DUREE_MAX_MS\)/);
  assert.match(k, /override fun onTimeout[\s\S]*?finaliserInconnu\(\)/);
  assert.match(k, /override fun onDestroy[\s\S]*?pilote\.enCours\(\)\) Thread \{ pilote\.finaliserInconnu\(\) \}/, 'service détruit en cours d\'attente : résultat inconnu');
  // Le service suit le Wi-Fi lui-même et ne touche ni au réseau ni au coffre : tout passe par le pilote.
  assert.match(k, /proprietaire\.wifi\.demarrer\(\)/);
  assert.match(k, /pilote\.lancer\(\)/);
  assert.ok(!/onTaskRemoved/.test(k), 'balayer l\'appli n\'annule pas l\'attente');
  assert.ok(!/ClientCable|TransportTcp|CoffreCable/.test(k.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  assert.match(k, /PendingIntent\.FLAG_IMMUTABLE/);
  assert.ok(!/FLAG_MUTABLE/.test(k));
  assert.match(k, /PendingIntent\.getService\(\s*this, 1, Intent\(this, AttenteWifi::class\.java\)\.setAction\(ACTION_ANNULER\)/, 'Annuler : intention explicite');
  // « Annuler » n'agit qu'avant l'envoi : refusé par le pilote ensuite, et retiré de la notification quand l'envoi commence.
  assert.match(k, /override fun envoiCommence\(\)[\s\S]*?annulable = false/);
});

test('textes : fixes, dans strings.xml, apostrophes échappées ; la page ne fournit que des heures validées', () => {
  const x = lire('../android/src/main/res/values/strings.xml');
  const valeur = (nom) => (x.match(new RegExp('<string name="' + nom + '">([^<]*)</string>')) || [])[1];
  assert.equal(valeur('attente_titre'), 'En attente du Wi-Fi et du câble');
  assert.equal(valeur('attente_texte'), 'Programmation de %1$s dès que le câble répond (10 min au plus)');
  assert.equal(valeur('resultat_ok_titre'), 'Charge programmée : démarrage %1$s');
  assert.equal(valeur('resultat_ok_texte'), 'Relu sur le câble, fin %2$s. Branchez la voiture avant %1$s : sinon la charge ne démarrera pas.');
  assert.equal(valeur('resultat_tardif_titre'), 'Heure de début dépassée : charge programmée de %1$s à %2$s');
  assert.equal(valeur('resultat_tardif_texte'), 'Relu sur le câble. Branchez la voiture avant %1$s. Demain soir, reprogrammez : cette plage se répète chaque nuit.');
  assert.equal(valeur('resultat_trop_tard_titre'), 'Trop tard pour charger');
  assert.equal(valeur('resultat_trop_tard_texte'), "Le départ est trop proche : rien n\\'a été modifié sur le câble. Pour charger quand même, démarrez la charge à la main dans Smart Life.");
  assert.equal(valeur('resultat_aucune_texte'), 'Demain soir, reprogrammez : sinon la voiture ne chargera pas.');
  assert.equal(valeur('resultat_ko_titre'), 'Programmation non faite');
  // Tout échec donne le début ET la fin à régler à la main.
  assert.equal(valeur('resultat_a_la_main'), 'À régler à la main dans Smart Life : début %1$s, fin %2$s.');
  assert.equal(valeur('resultat_verifier'), 'Vérifiez dans Smart Life > charge différée : début %1$s, fin %2$s, activée.');
  assert.equal(valeur('resultat_annulee_titre'), 'Attente annulée');
  assert.equal(valeur('resultat_inconnu_titre'), 'Résultat inconnu');
  // Plus de texte « appli fermée » ni de variante sans heure : balayer l'appli n'annule rien, les heures sont toujours connues.
  for (const mort of ['resultat_fermee_titre', 'resultat_fermee_texte', 'resultat_a_la_main_sans_heure', 'resultat_ok_titre_sans_heure', 'resultat_immediat_titre']) {
    assert.equal(valeur(mort), undefined, mort);
  }
  for (const [, v] of x.matchAll(/<string name="[^"]+">([^<]*)<\/string>/g)) {
    assert.ok(!/(^|[^\\])'/.test(v), 'apostrophe non échappée : ' + v);
  }
  // Aucun texte de notification ne vient de la page : setContentTitle / setContentText ne prennent que getString(...).
  const k = lire(KT + 'AttenteWifi.kt');
  for (const [, arg] of k.matchAll(/setContent(?:Title|Text)\(([^)]*\)?)\)/g)) {
    assert.ok(/getString\(|^corps$/.test(arg), 'texte de notification : ' + arg);
  }
});

test('pont : opérations d\'attente en version publiée, revalidées côté natif', () => {
  const pont = sansCommentaires(lire(KT + 'PontLocal.kt'));
  assert.match(pont, /"essaiFiltre" -> if \(estDebug\)/);
  assert.ok(!/essaiArrierePlan|"memoriser"|"oublierMemoire"|"attenteFin"/.test(pont), 'plus de route d\'essai, de mémorisation ni de fin écrite par la page');
  assert.match(pont, /"notifications", "demanderNotifications" -> notifications\(op, rep\)/);
  assert.match(pont, /"attenteDebut" -> attenteDebut\(q, rep\)/);
  assert.match(pont, /"attenteEtat" -> rep\(JSONObject\(pilote\.etat\(\)\)\)/);
  assert.match(pont, /"attenteAnnuler" -> enArrierePlan\(rep\) \{ ok\(\)\.put\("annulee", pilote\.annuler\(\)\) \}/);
  assert.match(pont, /"attenteAcquitter" -> enArrierePlan\(rep\) \{ pilote\.acquitter\(\); surResultatVu\(\); ok\(\) \}/);
  // attenteDebut : demande et heures revalidées, démarrage hors du fil principal, service refusé -> attente retirée.
  assert.match(pont, /lireAction\(q\.optJSONObject\("demande"\)\) \?: return repondre\(erreur\("requete_invalide"\)\)/);
  assert.match(pont, /!Attente\.heureValide\(debut\) \|\| !Attente\.heureValide\(fin\)/);
  assert.match(pont, /if \(!lancerService\(\)\) \{ pilote\.abandonnerDemarrage\(\)/);
  // Nouvelle clé : l'attente s'arrête et la configuration gardée est effacée.
  assert.match(pont, /"saisirCle" -> \{ Thread \{ pilote\.arreterPourCle\(\) \}\.start\(\); surSaisirCle\(\)/);
  const act = sansCommentaires(lire(KT + 'MainActivity.kt'));
  assert.ok(!/pauseTimers/.test(act));
  assert.match(act, /override fun onStop\(\) \{\s*visible = false\s*AttenteWifi\.activiteVisible = false\s*pont\.fermerToutAsync\(\)\s*wifi\.arreter\(\)/);
  assert.equal((act.match(/pilote\.arreterPourCle\(\)/g) || []).length, 2, 'nouvelle clé et « Oublier le câble » arrêtent l\'attente');
  assert.ok(!/abandonnerAttente|essaiArrierePlan|demarrerAttente/.test(act), 'l\'activité ne pilote plus l\'attente');
  // Le contrat est décrit dans le client JS du pont.
  const contrat = lire('../site/pont.js');
  for (const op of ['notifications', 'demanderNotifications', 'attenteDebut', 'attenteEtat', 'attenteAnnuler', 'attenteAcquitter']) assert.ok(contrat.includes(op), op);
});

test('pilote : bornes de l\'attente et clé gardée 15 min au plus', () => {
  const p = sansCommentaires(lire(KT + 'PiloteAttente.kt'));
  assert.match(p, /DUREE_MAX_MS = 10 \* 60_000L/);
  assert.match(p, /LECTURE_MS = 5_000L/);
  assert.match(p, /SILENCE_MS = 60_000L/);
  // « Annuler » : seulement avant l'envoi ; l'échéance est revérifiée dans le même geste que le passage en phase « envoi ».
  assert.match(p, /avantEnvoiSeulement && phase != Phase\.ATTENTE\) return false/);
  assert.match(p, /if \(now < debutMs \|\| now - debutMs >= dureeMaxMs\) true\s*else \{ phase = Phase\.ENVOI; persister\(\); false \}/);
  // Un seul envoi, avec nouvelle tentative gérée par OperationsCable (jamais après une écriture partie).
  assert.equal((p.match(/operations\.programmer\(/g) || []).length, 1);
  assert.match(p, /operations\.programmer\(null, a, DELAI_ENVOI_MS, true, Origine\.SERVICE\)/);
  // La clé est effacée dans tous les cas à la fin ; le fichier de l'attente ne contient ni clé ni identifiant ni adresse.
  assert.match(p, /operations\.oublierMemoire\(\)\s*\n\s*val \(debut, fin\) = heuresDeLaNotification/);
  assert.ok(!/lireCle|cleLocale|deviceId|retenirAdresse/.test(p), 'le pilote ne manipule jamais la clé');
  const ops = sansCommentaires(lire(KT + 'OperationsCable.kt'));
  assert.match(ops, /dureeMemoireMs: Long = 15 \* 60_000L/);
  assert.match(ops, /memoire\?\.cle\?\.fill\(0\)/);
  const fichier = sansCommentaires(lire(KT + 'StockageAttenteFichier.kt'));
  assert.match(fichier, /renameTo/);
  assert.ok(!/Preferences|CoffreCable/.test(fichier));
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

test("page d'essai : plus d'essai E0 (l'attente réelle est testée par les scénarios S15 à S22 et S-C, S-I)", () => {
  const src = lire('../android/essai/essai.js');
  assert.ok(!/arriere-plan|essaiArrierePlan|memoriser|oublierMemoire/.test(src));
  assert.ok(!/arriere-plan/.test(sansCommentaires(lire(KT + 'MainActivity.kt'))));
});
