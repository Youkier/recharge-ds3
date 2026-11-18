# Revue de conception de la coque Android (2026-11-18)

Avant le lot C3. Revues de l'`ergonome` et du `testeur-relecteur` ; celle du `tech-lead` est ajoutée quand elle arrive. Décisions à prendre par Mathieu avant de coder, puis à reporter dans `docs/cahier-des-charges-coque-android.md` et `docs/decisions-produit.md`.

## Constat déjà mesuré (PC)

Recherche automatique du câble : adresse mémorisée remplacée par une adresse inoccupée, câble retrouvé en 16 s, lecture suivante en 0,45 s. Sur le téléphone, rien n'est prouvé : la WebView ne connaît pas l'adresse du téléphone, et Android 17 demande la permission « réseau local ».

## Ergonome : à décider avant de coder

1. **Attente pendant la recherche (jusqu'à 30 s)** : textes par étape (« Connexion au câble… », « Recherche du câble sur le Wi-Fi… (jusqu'à 30 s) », « Vérification de l'heure sur le câble… »), bouton Annuler, écran gardé allumé pendant l'envoi, annonce vocale par étape.
2. **Bouton « Programmer la charge »** : aujourd'hui masqué si le Worker n'est pas configuré ; en mode Local, il dépend de l'adresse, de l'identifiant et de la clé.
3. **Permission réseau local** : demandée au premier « Tester la connexion », précédée d'une phrase d'explication ; un refus donne son propre message et un bouton vers les réglages de l'appli, jamais « câble injoignable ».
4. **Première configuration** : ordre adresse, identifiant, clé ; bouton « Tester la connexion » en lecture seule (« Câble joint : charge différée 00:20 → 06:00 ») ; clé masquée puis « Clé enregistrée », collage depuis le gestionnaire de mots de passe possible.
5. **Mode** : Local présélectionné quand la clé est enregistrée ; le bouton dit par où il passe (« par le Wi-Fi de la maison » / « par le service ») ; le message de succès aussi.
6. **Échecs** : un message par cause (pas de Wi-Fi, permission refusée, aucun câble ne répond, clé refusée → « ressaisir la clé »), heure à régler à la main toujours visible ; nouvelle adresse annoncée, jamais enregistrée en silence.
7. **Secours** : « Réessayer par le service (internet) » dans l'alerte KO, seulement si le service est configuré.
8. Textes de la page faux dans la coque (« enregistrés dans ce navigateur »), section Paramètres renommée « Programmation de la charge » avec le choix du mode en tête, résumé replié selon le mode.

## Testeur-relecteur : sécurité de la conception

1. **Recherche et « une seule connexion » se contredisent** (32 sondes en parallèle) : soit une opération native `sonder(ip, délai)` bornée, soit des connexions identifiées avec un plafond ; à écrire dans le cahier et la règle n°9.
2. **Pont à état global** : identifiant par connexion, `fermer(id)` idempotent, refus des opérations sur un identifiant périmé (un `fermer` tardif ne doit pas couper l'appel suivant).
3. **Clé dans la WebView** : lue seulement au moment de l'appel, jamais en `localStorage`, DOM, URL ni message retour ; `addWebMessageListener` avec origine autorisée plutôt que `addJavascriptInterface` ; CSP de la coque resserrée à `'self'` hors mode Service ; test d'empreintes des fichiers embarqués ; saisie de la clé de préférence dans l'activité native.
4. **Pont côté Kotlin** : filtre d'adresse refait sans DNS (refuser `010.0.0.1`, `0x7f.1`, `x.nip.io`, entiers, IPv6, `127.x`, `169.254.x`, `0.0.0.0`), port 6668 strict, tailles envoyée et reçue plafonnées (2 Ko), appels asynchrones.
5. **Réseau étranger** : recherche seulement sur action de l'utilisateur ou après échec de l'adresse enregistrée, limitée dans le temps, jamais en arrière-plan, annoncée à l'écran.
6. **Permission** : contrôlée avant toute recherche ou connexion ; code transport distinct que le module ne transforme pas en `hors_ligne`.
7. **Délais sur téléphone** (économie d'énergie Wi-Fi, minuteries ralenties) : mesurer sur le Pixel avant de déclarer la recherche fiable ; plafonner le parallélisme côté pont.
8. Horloge du téléphone fausse → décision « immédiat » fausse (à signaler dans la page d'essai).
9. `delai` après une écriture : résultat incertain, dire « vérifier dans Smart Life ».
10. Sauvegardes et écran : `allowBackup="false"` et `dataExtractionRules`, champ mot de passe sans suggestions, `FLAG_SECURE` sur l'écran de la clé, débogage désactivé en production, aucune trame dans Logcat ; clé en clair en mémoire de la WebView à écrire dans `SECURITE.md`.
11. Service worker de `site/` dans la WebView : vérifier que la page servie est celle de l'APK, pas une copie périmée.

**Tests à prévoir pour C3** : modules sans rien de propre à Node (étendre le test à `tuya-local.js`) ; pont simulé avec identifiants de connexion ; tests JUnit du filtre d'adresses, du port, des tailles et de l'ordre des appels ; sur le Pixel, rejouer les vecteurs et les cas de référence dans la WebView, permission refusée, mode avion, mesure d'une vraie recherche, aucune connexion restée ouverte, rien dans Logcat.

## Tech lead

À venir.
