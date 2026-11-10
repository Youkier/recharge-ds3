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

## Phase 1bis – Vues Paramètres et Aide

**Objectif :** alléger l'écran principal avant d'y ajouter le bouton, et préparer la place des réglages du service. Se fait en parallèle de la phase 2a, qui attend les comptes de Mathieu.

### Tâches (`dev-web`)

- Trois vues dans le même `index.html`, navigation par menu et par ancre : calcul (accueil), `#parametres`, `#aide` (réglage manuel dans Smart Life). Un seul fichier HTML en cache.
- Corriger les défauts de saisie relevés en phase 1 (champ vide → NaN, plan périmé copié, cible non atteinte sans message, prix vide = 0), sans toucher aux cas de référence.
- Incrémenter la version de `sw.js`.

### Critères d'acceptation

- [ ] `node --test "tests/**/*.test.mjs"` passe, cas de référence inchangés
- [ ] Sur le Pixel : le menu ouvre Paramètres et Aide, le bouton retour d'Android ramène à l'accueil
- [ ] Mode avion : les trois vues s'ouvrent
- [ ] Paramètres conservés après la mise à jour (aucune perte du stockage local)
- [ ] La nouvelle version apparaît sur le téléphone après au plus deux ouvertures (clôt le critère resté ouvert en phase 1)

---

## Phase 2a – Point d'arrêt Tuya (décide de la suite)

**Objectif :** prouver que le câble est pilotable par l'API avant d'écrire le moindre service.

### Architecture retenue (hypothèse du 2026-11-10, non encore testée)

Le câble (borne portable « dé » 3,7 kW, Wi-Fi) pilote lui-même la charge et possède une fonction de charge différée à **une seule plage**.

- **Recharge de nuit :** plage de charge du câble. Le service n'écrit que le **début** de cette plage ; la fin reste la fin des heures creuses.
- **Préconditionnement :** programmation Smart Life fixe (marche 30 min avant le départ), réglée une fois par Mathieu, jamais touchée par le code. C'est un confort : en cas d'échec, la voiture préconditionne sur sa batterie.
- **Repli** si la plage du câble n'est pas accessible en écriture par l'API : compte à rebours ou minuteries de l'appareil.

### Test préalable, sans compte Tuya (Mathieu, 20 min, voiture branchée)

| # | Test | Si échec |
|---|---|---|
| T0a | Plage du câble de +5 à +10 min, programmation Smart Life « marche » à +20 min : la charge démarre à +5, s'arrête à +10, reprend à +20 | Reprise à +20 impossible : la plage bloque la programmation, passer au repli |
| T0b | Même essai, box coupée juste après le réglage | Charge de nuit absente : **Arrêt**. Seule la reprise à +20 échoue : dérogation à la règle n°1 limitée au préconditionnement, décision de Mathieu |

Tant que T0 n'est pas fait, tout le travail de la phase 2a repose sur l'hypothèse ci-dessus. T0 doit être passé avant le début de la phase 2b.

### Ce que fait Mathieu (guidé pas à pas par le chef de projet)

1. Compte sur la plateforme développeur Tuya (iot.tuya.com), projet cloud de type Smart Home, centre de données **Central Europe**.
2. Liaison du compte Smart Life au projet (scan d'un QR code depuis l'appli Smart Life).
3. Abonnement gratuit au service IoT Core (et à ce que la sonde réclame).
4. Double authentification activée sur le compte développeur Tuya.
5. Récupération de l'Access ID, de l'Access Secret et de l'identifiant du câble, à placer dans `tools/.env` (ignoré par git).

### Ce que fait `tuya-integrateur`

- Script `tools/tuya-probe.mjs` (Node, sans dépendance), qui charge lui-même `tools/.env` et n'agit que sur `TUYA_DEVICE_ID`. Actions séparées : obtenir un jeton, lire les fonctions, la spécification et l'état, **relever tous les points de données** (pour comparer avant et après un réglage fait dans l'appli), écrire le début de plage.
- Consigner dans `docs/tuya-findings.md` : codes de fonction, valeurs possibles, format du réglage de plage, résultats des essais, sources.

Les tests sont lancés par la session principale avec Mathieu, commande par commande.

### Tests du point d'arrêt

| # | Test | Si échec |
|---|---|---|
| T1 | Le câble apparaît dans le projet et la sonde lit son état. La liste des autres appareils visibles est notée dans `docs/tuya-findings.md` (noms et catégories seulement) | Arrêt |
| T2 | Le réglage de plage est identifié : relevé des points de données, changement d'heure dans l'appli, nouveau relevé, comparaison. Son format est compris (heure, minutes, valeur encodée) | Arrêt, ou repli |
| T3 | Écrire le début de plage par l'API : la nouvelle heure apparaît dans l'écran du câble dans Smart Life, et la charge démarre à cette heure (essai à +5 min) | Arrêt, ou repli sur décision de Mathieu |
| T4 | La plage écrite par l'API s'exécute avec internet coupé côté box (essai de 10 min) | **Arrêt**, ou dérogation explicite à la règle n°1 consignée dans `docs/decisions.md` |
| T5 | Voiture branchée, charge bloquée depuis plus de 2 h : la charge démarre bien au début de plage | Arrêt : problème indépendant de l'API |
| T6 | Non-régression : après deux écritures le même soir, une seule plage existe ; le courant, la fin de plage et la programmation de préconditionnement sont inchangés | Arrêt |

### Décisions à prendre en fin de phase

- **Compte Smart Life :** si T1 montre une caméra, une serrure ou une alarme, passer à un compte dédié qui ne voit que le câble avant la phase 2b.
- **Heure déjà passée** (bouton pressé après l'heure de démarrage calculée) : démarrer tout de suite, ou refuser avec un message. Jamais de report silencieux au lendemain.
- **Soirs d'oubli :** la plage reste-t-elle active d'un jour sur l'autre (la voiture charge à l'heure de la veille) ou faut-il un autre comportement ?
- **Contrat du service** (`POST /api/programmer`, `GET /api/etat`) figé, pour que les phases 2b et 2c avancent sans se bloquer.

**Fin de phase :** rapport court du chef de projet (ce qui marche, ce qui ne marche pas, recommandation) et décision de Mathieu : continuer, adapter ou arrêter. `tools/.env` est supprimé du PC une fois la phase close.

---

## Phase 2b – Worker de programmation

**Objectif :** un service minimal qui reçoit l'heure calculée et règle le début de la plage de charge du câble.

**Prérequis :** T0 passé, décisions de fin de phase 2a prises.

### Tâches (`tuya-integrateur`)

- `worker/` : Cloudflare Worker (JavaScript, Web Crypto, aucune dépendance d'exécution).
- `POST /api/programmer` avec `{ "allumage": "HH:MM" }` ou `{ "desactiver": true }` : écrit le début de la plage de charge (mécanisme validé en phase 2a). Réponse : ce qui a été réellement réglé, relu sur l'appareil.
- Le Worker n'écrit **que** le début de plage : jamais le courant, la fin de plage, un autre réglage du câble ou une programmation Smart Life.
- Heure déjà passée : comportement fixé en fin de phase 2a, avec un test.
- Erreurs Tuya (câble hors ligne, accès à l'API expiré, délai dépassé de 10 s) : réponse d'erreur explicite et distincte pour chaque cas, sans détail interne.
- `GET /api/etat` : état du câble et plage en place.
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
- [ ] Après une programmation : courant, fin de plage et programmation de préconditionnement inchangés
- [ ] Heure déjà passée : comportement conforme à la décision de fin de phase 2a
- [ ] Câble hors ligne ou Tuya en erreur (simulés) : erreur explicite, jamais de faux succès
- [ ] Dépassement de la limite d'appels : 429
- [ ] Origine non autorisée : refusée par CORS (confort navigateur)
- [ ] Le Worker refuse d'agir sur tout autre appareil que `TUYA_DEVICE_ID` (identifiant jamais fourni par la page)
- [ ] Double authentification activée sur Cloudflare
- [ ] Procédure de révocation du jeton (`SECURITE.md`) testée une fois
- [ ] Aucun secret dans le dépôt ni dans les journaux
- [ ] Programmation réelle constatée dans l'écran du câble dans Smart Life
- [ ] Relecture sécurité du Worker faite une fois avec le modèle le plus capable, avant le déploiement

---

## Phase 2c – Bouton dans la page

### Tâches (`dev-web`)

- Champ « Jeton d'accès » et « Adresse du service » dans la vue Paramètres (stockés localement).
- Bouton « Programmer la charge » sous le résultat, actif seulement si le service est configuré.
- Retour visible : « Charge programmée : démarrage 00:35 » (relu depuis le service) ou erreur claire + rappel de l'heure à régler à la main + lien vers la vue Aide.
- Cas « aucune charge » : le bouton désactive le démarrage programmé.
- Le préconditionnement reste une programmation fixe dans Smart Life, jamais modifiée par le service.
- Politique CSP stricte dans la page : `connect-src` limité à la page et à l'adresse du service.

### Critères d'acceptation

- [ ] Programmation réussie depuis le Pixel, constatée dans l'écran du câble dans Smart Life
- [ ] Service coupé, jeton faux, câble hors ligne : message d'erreur distinct, mode manuel rappelé, aide accessible hors ligne
- [ ] Aucun autre site n'est publié sur `youkier.github.io` (le stockage local, donc le jeton, y serait partagé), ou risque accepté dans `docs/decisions.md`
- [ ] Une semaine d'usage réel sans intervention manuelle imprévue

---

## Phase 3 – Optionnelle

Application Android native (widget, rappel du soir), avec `testeur-relecteur` qui compare ses résultats à `tests/golden-cases.json`. À décider après la phase 2.
