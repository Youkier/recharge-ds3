# Plan du projet

Chaque phase se termine par des critères d'acceptation vérifiés par `testeur-relecteur`, puis validés par Mathieu.

---

## Phase 0 – Mise en place (Mathieu, avec la session principale)

- [x] Dépôt GitHub public `recharge-ds3` créé, kit copié, premier commit
- [x] Claude Code lancé dans le dossier, `CLAUDE.md` lu
- [x] `node --version` ≥ 20 disponible
- [x] Double authentification activée sur le compte GitHub
- [x] Sur le dépôt : Settings → Code security → *Secret scanning* et *Push protection* activés

**Fin de phase :** le chef de projet résume le plan et liste ce qu'il attend de Mathieu.

---

## Phase 1 – Page en ligne et installable

**Objectif :** ouvrir la page depuis une icône sur le Pixel, sans compte Claude, avec les paramètres conservés et un fonctionnement hors ligne.

### Tâches

1. **Extraire le calcul** (`dev-web`)
   - Déplacer `plan()` et ses fonctions utilitaires de `site/index.html` vers `site/calc.js`, utilisable à la fois par la page et par Node (module ES).
   - Aucun changement de comportement.
2. **Tests de référence** (`testeur-relecteur`)
   - `tests/calc.test.mjs` : rejoue chaque cas de `tests/golden-cases.json` avec `node --test`.
   - Ajouter des cas limites (cible 100 %, heures creuses qui ne traversent pas minuit, courant à 0), en signalant toute sortie qui paraît absurde au lieu de la « corriger ».
3. **PWA** (`dev-web`)
   - `manifest.webmanifest` : nom « Recharge DS 3 », `display: standalone`, `start_url` et `scope` adaptés au chemin GitHub Pages, couleurs, icônes 192 et 512 px (PNG) + icône maskable.
   - `sw.js` : mise en cache des fichiers de la page pour le hors ligne, avec un numéro de version pour forcer la mise à jour.
   - Liens dans `index.html`, enregistrement du service worker.
   - Retirer la dépendance obligatoire aux Google Fonts (police système ou police embarquée), pour un hors ligne complet.
4. **Publication** (`dev-web`, après accord de Mathieu)
   - GitHub Pages servi depuis le dossier `site/` via une GitHub Action (`.github/workflows/pages.yml`), qui lance aussi les tests avant de publier.

### Critères d'acceptation

- [x] `node --test tests/` passe, tous les cas de référence reproduits
- [x] Page accessible à `https://youkier.github.io/recharge-ds3/`
- [x] Sur le Pixel : Chrome propose « Installer l'application » ou « Ajouter à l'écran d'accueil », l'icône s'ouvre en plein écran
- [x] Paramètres modifiés, appli fermée puis rouverte : les paramètres sont conservés
- [x] Mode avion : la page s'ouvre et calcule
- [ ] Une nouvelle version publiée apparaît sur le téléphone après au plus deux ouvertures

---

## Phase 2a – Point d'arrêt Tuya (décide de la suite)

**Objectif :** prouver que le câble est pilotable par l'API avant d'écrire le moindre service.

### Ce que fait Mathieu (guidé pas à pas par le chef de projet)

1. Compte sur la plateforme développeur Tuya (iot.tuya.com), projet cloud de type Smart Home, centre de données **Central Europe**.
2. Liaison du compte Smart Life au projet (scan d'un QR code depuis l'appli Smart Life).
3. Abonnement gratuit au service IoT Core (et à ce que la sonde réclame).
4. Double authentification activée sur le compte développeur Tuya.
5. Récupération de l'Access ID, de l'Access Secret et de l'identifiant du câble, à placer dans `tools/.env` (ignoré par git).

### Ce que fait `tuya-integrateur`

- Script `tools/tuya-probe.mjs` (Node, sans dépendance) : obtenir un jeton, lire les fonctions, la spécification et l'état du câble, envoyer une commande de test.
- Consigner dans `docs/tuya-findings.md` : codes de fonction, valeurs possibles, résultats des essais, sources.

### Tests du point d'arrêt

| # | Test | Si échec |
|---|---|---|
| T1 | Le câble apparaît dans le projet et la sonde lit son état. La liste des autres appareils visibles est notée dans `docs/tuya-findings.md` (noms et catégories seulement) | Arrêt |
| T2 | Allumer puis éteindre via l'API fonctionne | Arrêt |
| T3 | Une programmation différée exécutée **par l'appareil** fonctionne : minuterie d'appareil réglée par l'API, ou compte à rebours (« s'allumer dans N minutes ») | Arrêt, ou décision de Mathieu |
| T4 | La minuterie s'exécute avec internet coupé côté box (test de 10 minutes) | Noter, décision de Mathieu |
| T5 | Voiture branchée prise éteinte depuis plus de 2 h : la charge démarre bien à l'allumage | Arrêt : problème indépendant de l'API |

**Fin de phase :** rapport court du chef de projet (ce qui marche, ce qui ne marche pas, recommandation) et décision de Mathieu : continuer, adapter ou arrêter.

---

## Phase 2b – Worker de programmation

**Objectif :** un service minimal qui reçoit l'heure calculée et programme la prise.

### Tâches (`tuya-integrateur`)

- `worker/` : Cloudflare Worker (JavaScript, Web Crypto, aucune dépendance d'exécution).
- `POST /api/programmer` avec `{ "allumage": "HH:MM" }` ou `{ "desactiver": true }` : règle la programmation retenue en phase 2a. Réponse : ce qui a été réellement programmé, relu sur l'appareil.
- `GET /api/etat` : état du câble et programmation en place.
- **Uniquement ces deux routes.** Aucune route générique d'envoi de commande. L'heure est validée au format strict `HH:MM` (00:00 à 23:59) ; tout autre corps est refusé (400).
- Authentification : en-tête `Authorization: Bearer <jeton>` comparé au secret `JETON_ACCES` **en temps constant**. Refus sans jeton valide (401).
- Limite d'appels : quelques dizaines de requêtes par heure au plus, réponse 429 au-delà, via une fonction de limitation de débit de Cloudflare (règle de sécurité ou binding de limitation : solution à vérifier dans la documentation Cloudflare).
- CORS limité à l'origine GitHub Pages de Mathieu. **Ce n'est pas une protection** contre un script : c'est le jeton qui protège.
- Journaux : jamais d'en-tête `Authorization`, de jeton ou de clé ; messages d'erreur renvoyés à la page sans détail interne.
- Secrets : `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_DEVICE_ID`, `JETON_ACCES`, endpoint `https://openapi.tuyaeu.com`.
- Fuseau horaire : Europe/Paris, avec un test explicite autour d'un changement d'heure.

### Critères d'acceptation (`testeur-relecteur`)

- [ ] Tests unitaires de la signature Tuya (vecteurs de test) et du routage
- [ ] Appel direct en ligne de commande (pas depuis un navigateur) sans jeton ou avec mauvais jeton : 401
- [ ] Avec le bon jeton : seules les actions prévues sont possibles, toute autre route ou heure invalide est refusée
- [ ] Dépassement de la limite d'appels : 429
- [ ] Origine non autorisée : refusée par CORS (confort navigateur)
- [ ] Le Worker refuse d'agir sur tout autre appareil que `TUYA_DEVICE_ID` (identifiant jamais fourni par la page)
- [ ] Double authentification activée sur Cloudflare
- [ ] Procédure de révocation du jeton (`SECURITE.md`) testée une fois
- [ ] Aucun secret dans le dépôt ni dans les journaux
- [ ] Programmation réelle constatée dans l'appli Smart Life

---

## Phase 2c – Bouton dans la page

### Tâches (`dev-web`)

- Champ « Jeton d'accès » et « Adresse du service » dans les paramètres (stockés localement).
- Bouton « Programmer la prise » sous le résultat, actif seulement si le service est configuré.
- Retour visible : « Prise programmée : allumage 00:35 » (relu depuis le service) ou erreur claire + rappel de l'heure à régler à la main.
- Cas « aucune charge » : le bouton désactive la programmation de démarrage.
- Le préconditionnement et l'extinction de sécurité restent des programmations fixes dans Smart Life, jamais modifiées par le service.

### Critères d'acceptation

- [ ] Programmation réussie depuis le Pixel, constatée dans Smart Life
- [ ] Service coupé ou jeton faux : message d'erreur, mode manuel rappelé
- [ ] Une semaine d'usage réel sans intervention manuelle imprévue

---

## Phase 3 – Optionnelle

Application Android native (widget, rappel du soir), avec `testeur-relecteur` qui compare ses résultats à `tests/golden-cases.json`. À décider après la phase 2.
