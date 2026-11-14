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
- **Préconditionnement :** sur la batterie de la voiture, sans rallumage du câble le matin (décision du 2026-11-11, confirmée le 2026-11-14). Plus aucune programmation Smart Life ; le code n'en crée ni n'en modifie jamais.
- **Repli** si la plage du câble n'est pas accessible en écriture par l'API : compte à rebours ou minuteries de l'appareil.

### Test préalable, sans compte Tuya (Mathieu, 20 min, voiture branchée)

| # | Test | Si échec |
|---|---|---|
| T0a | Plage du câble de +5 à +10 min, programmation Smart Life « marche » à +20 min : la charge démarre à +5, s'arrête à +10, reprend à +20 | Reprise à +20 impossible : la plage bloque la programmation, passer au repli |
| T0b | ~~Même essai, box coupée~~ **Fusionné dans T4** le 2026-11-14 : sans programmation de préconditionnement, il ne restait que « la plage s'exécute box coupée » | — |

Tant que T0 n'est pas fait, tout le travail de la phase 2a repose sur l'hypothèse ci-dessus. T0 doit être passé avant le début de la phase 2b.

### Ce que fait Mathieu (guidé pas à pas par le chef de projet)

1. Compte sur la plateforme développeur Tuya (iot.tuya.com), projet cloud de type Smart Home, centre de données **Central Europe**.
2. Liaison au projet d'un **compte Smart Life dédié**, qui ne voit que le câble (partagé depuis le compte principal, fait le 2026-11-11). Le QR code est scanné depuis le compte dédié ; le compte principal n'est jamais relié au projet. Repli si l'appareil partagé n'est pas visible ou pas pilotable par l'API : déplacer le câble sur le compte dédié et le partager vers le compte principal.
3. Abonnement gratuit au service IoT Core (et à ce que la sonde réclame).
4. Double authentification activée sur le compte développeur Tuya.
5. Récupération de l'Access ID, de l'Access Secret et de l'identifiant du câble, à placer dans `tools/.env` (ignoré par git).

### Ce que fait `tuya-integrateur`

- Script `tools/tuya-probe.mjs` (Node, sans dépendance), qui charge lui-même `tools/.env` et n'agit que sur `TUYA_DEVICE_ID`. Actions séparées : obtenir un jeton, lire les fonctions, la spécification et l'état, **relever tous les points de données** (pour comparer avant et après un réglage fait dans l'appli), écrire le début de plage.
- Consigner dans `docs/tuya-findings.md` : codes de fonction, valeurs possibles, format du réglage de plage, résultats des essais, sources.

Les tests sont lancés par la session principale avec Mathieu, commande par commande.

### Reprise (état au 2026-11-14)

T1 à T3 passés le 2026-11-11 (voir `docs/tuya-findings.md`). Compte principal délié et Access Secret régénéré ; aucun identifiant utilisable sur le PC.

- [x] Câble réappairé sur le compte dédié (propriétaire), seul relié au projet
- [x] Nouveaux identifiants dans `tools/.env`, puis `node tools/tuya-probe.mjs isolement` refuse les 4 lectures (2026-11-14)
- [x] T5 validé par Mathieu (2026-11-14)
- [x] T6 supprimé : plus de programmation de préconditionnement (la partie API, une seule plage et réglages inchangés, était déjà réussie)
- [x] T7 fait (2026-11-14) : l'arrêt de charge de Smart Life n'est pas reproductible par un réglage lisible ; soirs sans charge = **plage courte** (voir le contrat ci-dessous). Reste à constater une nuit sans charge réelle avec la plage courte (`x_charge_history` le matin)
- [ ] T4 **reporté** (pas levé, T0b fusionné dedans) : à faire avant la mise en service de la phase 2b
- [ ] **Après T7 et la fin des essais sur le câble** : régénérer l'Access Secret Tuya, le poser seulement chez Cloudflare (`wrangler secret put TUYA_ACCESS_SECRET`), puis supprimer `tools/.env` et vider `worker/.dev.vars` (plus aucune clé Tuya sur le PC). **Régénéré et posé chez Cloudflare par Mathieu le 2026-11-15** (secrets du PC périmés) ; reste : supprimer `worker/.dev.vars`, puis `tools/.env` après L3–L4 (il porte la clé locale)
- [ ] **À chaque fin de séance** : un seul `git push` (avec résumé des changements de `site/`), puis `npx.cmd wrangler logout`
- [ ] Tests du pilotage local L1 à L4 (`tools/tuya-local-test.py`, détail dans `docs/tuya-findings.md`) : repli sans internet, et base d'une éventuelle appli (volet produit)

### Tests du point d'arrêt

| # | Test | Si échec |
|---|---|---|
| T1 | Le câble apparaît dans le projet et la sonde lit son état. La liste des appareils visibles ne contient **que le câble** (noms et catégories notés dans `docs/tuya-findings.md`) | Arrêt ; si un autre appareil apparaît : délier le compte immédiatement |
| T2 | Le réglage de plage est identifié : relevé des points de données, changement d'heure dans l'appli, nouveau relevé, comparaison. Son format est compris (heure, minutes, valeur encodée) | Arrêt, ou repli |
| T3 | Écrire le début de plage par l'API : la nouvelle heure apparaît dans l'écran du câble dans Smart Life, et la charge démarre à cette heure (essai à +5 min) | Arrêt, ou repli sur décision de Mathieu |
| T4 | La plage écrite par l'API s'exécute avec internet coupé côté box (essai de 10 min) | **Arrêt**, ou dérogation explicite à la règle n°1 consignée dans `docs/decisions.md` |
| T5 | Voiture branchée, charge bloquée depuis plus de 2 h : la charge démarre bien au début de plage | Arrêt : problème indépendant de l'API |
| ~~T6~~ | Supprimé le 2026-11-14 : plus de programmation de préconditionnement. La partie API (une seule plage, courant et fin inchangés après plusieurs écritures) a réussi le 2026-11-11 et reste un critère de la phase 2b | — |
| T7 | Soir « pas de charge nécessaire » : identifier comment **désactiver la charge**. **Fait le 2026-11-14** : le bouton « pause » de Smart Life n'est pas reproductible (commande ponctuelle, aucun réglage lisible ne change) ; l'écriture du début de plage par l'API sort le câble de la pause. Remplacé par la **plage courte** (une minute avant la fin de plage) | — |

### Décisions à prendre en fin de phase

- **Compte Smart Life :** compte dédié retenu dès le départ (voir étape 2 ci-dessus). Avant la phase 2b, l'Access Secret est régénéré et la nouvelle valeur ne va que dans les secrets Cloudflare.
- **Heure déjà passée** (décidé le 2026-11-14) : démarrage immédiat, le service écrit l'heure actuelle comme début de plage ; l'alerte OK le dit (« démarrage immédiat, l'heure calculée était passée »). Jamais de report silencieux au lendemain.
- **Soirs d'oubli** (décidé le 2026-11-14) : rien de spécial, la plage de la veille reste active et la voiture charge à la même heure.
- **Contrat du service** (décidé le 2026-11-14) :
  - `POST /api/programmer`, corps `{"allumage":"HH:MM"}` (début de plage, plage activée) ou `{"desactiver":true}` (révisé le 2026-11-14 après T7 : **plage courte**, début = fin de plage relue sur le câble moins une minute, plage activée ; aucune heure en dur, la fin de plage reste celle réglée dans Smart Life, c'est-à-dire la fin des heures creuses). `GET /api/etat` : lecture seule. Jeton obligatoire.
  - Succès, après relecture sur le câble : `{"ok":true,"debut":"HH:MM","fin":"HH:MM","plage_active":bool}` (plus `"immediat":true` si l'heure était passée, jamais pour `desactiver` ; plus `"courte":true` pour `desactiver`).
  - Échec : `{"ok":false,"erreur":"hors_ligne"|"jeton"|"tuya"|"delai"|"relecture_differente"}`, sans détail interne. Erreurs de requête : 400 (corps invalide), 401 (jeton), 429 (limite d'appels).

**Fin de phase :** rapport court du chef de projet (ce qui marche, ce qui ne marche pas, recommandation) et décision de Mathieu : continuer, adapter ou arrêter. `tools/.env` est supprimé du PC une fois la phase close.

---

## Phase 2b – Worker de programmation

**Objectif :** un service minimal qui reçoit l'heure calculée et règle le début de la plage de charge du câble.

**Prérequis :** T0 passé, décisions de fin de phase 2a prises.

### Tâches (`tuya-integrateur`)

- `worker/` : Cloudflare Worker (JavaScript, Web Crypto, aucune dépendance d'exécution).
- `POST /api/programmer` avec `{ "allumage": "HH:MM" }` ou `{ "desactiver": true }` : `allumage` écrit le début de la plage et l'active ; `desactiver` écrit une plage courte (début = fin relue − 1 min) et l'active. Réponse : ce qui a été réellement réglé, **relu sur l'appareil** après l'écriture.
- Le Worker n'écrit **que** le début et l'activation de la plage : jamais le courant, la fin de plage, un autre réglage du câble ou une programmation Smart Life.
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
- [x] Appel direct en ligne de commande (pas depuis un navigateur) sans jeton ou avec mauvais jeton : 401 (production, 2026-11-14)
- [ ] Avec le bon jeton : seules les actions prévues sont possibles, toute autre route ou heure invalide est refusée
- [ ] Après une programmation : une seule plage, courant et fin de plage inchangés
- [ ] La réponse n'annonce un succès que si la valeur relue sur le câble est celle demandée ; sinon erreur explicite
- [ ] Heure déjà passée : comportement conforme à la décision de fin de phase 2a
- [ ] Câble hors ligne ou Tuya en erreur (simulés) : erreur explicite, jamais de faux succès
- [ ] Dépassement de la limite d'appels : 429
- [ ] Origine non autorisée : refusée par CORS (confort navigateur)
- [ ] Le Worker refuse d'agir sur tout autre appareil que `TUYA_DEVICE_ID` (identifiant jamais fourni par la page)
- [x] Double authentification activée sur Cloudflare (Mathieu, 2026-11-14)
- [ ] Procédure de révocation du jeton (`SECURITE.md`) testée une fois
- [ ] Aucun secret dans le dépôt ni dans les journaux
- [x] Programmation réelle constatée dans l'écran du câble dans Smart Life (depuis le Pixel, 2026-11-14)
- [ ] Relecture sécurité du Worker faite une fois avec le modèle le plus capable, avant le déploiement

---

## Phase 2c – Bouton dans la page

### Tâches (`dev-web`)

- Champ « Jeton d'accès » et « Adresse du service » dans la vue Paramètres (stockés localement).
- Bouton « Programmer la charge » sous le résultat, avec l'heure en petit dessous (« démarrage 00:35 ») ; « Pas de charge ce soir » (plage réduite à 1 min) les soirs sans charge. Actif seulement si le service est configuré.
- **Alerte de confirmation** après chaque appui, fondée sur la relecture Tuya renvoyée par le service :
  - **OK** (vert) : « Charge programmée : démarrage 00:35 », heure relue sur le câble ; ou « Charge désactivée pour cette nuit ».
  - **KO** (rouge, bien visible) : cause en clair (service injoignable, jeton refusé, câble hors ligne, valeur relue différente, délai dépassé), puis l'heure à régler à la main dans Smart Life et un lien vers la vue Aide.
  - Réponse incertaine (délai dépassé, relecture impossible) : traitée comme **KO**, avec « vérifiez dans Smart Life ». Jamais d'alerte OK sans relecture conforme.
- Cas « aucune charge » : le bouton règle la plage courte (une minute avant la fin des heures creuses) ; alerte OK « Pas de charge cette nuit, inutile de brancher ». Si la fin de plage relue sur le câble diffère de la fin des heures creuses des Paramètres, avertissement visible (dans tous les cas, pas seulement ce soir-là).
- Préconditionnement sur la batterie : aucune programmation Smart Life, rien à régler par le service.
- Politique CSP stricte dans la page : `connect-src` limité à la page et à l'adresse du service.

### Critères d'acceptation

- [x] Programmation réussie depuis le Pixel, constatée dans l'écran du câble dans Smart Life (2026-11-14)
- [ ] Service coupé, jeton faux, câble hors ligne : alerte KO avec message distinct, mode manuel rappelé, aide accessible hors ligne
- [ ] Alerte OK affichée seulement avec une valeur relue conforme (vérifié en simulant une relecture différente)
- [ ] Aucun autre site n'est publié sur `youkier.github.io` (le stockage local, donc le jeton, y serait partagé), ou risque accepté dans `docs/decisions.md`
- [ ] Une semaine d'usage réel sans intervention manuelle imprévue

---

## Phase 3 – Volet produit (après la phase 2c)

Options, priorités, étapes et critères d'arrêt dans `docs/business-cases.md`. Les règles de `CLAUDE.md` s'appliquent aussi à ce volet.

- [x] Demandes envoyées à Tuya (ticket) et à Stellantis (formulaire Mobilisights), 2026-11-14 ; relance vers le 5 décembre
- [ ] Page gratuite avec profils de voiture, liste d'attente et liens d'affiliation (options A et G)
- [ ] Vidéo de démonstration et proposition au fabricant du câble (option D)
- [ ] Décision vers le 7 décembre : panneau pour le fabricant (D), appli Android du câble (B), affiliation et appli qui complète MyDS (G, F), ou arrêt
- [ ] Toute application Android : `testeur-relecteur` compare ses résultats à `tests/golden-cases.json`
