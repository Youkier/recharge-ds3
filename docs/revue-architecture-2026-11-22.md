# Revue d'architecture et d'optimisation du 2026-11-22 (après E2)

Tech-lead, en lecture seule, sur 6bb46ed et e76497d. Rien ne bloque le push. Tests : 532 réussis, 0 échec, 3 « todo » déjà connus.

## Constats, triés par impact

1. **Avant E3.** `OperationsCable` vit avec l'activité (`MainActivity.kt:68`), pas avec le processus.
   - `onDestroy` et `demarrage` coupent tout, y compris une écriture lancée par le service. Une page rechargée ou une appli balayée annulerait donc l'attente.
   - Il faut une seule instance par processus, partagée par l'activité et le service.
   - `demarrage` n'annule que les opérations de la page ; la clé n'est effacée que si aucune attente n'est en cours.
2. **Avant E3.** Les nouvelles tentatives sont dans `site/local.js` : seconde lecture, second balayage, seconde écriture si `ecrit` est absent, budget de 27 s.
   - Elles passent dans `OperationsCable`, testées en JUnit.
   - La règle « jamais de nouvel envoi après une écriture » n'est alors écrite qu'à un seul endroit.
3. **E3.** L'attente a un seul propriétaire, natif (`PiloteAttente`, classe Kotlin pure, horloge et faux câble injectés), état persisté.
   - `attenteEtat` rend le résultat brut, sous la même forme que `programmer`, interprété par `service.js`.
   - Le calcul reste en JS : le natif ne reçoit que des heures HH:MM.
4. **E4.** Retirer :
   - côté page : environ 200 lignes d'attente dans `app.js`, et les lignes 107 à 224 de `accueil.js` ;
   - côté pont : `memoriser`, `oublierMemoire`, `attenteFin` et `essaiArrierePlan`, plus le scénario E0 ;
   - côté Kotlin : le doublon HH:MM (`Attente.kt:9`, `Plage.kt:23`) ;
   - côté documents : la règle 9 de `CLAUDE.md` et `SECURITE.md`, qui parlent encore du « pont TCP » et de `local/`.
5. **Avant E3 ou E4.** Le client du pont vit dans `android/essai/transport-pont.js` alors qu'il est importé par `app.js:919`.
   - Le déplacer dans `site/pont.js`.
   - N'embarquer `android/essai/` (21 Ko) qu'en version de mise au point.
   - L'exception de `FiltreAssets` disparaît.
6. **Mesurer avant E3.** Plusieurs points à vérifier :
   - `cable()` déchiffre la clé à chaque contrôle « Hors Wi-Fi », toutes les 5 s, pour un champ `illisible` que la page n'utilise pas : il faut ne plus déchiffrer là.
   - Recherche sans adresse : jusqu'à environ 78 s, et le compte à rebours repart à 30 s. Il doit couvrir les deux balayages.
   - À mesurer sur émulateur : démarrage (`am start -W`), délai jusqu'à « Câble prêt », durée d'un déchiffrement.
7. **Ordre des corrections UX** (`docs/revue-ux-2026-11-22.md`) :
   - **Lot A, avant E3, page seulement** :
     - plage du câble à l'ouverture : `etatCable` la rend déjà, mais `majEtatCable` (`app.js:958`) la jette ;
     - « départ de demain » : `localStorage` avec une date de fin, `calc.js` inchangé ;
     - bandeau de changement d'heure, calculé (dernier dimanche de mars et d'octobre), pas écrit en dur ;
     - textes.
   - **Lot B, avec E3** : écran d'attente (n°6) et attente non suivie (n°12, persistée côté natif).
8. **Avec le lot UX.** `effAuto` existe en trois copies (`site/app.js:16`, `public/app/app-public.js:14`, `tools/build-public.mjs:230`) : l'exporter depuis `calc.js`. `plan()` ne change pas.
9. **Avant E3.** La règle « heure déjà passée » existe en trois copies : Worker, `local/`, `Plage.kt`.
   - Le fichier de cas commun ne vérifie pas le Worker : le lui faire lire.
   - Y ajouter les nuits de changement d'heure.
10. **Plus tard.** Poids et service worker :
    - page perso : 48 Ko compressés ;
    - accueil public : 23 Ko compressés ;
    - APK : 252 Ko, dont 21 Ko d'essai.

    Le service worker va au réseau d'abord avec un délai de 4 s, et les modules se chargent en cascade : jusqu'à environ 12 s d'attente sur un réseau dégradé, selon un calcul tiré du code. À mesurer avant de changer quoi que ce soit.

## Décisions proposées (à valider par Mathieu)

- Une seule instance d'`OperationsCable` par processus ; recharger la page n'annule jamais l'attente.
- Les nouvelles tentatives passent dans `OperationsCable` avant E3.
- E3 : l'état de l'attente est tenu et persisté par le natif ; les résultats sont interprétés par `service.js` ; le calcul reste en JS.
- `site/pont.js` ; `android/essai/` seulement en mise au point.
- `effAuto` exporté par `calc.js`.
- Lot UX en deux temps : lot A avant E3, n°6 et n°12 avec E3.
