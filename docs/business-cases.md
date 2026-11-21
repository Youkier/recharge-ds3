# Volet produit : options, priorités et étapes

Synthèse des échanges du 11 au 14 novembre 2026. Le détail (pré-mortem, versions adaptées, business case complet et sources) est dans le document privé « Recharge DS 3 : business cases et priorités » : https://claude.ai/artifact/PRLFA3L5TrUY4ypf1wJgYS

Ce volet ne change aucune règle de `CLAUDE.md`. L'usage personnel (phases 2a à 2c de `PLAN.md`) passe en premier.

## En une phrase

Aucune option ne remplace un salaire. Les deux plus réalistes rapportent quelques milliers d'euros par an au mieux, et chaque voie payante dépend d'un tiers (Tuya, le fabricant du câble, Stellantis, Google). On n'engage donc de développement lourd qu'après une réponse ou une mesure de la demande.

## Données de départ

| Donnée | Valeur | Statut |
|---|---|---|
| Prix du câble sur Amazon | 120 € | Relevé |
| Ventes du câble | Plus de 1 000 le mois dernier, soit au moins 12 000 par an | Relevé une fois, à revérifier |
| Note du câble | 4,5 | Relevé |
| Écriture de la plage par le cloud | Fonctionne (T1 à T3) | Testé |
| Cloisonnement d'un projet Tuya | Aucun : les clés ouvrent tout le compte relié | Testé |
| Pilotage local | Lecture et écriture de la plage en local, protocole Tuya 3.5 (L1 à L3) ; sans internet non testé (L4) | Testé le 2026-11-15/16 |
| Clé locale pour un client | Invisible dans Smart Life ; obtenue seulement par le cloud Tuya (compte développeur, ou connexion de partage d'appareils avec l'identifiant d'application de Home Assistant) ; change à chaque réappairage | Recherche du 2026-11-16 |
| Essai gratuit IoT Core de Tuya (voie cloud) | Expire le 2026-12-11 ; prolongation de 6 mois à demander, sans garantie de durée | Constaté par Mathieu le 2026-11-15 |
| Matter, Google Home, Alexa | Aucun (ni logo Matter, ni compatibilité annoncée) | Vérifié par Mathieu |
| Taux d'achat d'une appli compagnon | 1 % seul, 3 % avec bouche-à-oreille, 10 % avec un lien du fabricant | Hypothèse |

## Options et priorités

| Priorité | Option | Gain réaliste par an | Effort pour savoir | Effort total | Dépend de |
|---|---|---|---|---|---|
| 1 | **A.** Page de calcul gratuite + liste d'attente | 0 € en direct, mesure la demande | 1 week-end | 1 week-end | Personne |
| 2 | **D.** Fonction vendue au fabricant du câble (panneau Smart Life) | Forfait de 2 000 à 5 000 €, ou un lien qui fait monter B | 2 heures | 5 à 8 week-ends si accord | Le fabricant |
| 3 | **B.** Appli Android de pilotage local du câble, 6 € | Environ 1 400 € (460 à 4 600 €) | 20 minutes (test local) | 5 à 8 week-ends | Test local, clé locale, Google Play |
| 4 | **G.** Outil gratuit financé par l'affiliation (offre d'électricité, câble) | Environ 1 100 € (90 à 7 500 €) | 1 soirée | 3 à 5 week-ends | Trafic, programmes d'affiliation |
| 5 | **F.** Appli tierce qui complète MyDS (consultation d'abord) | Environ 3 200 € (640 à 12 750 €) avant frais de serveur, révocable | 1 soirée d'essai | 4 à 6 week-ends, puis autant pour les commandes | Stellantis (accès officiel + serveur), Google Play |
| 6 | **E.** Programmation de la voiture par Stellantis | Devient une fonction de F | 1 soirée d'essai | 2 à 3 mois | Stellantis ou un intermédiaire |
| 7 | **C.** Service par le cloud Tuya | Négatif (licence de 5 000 $ la première année) | Un mail | 3 à 5 week-ends | Tuya |

Points clés par option :

- **A** : profils de voiture, liste d'attente en trois questions (voiture, câble, intérêt pour le réglage automatique), formulaire hébergé en Europe. Objectif : 100 inscrits en 30 jours, dont 20 avec ce câble. Arrêt sous 30 inscrits.
- **D** : demander d'abord ce qui ne coûte rien au fabricant (contact technique, stabilité du réglage `x_charge_mode`, lien vers l'outil). Forfait plutôt que licence par câble. Même proposition à deux autres marques de câbles Smart Life. Le dépôt étant public, la protection est la rapidité, pas le secret.
- **B** : L1 à L3 réussis : la commande locale n'est plus le verrou, **la clé locale l'est**. Seule voie acceptable pour un produit : chaque client se connecte avec son propre compte Smart Life (code utilisateur + QR code) depuis l'appli, la clé reste sur son téléphone, puis pilotage local sans serveur ; il faut pour cela **notre propre identifiant d'application Tuya** pour la connexion de partage d'appareils (`tuya-device-sharing-sdk`). Écartés : emprunter l'identifiant de Home Assistant (outils type tuya-local-key, acceptables entre bricoleurs, pas pour une appli vendue), un compte Smart Life générique de l'éditeur auquel les clients partagent leur câble (point unique sensible, données centralisées), extraire la clé de Smart Life ou reflasher le câble. Google Home n'offrirait qu'un marche/arrêt par le cloud (contraire à la règle 1) ; Matter (type borne de recharge, horaires de charge depuis la 1.4) supprimerait le problème mais exige un nouveau firmware du fabricant. Essai gratuit, réglage automatique payant. L'appli relit le format avant chaque écriture et ne l'écrit pas s'il a changé. Contrainte : téléphone sur le Wi-Fi de la maison, à compenser par un réglage automatique à l'arrivée.
- **G** : pas de bandeau publicitaire. Calcul personnel du coût de recharge par offre, classé par prix, Tempo et tarif réglementé compris, avec une page qui explique le financement (obligation légale des comparateurs). Amazon paie 4,5 à 5 % en Auto & moto. Aucun programme d'affiliation énergie public trouvé hors ekWateur (Affilae) : écrire aux fournisseurs. L'économie d'une offre spéciale voiture électrique est mince (environ 60 € par an).
- **F** : compléter MyDS (widget, alertes, âge des données) plutôt que la remplacer. Consultation seule d'abord (`data:telemetry`). **Par la voie officielle, un serveur dans l'UE est obligatoire** (échange du jeton avec un secret client, certificat délivré par Stellantis, réception des notifications de commandes) : coûts, sécurité et RGPD à prévoir. L'API permet ensuite de programmer la charge (`nextDelayedTime`) et le préconditionnement (4 programmes). Freins : l'utilisateur doit activer la connectivité partenaires, « Partner Services » n'existe pas dans tous les pays (France à confirmer), consentement global sur le lot demandé, portail non mis à jour depuis mars 2024. Par la voie officieuse (identifiants des applis officielles), le seul code libre des commandes est sous GPL-3.0.
- **C** : le cloud Tuya ne sert, au mieux, qu'à récupérer une fois la clé locale.

### Obtenir la clé locale d'un autre utilisateur (condition de toute appli diffusée, 2026-11-21)

Sans clé locale, l'appli ne pilote pas le câble. Options notées à la demande de Mathieu (sources dans `docs/tuya-findings.md`, « Obtenir la clé locale sans IoT Core ») :

| Option | Principe | Pour | Contre |
|---|---|---|---|
| **1. Parcours utilisateur sur la plateforme Tuya** | Chaque utilisateur crée son compte développeur, un projet IoT Core, y relie son compte Smart Life et copie sa clé (guide pas à pas dans l'appli) | Aucune dépendance de notre côté ; voie officielle | Long et technique (20-30 min, console en anglais) : la plupart abandonneront ; essai gratuit « usage non commercial », à renouveler ; incompatible avec une appli grand public |
| **2. Appli ou outil tiers** (ex. `tuya-local-key`, Home Assistant) | L'utilisateur obtient sa clé avec un outil existant puis la saisit dans notre appli | Rien à développer ni à faire valider | On renvoie vers un outil qu'on ne maîtrise pas (un mainteneur, session du compte stockée) ; parcours en deux applis ; réputation liée à un tiers |
| **3. Tuya nous donne un accès** (partenariat ou identité d'appli propre au flux « QR Smart Life ») | Dans notre appli : « code utilisateur » + QR scanné dans Smart Life → clé récupérée automatiquement | Le meilleur parcours (1 minute, aucun mot de passe) ; conforme si Tuya l'accorde | Dépend d'un accord de Tuya (à demander lors de la relance du 5 décembre) ; peut être payant ou refusé ; un serveur de notre côté peut être exigé |
| **4. Réutiliser l'identité de Home Assistant** (`HA_…` + `haauthorize`, ce que fait `tuya-local-key`) | Même parcours que l'option 3, sans rien demander | Marche aujourd'hui, sans délai | **Se faire passer pour Home Assistant** : très probablement contraire aux conditions de Tuya, risque de blocage du jour au lendemain pour tous les utilisateurs, et de réputation ; **à exclure pour une appli diffusée** (acceptable seulement pour l'usage personnel de Mathieu, script de secours) |

Recommandation : viser **3** (à demander à Tuya, et en parallèle au fabricant du câble pour l'option D) ; en attendant, **2** comme repli documenté dans un guide ; **1** seulement pour des utilisateurs avancés ; **4** jamais en diffusion.

## Étapes

### Usage personnel (voir `PLAN.md`, phase 2a)

1. ~~Réappairer le câble sur le compte dédié, recréer les identifiants, `isolement` refuse les 4 lectures~~ : fait le 2026-11-14.
2. Tests restants : T7 (voiture branchée), T4 et T0b (reportés, avant la mise en service de la 2b), et les tests locaux L1 à L4 (`docs/tuya-findings.md`). T5 validé, T6 supprimé.
3. Phases 2b et 2c : Worker et bouton « Programmer la charge » (« Désactiver la charge » les soirs sans charge).
4. Deux semaines d'usage réel, en notant chaque échec. Filmer la démonstration pour le fabricant.

### Volet produit

| Quand | Étape | Option |
|---|---|---|
| ~~Dès que possible~~ | ~~Demandes à Tuya et à Stellantis~~ : envoyées le 2026-11-14 (ticket Tuya, formulaire mobilisights.com). Relance vers le 5 décembre, avec la question : un éditeur tiers peut-il obtenir son propre identifiant pour la connexion de partage d'appareils, à quelles conditions et à quel prix ? | B, C, E, F |
| Dès maintenant, en parallèle | **Site public** (`PLAN.md` phase 3a, `docs/cahier-des-charges-site-public.md`) : promesse « la limite de charge à 80 % pour les voitures qui n'en ont pas », une page par modèle, emplacement « Comment régler » qui porte la liste d'attente, le lien du câble et, plus tard, le réglage automatique et les offres d'électricité ; page « comment c'est financé » ; présentation sur 2 ou 3 forums | A, G |
| Dès maintenant, en parallèle | **Coque Android en pilotage local** (`PLAN.md` phase 3b, `docs/cahier-des-charges-coque-android.md`) : d'abord pour l'usage personnel (plus de dépendance à l'essai IoT Core), prototype de B | B |
| Après la vidéo | Mail court au fabricant, même proposition à deux autres marques | D |
| +2 semaines | Relance du fabricant, nouveau relevé des ventes Amazon | D |
| Vers le 7 décembre | Décision sur D seulement (ci-dessous) | D |
| 30 jours après la mise en ligne du site | Bilan : visites, inscrits, dont ceux qui ont ce câble, clics vers le câble | A, G |
| Début janvier | Décision sur B, G et F (ci-dessous) | B, F, G |
| En parallèle | Essai personnel de psa_car_controller pendant deux semaines | E, F |

### Décisions

Revu le 2026-11-15 : il faut 30 jours de mesure après la mise en ligne du site, donc seule l'option D se décide vers le 7 décembre ; le reste début janvier.

- Contrat proposé par le fabricant → **D** (panneau Smart Life).
- Sinon, coque Android validée sur le Pixel (phase 3b, lot C3), **voie officielle et abordable pour obtenir la clé locale** (réponse de Tuya) et au moins 20 inscrits avec ce câble → **B**. Sans voie officielle, B se réduit à un outil pour bricoleurs, rattaché à A.
- Coque Android en échec (lot C3) → **G** et **F** deviennent les pistes principales.
- Site au-delà de 300 utilisateurs réguliers → **G** : comparaison d'offres d'électricité dans l'emplacement « Comment régler ».
- Aucune condition remplie → arrêt du volet produit ; l'outil reste pour usage personnel.
