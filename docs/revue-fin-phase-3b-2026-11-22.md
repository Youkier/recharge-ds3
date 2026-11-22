# Revues de fin de phase 3b (E4), 2026-11-22

Relecture de sécurité finale (Opus) et revue du tech-lead sur HEAD 06d2830 (0.6.0 en préparation). Rien de bloquant pour la sécurité ; corrections faites avant la 0.6.0 : stabilité de deux JUnit, arrêt des nouveaux essais « occupe » sur nouvelle clé ou « Oublier », commentaire de `stopSelf`, options strictes de `tools/tuya-local.mjs`, README du Worker, mesure du démarrage dans la CI, date de fin de l'essai IoT Core.

## Constats du tech-lead à décider (proposés à Mathieu)

1. **« Programmer » par un seul chemin** : tout envoi passe par le pilote natif (`attenteDebut`), même câble prêt ; l'envoi direct de la page disparaît. Il est aujourd'hui coupé si l'on quitte l'appli pendant l'écriture (résultat « incertain »). Environ 120 à 150 lignes de JS en moins.
2. **CI plus rapide** : job « essentiels » (API 35 et 36) et job « atypiques » (API 36) en parallèle, tous deux requis pour signer ; scénarios en trois fichiers ; S21 et S-I2 avec `dumpsys deviceidle force-idle` et des durées courtes ; S21 avec coupure du Wi-Fi retiré de la CI (limite de l'émulateur), confié aux essais réels. Tour estimé de 80-100 min à 40-45 min.
3. **R8 en publication** et `android/essai/` réservé à la version de mise au point, après la semaine sur le Pixel 10 (`classes.dex` mesuré à 2,97 Mo sur 3,16 Mo) ; un essai de lecture sur l'APK signé.
4. **Protocole Kotlin = référence**, `local/` gelé comme outil de diagnostic ; son retrait est décidé à la fin de C5.
5. **Connexions au câble** : supprimer la relecture redondante après une écriture réussie ; ne pas relire au retour dans l'appli si la dernière lecture date de moins de 60 s (après mesure).

## À suivre

- `site/app.js` (1161 lignes) gère l'occupation avec dix drapeaux : une seule variable d'occupation, avec le point 1.
- Constantes de délai en double entre `site/pont.js` et le Kotlin (protégées par un test).
- Avant toute diffusion : points 1 et 3 faits, cas atypiques aussi sur API 35, parcours d'obtention de la clé pour d'autres utilisateurs (volet produit).
