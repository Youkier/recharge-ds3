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
- [x] Une nouvelle version publiée apparaît sur le téléphone après au plus deux ouvertures (Pixel, 2026-11-15)

---

## Phase 1bis – Vues Paramètres et Aide

**Objectif :** alléger l'écran principal avant d'y ajouter le bouton, et préparer la place des réglages du service. Se fait en parallèle de la phase 2a, qui attend les comptes de Mathieu.

### Tâches (`dev-web`)

- Trois vues dans le même `index.html`, navigation par menu et par ancre : calcul (accueil), `#parametres`, `#aide` (réglage manuel dans Smart Life). Un seul fichier HTML en cache.
- Corriger les défauts de saisie relevés en phase 1 (champ vide → NaN, plan périmé copié, cible non atteinte sans message, prix vide = 0), sans toucher aux cas de référence.
- Incrémenter la version de `sw.js`.

### Critères d'acceptation

- [x] `node --test "tests/**/*.test.mjs"` passe, cas de référence inchangés
- [x] Sur le Pixel : le menu ouvre Paramètres et Aide, le bouton retour d'Android ramène à l'accueil (2026-11-15)
- [x] Mode avion : les trois vues s'ouvrent (2026-11-15)
- [x] Paramètres conservés après la mise à jour (aucune perte du stockage local) (2026-11-15)
- [x] La nouvelle version apparaît sur le téléphone après au plus deux ouvertures (2026-11-15 ; clôt le critère resté ouvert en phase 1)

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
- [ ] **Après T7 et la fin des essais sur le câble** : régénérer l'Access Secret Tuya, le poser seulement chez Cloudflare (`wrangler secret put TUYA_ACCESS_SECRET`), puis supprimer `tools/.env` et vider `worker/.dev.vars` (plus aucune clé Tuya sur le PC). **Régénéré et posé chez Cloudflare par Mathieu le 2026-11-15** (secrets du PC périmés) ; `worker/.dev.vars` vidé de ses valeurs (noms seuls, constaté par Mathieu le 2026-11-15) ; reste : supprimer `tools/.env` après L4 (il porte la clé locale)
- [ ] **À chaque fin de séance** : un seul `git push` (avec résumé des changements de `site/`), puis `npx.cmd wrangler logout`
- [ ] Tests du pilotage local L1 à L4 (`tools/tuya-local-test.py`, détail dans `docs/tuya-findings.md`) : repli sans internet, et base d'une éventuelle appli (volet produit). **L1, L2, L3 réussis (2026-11-15/16) ; L4 à faire plus tard** (voiture branchée, méthode notée dans `docs/tuya-findings.md`), puis supprimer `tools/.env`
- [ ] **Essai gratuit IoT Core de Tuya : échéance le 2026-12-11** (constaté par Mathieu le 2026-11-15 ; sans lui, le Worker ne joint plus Tuya). **Prolongation demandée par Mathieu le 2026-11-15**, réponse à vérifier dans la console. Demander la prolongation de 6 mois vers le 1er décembre (plateforme Tuya → Cloud → Cloud Services → IoT Core → Extend Trial Period), puis à chaque échéance. La sortie durable de cette dépendance est le pilotage local (phase 3b)
- [x] **Clé locale du câble copiée dans le gestionnaire de mots de passe de Mathieu** (fait le 2026-11-17) avant toute suppression de `tools/.env` : elle ne se relit que par le cloud Tuya, donc plus du tout si l'essai expire. `tools/.env` n'est supprimé qu'après L4 **et** après le lot C2 de la phase 3b
- [x] Réseau de la maison : routeur TP-Link AX55 passé en mode point d'accès (en cours le 2026-11-15), pour que le câble soit joignable depuis les deux Wi-Fi ; adresse du câble réservée dans la box ; puis `scan` et `etat` depuis le Wi-Fi principal. **2026-11-15 : `scan` depuis le Wi-Fi principal ne trouve pas le câble** : le profil Windows du Wi-Fi « Bbox-ext 2 » est « Public », le pare-feu bloque les annonces UDP. Câble rebranché : port 6668 ouvert à **192.168.1.48** ; **`etat` réussi** avec `TUYA_LOCAL_IP=192.168.1.48` et `TUYA_LOCAL_VERSION=3.5` (11 points lus, plage `{"m":2,"dt":0,"ss":"23:00","se":"06:00"}`). **Pas de réservation dans la Bbox** (décision de Mathieu du 2026-11-17) : recherche automatique du câble en secours, lot C2

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

- [x] Tests unitaires de la signature Tuya (vecteurs de test) et du routage (tests automatiques, 2026-11-15)
- [x] Appel direct en ligne de commande (pas depuis un navigateur) sans jeton ou avec mauvais jeton : 401 (production, 2026-11-14)
- [x] Avec le bon jeton : seules les actions prévues sont possibles, toute autre route ou heure invalide est refusée (tests automatiques, 2026-11-15)
- [x] Après une programmation : une seule plage, courant et fin de plage inchangés (tests automatiques, 2026-11-15)
- [x] La réponse n'annonce un succès que si la valeur relue sur le câble est celle demandée ; sinon erreur explicite (tests automatiques, 2026-11-15)
- [x] Heure déjà passée : comportement conforme à la décision de fin de phase 2a (tests automatiques, 2026-11-15)
- [x] Câble hors ligne ou Tuya en erreur (simulés) : erreur explicite, jamais de faux succès (tests automatiques, 2026-11-15)
- [x] Dépassement de la limite d'appels : 429 (tests automatiques avec binding simulé, 2026-11-15 ; limite réelle de 10/min, voir la relecture sécurité)
- [x] Origine non autorisée : refusée par CORS (confort navigateur) (tests automatiques, 2026-11-15)
- [x] Le Worker refuse d'agir sur tout autre appareil que `TUYA_DEVICE_ID` (identifiant jamais fourni par la page) (tests automatiques, 2026-11-15)
- [x] Double authentification activée sur Cloudflare (Mathieu, 2026-11-14)
- [ ] Procédure de révocation du jeton (`SECURITE.md`) testée une fois
- [x] Aucun secret dans le dépôt ni dans les journaux (tests automatiques, 2026-11-15)
- [x] Programmation réelle constatée dans l'écran du câble dans Smart Life (depuis le Pixel, 2026-11-14)
- [x] Relecture sécurité du Worker faite une fois avec le modèle le plus capable (2026-11-15, après le déploiement) : rien de critique ni d'important ; deux points mineurs corrigés (30 appels par heure, échéance globale de 20 s)

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
- [x] Service coupé, jeton faux, câble hors ligne : alerte KO avec message distinct, mode manuel rappelé, aide accessible hors ligne (tests automatiques, 2026-11-15)
- [x] Alerte OK affichée seulement avec une valeur relue conforme (vérifié en simulant une relecture différente) (tests automatiques, 2026-11-15)
- [x] Aucun autre site n'est publié sur `youkier.github.io` (le stockage local, donc le jeton, y serait partagé), ou risque accepté dans `docs/decisions.md` (constaté par Mathieu, 2026-11-15)
- [ ] Une semaine d'usage réel sans intervention manuelle imprévue

---

## Phase 3 – Volet produit

Options, priorités et critères d'arrêt dans `docs/business-cases.md`. Les règles de `CLAUDE.md` s'appliquent aussi à ce volet.

Décision de Mathieu du 2026-11-15 : **deux pistes avancent en parallèle**, sans attendre la fin de la phase 2c, tant qu'elles ne touchent pas à ce qui sert l'usage personnel.

| Piste | Phase | Cahier des charges | But |
|---|---|---|---|
| Site public | 3a | `docs/cahier-des-charges-site-public.md` | Avoir du passage, mesurer la demande, préparer la monétisation |
| Coque Android | 3b | `docs/cahier-des-charges-coque-android.md` | Pilotage local depuis le Pixel : sécurise l'usage personnel, prototype de l'option B |

### Ordre de priorité à chaque séance

1. **L'usage personnel d'abord** : ce qui reste ouvert dans les phases 2a à 2c (révocation du jeton à tester, T4, L4, semaine d'usage réel, essai IoT Core prolongé de 6 mois le 2026-11-21 (fin vers mi-2027, date exacte à relever dans la console Tuya, puis à renouveler avant), clé locale mise à l'abri).
2. Le prochain lot autonome de chaque piste (3a et 3b), lancés en parallèle.
3. Ce qui attend Mathieu, pour les deux pistes, **en une seule liste** en début et en fin de séance.

### Règles du travail en parallèle

- **Piste site** : écrit seulement dans `public/`, `tools/build-public.mjs` et `tests/public-*.test.mjs`. Ne modifie jamais `site/`, `worker/`, `local/` ni `android/`.
- **Piste coque** : écrit seulement dans `local/`, `android/`, `tools/tuya-local.mjs`, `tools/gen-vecteurs-tuya-local.py` et `tests/tuya-local*`. Ne modifie `site/` qu'au lot C4.
- **Fichiers communs** (`PLAN.md`, `CLAUDE.md`, `.gitignore`, `docs/decisions-produit.md`, `tests/README.md`) : modifiés par la session principale seulement, jamais par un sous-agent.
- Sous-agents : `dev-web` pour la piste site, `tuya-integrateur` pour les lots C1 et C2. Les lots C3 et C4 (Android) sont menés par la session principale. `ergonome`, `testeur-inconnu`, `tech-lead` et `business-dev` sont appelés sur leurs déclencheurs (`CLAUDE.md`, « Organisation de l'équipe ») ; ils ne modifient aucun fichier (`business-dev` rend le contenu de `docs/kpi.md`, la session principale l'écrit).

### Équipe élargie (2026-11-17)

- [x] Agents `ergonome`, `testeur-inconnu`, `tech-lead`, `business-dev` créés ; `tools/capture.mjs` pour regarder les pages (Edge sans fenêtre, profil jetable ; 500 px au minimum, constaté : en dessous, Edge met la page en page à 500 px)
- [x] `ergonome` et `testeur-inconnu` sur le lot S1 (accueil, première visite)
- [ ] (proposition écrite le 2026-11-18, à valider par Mathieu) `business-dev` : `docs/kpi.md` et structure du tableau de bord privé ; résoudre « au-delà de 300 utilisateurs réguliers » (`docs/business-cases.md`), non mesurable sans identifiant alors que le site n'en pose aucun
- [ ] Tableau de bord privé publié sur claude.ai (session principale), valeurs saisies à chaque relevé
- [ ] `tech-lead` : revue d'ensemble avant le lot C3 (rendement recopié dans `site/app.js` et `public/app/app-public.js`, partage entre `site/` et `public/`, forme du pont Android)
- [ ] Trois vrais visiteurs, proches de Mathieu et sans explication préalable, avant le lot S6 : le `testeur-inconnu` ne les remplace pas
- [ ] Vue téléphone à 380 px dans les captures : émulation mobile du navigateur, à faire si les revues sur le Pixel ne suffisent pas
- Un commit par lot et par piste. Tous les tests passent avant chaque commit. Relecture par `testeur-relecteur` pour chaque lot qui touche du code. Un seul `git push` en fin de séance, comme avant.
- Aucune commande qui touche le câble, le téléphone ou une publication sans l'accord de Mathieu, une par une (règle n°11).
- Rien d'inventé : un fait sur Tuya, Android, Cloudflare, un tarif ou une voiture est lu à sa source et noté avec elle. Si la source est hors des domaines autorisés, la demander à Mathieu.

### Préparation (une fois, avec l'accord de Mathieu)

- [x] Exceptions aux règles n°7 (projet Gradle dans `android/`) et n°9 (pont TCP limité au port 6668 et aux adresses privées) validées et consignées dans `docs/decisions-produit.md` (2026-11-15) ; reportées dans les règles n°7 et n°9 de `CLAUDE.md` le 2026-11-15
- [x] `.gitignore` : `dist/`, `android/**/build/`, `android/.gradle/`, `android/local.properties`, `*.jks`, `*.keystore`
- [x] `tools/hooks/pre-commit` : refuser `*.jks` et `*.keystore` (vérifié sur un dépôt jetable le 2026-11-15)
- [x] `.claude/settings.json` : sans demande, `node tools/build-public.mjs*`, le serveur local de `dist/public` (`python -m http.server --bind 127.0.0.1 -d dist/public*`) et la lecture de `developer.android.com` ; avec demande, `node tools/tuya-local.mjs*`, `python tools/gen-vecteurs-tuya-local.py*`, les commandes Gradle et `adb` ; en plus, lecture de `*.jks` et `*.keystore` interdite (2026-11-15)
- [x] `CLAUDE.md` : objectif 3 (les pistes 3a et 3b avancent en parallèle de la phase 2c), structure du dépôt (`public/`, `local/`, `android/`, `dist/`), `tools/tuya-local.mjs` ajouté aux scripts qui chargent `tools/.env` (règle n°3), commandes des deux pistes
- [ ] `SECURITE.md` : compléments du § 10 du cahier des charges de la coque, avant le lot C4

---

## Phase 3a – Site public

Détail : `docs/cahier-des-charges-site-public.md`. Promesse : « La limite de charge à 80 % pour les voitures qui n'en ont pas, en heures creuses. » Un moteur partagé avec la page personnelle (`calc.js`, liste des véhicules), une interface à part dans `public/`.

### Lots (`dev-web`)

| Lot | Contenu | Autonome ? |
|---|---|---|
| S1 | `tools/build-public.mjs`, gabarit de base, accueil avec calcul et première visite en trois questions, tests | Oui |
| S2 | « Comment régler », `public/donnees/offres.json`, bouton de liste d'attente, lien de partage | Oui |
| S3 | Guides, pages financement, confidentialité et mentions légales (brouillons), plan du site, balises de partage | Oui, textes à relire par Mathieu |
| S4 | Pages par modèle : gabarit et contrôles ; aucune page publiée sans source lue | Oui pour le gabarit ; les entrées attendent leurs sources |
| S5 | Mise en ligne provisoire, non indexable | Non : hébergement à valider |
| S6 | Nom de domaine, site indexable, mesure d'audience, formulaire, messages sur les forums | Non : Mathieu |

### Ce qu'on attend de Mathieu

Nom du site et domaine ; accord sur l'hébergement ; création du formulaire de liste d'attente ; identité publiée dans les mentions légales ; relecture des textes sur le Pixel ; plus tard, Amazon Partenaires, bouton de don, messages sur les forums. Rien de cela ne bloque les lots S1 à S4.

### Critères d'acceptation

Vérifiés par les tests automatiques :

- [x] `node tools/build-public.mjs` construit `dist/public/` ; deux constructions de suite donnent les mêmes fichiers
- [x] (état de l'arbre de travail, test `git status`) La piste n'a modifié aucun fichier de `site/` ; `calc.js`, `vehicules.js` et `vehicules.json` de `dist/public/` sont identiques à ceux de `site/`
- [x] Les cas de `tests/golden-cases.json` sont reproduits par le `calc.js` copié dans `dist/public/`
- [x] Chaque page a un seul `<h1>`, un titre et une description uniques, un lien canonique et les balises de partage ; tous les liens internes aboutissent ; le plan du site liste toutes les pages
- [x] `dist/public/` ne contient ni adresse `workers.dev`, ni champ de jeton, ni mention de MyDS ; sa CSP n'autorise aucune connexion hors du site (et du domaine de mesure s'il y en a un)
- [x] Aucune ressource chargée depuis un autre site (scripts, styles, images, polices)
- [x] Lien de partage : les réglages font l'aller-retour sans perte, la batterie du soir n'y figure jamais, les paramètres invalides sont ignorés
- [x] Les quatre statuts du calcul (`ok`, `short`, `none`, `err`) affichent chacun leur message
- [x] Tout lien rémunéré porte `rel="sponsored nofollow noopener"` et la mention « lien rémunéré » ; le bouton de liste d'attente est absent tant que son adresse est vide
- [ ] Le script refuse une page de modèle sans source ou absente de `vehicules.json`
- [x] Sans `PUBLIC_INDEXABLE=1`, toutes les pages portent `noindex`

À vérifier par Mathieu :

- [ ] Sur le Pixel, à 380 px, thèmes clair et sombre : première visite en moins d'une minute, résultat lisible
- [ ] Textes de l'accueil, des guides et de la page financement relus
- [ ] Mise en ligne provisoire ouverte sur le Pixel et sur un iPhone
- [ ] Nom, domaine, mentions légales et formulaire de liste d'attente en place
- [ ] Outil de mesure d'audience choisi après lecture de la position de la CNIL ; les clics vers la liste d'attente et vers le câble sont comptés
- [ ] Site indexable, plan du site déclaré, aperçu de partage correct dans un message
- [ ] Dix pages de modèles au moins, chacune avec sa source

---

## Phase 3b – Coque Android, pilotage local

Détail : `docs/cahier-des-charges-coque-android.md`. Le protocole local Tuya 3.5 est écrit une fois en JavaScript (`local/tuya-local.js`), vérifié depuis le PC avec Node, puis embarqué dans une coque Android minimale (une WebView et un pont TCP). Mêmes garanties et mêmes réponses que le Worker.

### Lots et points d'arrêt

| Lot | Contenu | Qui | Point d'arrêt |
|---|---|---|---|
| C1 | Module `local/tuya-local.js`, transport Node, vecteurs de test produits avec tinytuya et une clé factice, faux câble simulé | `tuya-integrateur`, seul | Primitive absente de Web Crypto : arrêt, on en parle |
| C2 | Essai réel depuis le PC : lecture, écriture simulée, puis écriture réelle à +5 min, voiture branchée | Session principale, commandes validées une par une | Lecture ou écriture refusée : arrêt |
| C3 | Coque minimale et page d'essai « Lire l'état », construite et essayée sur émulateurs par GitHub Actions | Session principale ; Mathieu : installation depuis un lien, saisie de la clé, essai final sur Pixel 9 et Pixel 10 | **Essai décisif.** Échec : arrêt, on en parle |
| C4 | Mode « Local » dans la page, clé chiffrée sur le téléphone, alertes, signature stable de l'APK | Session principale ; après la semaine d'usage réel de la phase 2c, ou accord de Mathieu | |
| C5 | Deux semaines d'usage réel en mode Local ; L4 et T4 refaits depuis le téléphone, internet coupé | Mathieu | Décision : le Worker reste-t-il en secours ? |

### Ce qu'on attend de Mathieu

Avant C2 : clé locale à l'abri, câble joignable depuis le PC. Avant C3 : rien (construction et premiers essais sur GitHub Actions, décision du 2026-11-19) ; à la fin de C3 : ranger la copie de secours de la clé de signature, installer depuis le lien sur le Pixel 9 et le Pixel 10, essai final. Pendant C2, C3 et C5 : validation des commandes, saisie de la clé sur le téléphone, constats sur la voiture.

### Critères d'acceptation

Lot C1 (tests automatiques) :

- [x] Les trames produites et relues par le module sont celles des vecteurs de tinytuya (négociation, lecture, écriture)
- [x] Faux câble : clé fausse, délai dépassé, format inattendu (rien n'est écrit), relecture différente, autre point modifié, heure déjà passée, plage courte, trame coupée : chaque cas donne la réponse prévue, jamais de faux succès
- [x] Un test échoue si le module peut écrire autre chose que `ss` et `m` du dp 151
- [x] Aucune clé ni identifiant réel dans le dépôt ; la clé n'apparaît dans aucun message d'erreur (messages et vecteurs par les tests ; le dépôt par le contrôle avant commit)
- [x] Chaque élément du protocole repris de tinytuya est noté dans `docs/tuya-findings.md` avec sa source

Lot C2, recherche automatique (tests automatiques, avant l'essai sur le câble) :

- [x] Adresse connue muette : recherche limitée au réseau /24 de cette adresse (IPv4 privée, port 6668), câble confirmé seulement par la négociation de sa clé ; aucune lecture ni écriture sur un autre appareil
- [x] Nouvelle adresse affichée ; deux appareils qui acceptent la clé, ou aucun : échec clair (`hors_ligne`), jamais de choix au hasard
- [x] Recherche bornée : parallélisme limité, délai court par adresse, échéance globale respectée ; la clé n'apparaît dans aucun message

Lot C2 (sur le câble) :

- [x] Recherche automatique : câble retrouvé sans adresse de départ (2026-11-17, sur le /24 du PC, « Câble trouvé à 192.168.1.48 », adresse enregistrée puis relue sans recherche) . Changement d'adresse simulé le 2026-11-18 (adresse mémorisée remplacée par 192.168.1.250, inoccupée) : câble retrouvé en 16 s, adresse corrigée, lecture suivante en 0,45 s
- [x] `etat` lit la même plage que Smart Life et que `tools/tuya-local-test.py` (2026-11-17 : 00:20–06:00, programmée le soir même par la page)
- [x] `ecrire-debut HH:MM` sans `--confirmer` n'envoie rien (2026-11-17, simulation 00:25)
- [x] Écriture réelle relue conforme, heure visible dans Smart Life, charge démarrée à l'heure (Mathieu) : **démarrage à 00:20 et batterie vers 80 % constatés par Mathieu le 2026-11-18** ; **écrite et relue conforme le 2026-11-17 à 23 h (00:25–06:00, aucun autre point modifié), puis 00:20 remise et relue conforme** ; restent l'affichage dans Smart Life et le démarrage à 00:20 (Mathieu)

Lot C3 (sur le Pixel) :

**État au 2026-11-19 au soir** : C3.1 à C3.5 faits (construction, émulateurs verts, corrections de l'ergonome, signature, préversion publiée) ; copie de secours de la clé de signature rangée par Mathieu, dossier local supprimé. **Reste C3.6** : installation depuis le lien et essai sur le vrai câble, Pixel 9 et Pixel 10 (Mathieu).

Construit et essayé sur GitHub Actions (décision du 2026-11-19) ; sous-étapes C3.1 (PC : liste blanche, faux câble TCP, page d'essai) → C3.2 (Gradle, construction) → C3.3 (émulateur, captures, ergonome) → C3.4 (pont et scénarios, relecture) → C3.5 (signature, préversion) → C3.6 (Mathieu).

- [x] APK construit par GitHub Actions à partir d'un commit de `main`, signé par la clé stable ; empreinte du certificat publiée avec le lien (2026-11-19, préversion `coque-v0.1`, commit cd74f88, empreinte 2b2a896b…0512033)
- [x] Liste des fichiers embarqués égale à la liste blanche (test Node sur le PC, et `unzip` en CI)
- [x] Sur émulateurs API 35 et 36, en clair et en sombre : la page d'essai lit le faux câble, le retrouve sans adresse et après une adresse muette, affiche `cle` avec une clé fausse ; captures relues par l'ergonome
- [x] Le pont refuse tout port autre que 6668 et toute adresse non privée (JUnit, et scénario sur l'émulateur)
- [ ] La version n+1 s'installe par-dessus la version n sans désinstaller (réinstallation de la même version vérifiée sur émulateur ; vraie mise à jour à la prochaine version, versionCode à faire varier)
- [x] `targetSdk` vaut 36, sans `ACCESS_LOCAL_NETWORK` (remplace le critère « permission », décision du 2026-11-18)
- [ ] Sur le Pixel 9 et le Pixel 10, installé depuis le lien : la page d'essai lit l'état du vrai câble depuis le Wi-Fi de la maison, adresse retrouvée sans saisie (Mathieu). **Pixel 9 : réussi le 2026-11-20 avec la v0.2** (la v0.1 échouait en « occupe » : lectures parallèles face aux autres appareils Tuya, corrigé par cef0d6b et abd05ce). Reste le Pixel 10

Lot C4 :

- [x] Sans le pont (navigateur, GitHub Pages), la page se comporte comme avant (test) ; cas de référence inchangés
- [x] Les fichiers de la page embarqués dans l'APK sont identiques à ceux de `site/`
- [x] Mode Local : mêmes alertes OK et KO que le service, heure à régler à la main rappelée à chaque échec, pas de bascule silencieuse vers le service
- [x] Clé chiffrée sur le téléphone, hors sauvegarde, jamais réaffichée, effaçable ; une mise à jour de l'APK ne la fait pas ressaisir
- [ ] `SECURITE.md` complété ; relecture sécurité du module et du pont faite une fois avec le modèle le plus capable

Lots E1 à E4 (décisions du 2026-11-21 : le protocole local n'a qu'une implémentation dans l'appli, en Kotlin ; l'attente est tenue par le code natif) :

- [x] E1 : protocole 3.5 en Kotlin (`android/.../cable/`), mêmes octets que les vecteurs tinytuya, mêmes cas que `local/` (JUnit, faux câble)
- [x] E2 : la page ne parle plus qu'à des opérations de haut niveau (lire, programmer, chercher) ; la clé ne traverse plus la WebView ; essai réel R1 réussi sur le Pixel 9 (0.5.0)
- [x] E3 : attente en arrière-plan tenue par le pilote natif (`PiloteAttente` dans le service), état persisté, résultat brut interprété par la page, attente non suivie, notifications à début et fin (JUnit en temps virtuel, scénarios S15 à S22 et S-C, S-I, S-N sur émulateurs)
- [ ] E3 : trois soirs sur le Pixel 9 (R2 et R3) sans intervention, notification au plus 2 min après que le câble répond
- [x] E4 : code mort retiré (routes, constantes, doublon de validation HH:MM), outil PC `local/` aligné sur le contrat du démarrage tardif, règle « heure passée » : un seul fichier de cas (`tests/plage-tardif-cas.json`) lu par le Worker, la coque et `local/`
- [ ] E4 : relecture de sécurité complète (modèle le plus capable), exception du pont TCP retirée de `CLAUDE.md` et `SECURITE.md` (règle 9), une semaine sur le Pixel 10
- [ ] `android/essai/` embarqué seulement dans la version de mise au point (aujourd'hui : jamais servi en version publiée, `FiltreAssets.serviEnPublication` testé ; la séparation des deux jeux d'assets demande une modification de `.github/workflows/android.yml`)

Lot C5 :

- [ ] Deux semaines d'usage réel en mode Local sans intervention manuelle imprévue
- [ ] Écriture réussie et charge démarrée avec internet coupé (L4 et T4, depuis le téléphone)
- [ ] Décision consignée : Worker gardé en secours ou arrêté ; `tools/.env` supprimé

---

## Phase 3c – Mesure, fabricant et décision

- [x] Demandes envoyées à Tuya (ticket) et à Stellantis (formulaire Mobilisights), 2026-11-14
- [ ] Vers le 5 décembre : relance de Tuya et de Stellantis
- [ ] Vidéo de démonstration (filmable sur l'installation actuelle) et mail court au fabricant du câble, même proposition à deux autres marques (option D)
- [ ] Deux semaines après le mail : relance du fabricant, nouveau relevé des ventes Amazon
- [ ] Vers le 7 décembre : décision sur l'option D seulement (contrat proposé ou non)
- [ ] 30 jours après le lot S6 : bilan du site (visites, inscrits, dont ceux qui ont le câble, clics vers le câble)
- [ ] Début janvier : décision sur la suite, selon `docs/business-cases.md` : publication de l'appli (B), affiliation et comparaison d'offres (G), appli qui complète MyDS (F), ou arrêt du volet produit
- [ ] Toute application Android publiée : `testeur-relecteur` compare ses résultats à `tests/golden-cases.json`
