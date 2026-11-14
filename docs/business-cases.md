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
| Pilotage local | Inconnu | Tests L1 à L4 |
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
- **B** : rien avant L1 et L2 réussis. Essai gratuit, réglage automatique payant. L'appli relit le format avant chaque écriture et ne l'écrit pas s'il a changé. Contrainte : téléphone sur le Wi-Fi de la maison, à compenser par un réglage automatique à l'arrivée.
- **G** : pas de bandeau publicitaire. Calcul personnel du coût de recharge par offre, classé par prix, Tempo et tarif réglementé compris, avec une page qui explique le financement (obligation légale des comparateurs). Amazon paie 4,5 à 5 % en Auto & moto. Aucun programme d'affiliation énergie public trouvé hors ekWateur (Affilae) : écrire aux fournisseurs. L'économie d'une offre spéciale voiture électrique est mince (environ 60 € par an).
- **F** : compléter MyDS (widget, alertes, âge des données) plutôt que la remplacer. Consultation seule d'abord (`data:telemetry`). **Par la voie officielle, un serveur dans l'UE est obligatoire** (échange du jeton avec un secret client, certificat délivré par Stellantis, réception des notifications de commandes) : coûts, sécurité et RGPD à prévoir. L'API permet ensuite de programmer la charge (`nextDelayedTime`) et le préconditionnement (4 programmes). Freins : l'utilisateur doit activer la connectivité partenaires, « Partner Services » n'existe pas dans tous les pays (France à confirmer), consentement global sur le lot demandé, portail non mis à jour depuis mars 2024. Par la voie officieuse (identifiants des applis officielles), le seul code libre des commandes est sous GPL-3.0.
- **C** : le cloud Tuya ne sert, au mieux, qu'à récupérer une fois la clé locale.

## Étapes

### Usage personnel (voir `PLAN.md`, phase 2a)

1. ~~Réappairer le câble sur le compte dédié, recréer les identifiants, `isolement` refuse les 4 lectures~~ : fait le 2026-11-14.
2. Tests restants : T7 (voiture branchée), T4 et T0b (reportés, avant la mise en service de la 2b), et les tests locaux L1 à L4 (`docs/tuya-findings.md`). T5 validé, T6 supprimé.
3. Phases 2b et 2c : Worker et bouton « Programmer la charge » (« Désactiver la charge » les soirs sans charge).
4. Deux semaines d'usage réel, en notant chaque échec. Filmer la démonstration pour le fabricant.

### Volet produit

| Quand | Étape | Option |
|---|---|---|
| ~~Dès que possible~~ | ~~Demandes à Tuya et à Stellantis~~ : envoyées le 2026-11-14 (ticket Tuya, formulaire mobilisights.com). Relance vers le 5 décembre | B, C, E, F |
| Après le test local | Page gratuite : profils, liste d'attente, 2 ou 3 liens d'affiliation, page « comment c'est financé » ; présentation sur 2 ou 3 forums | A, G |
| Après la vidéo | Mail court au fabricant, même proposition à deux autres marques | D |
| +2 semaines | Relance du fabricant, nouveau relevé des ventes Amazon | D |
| Vers le 7 décembre | Décision (ci-dessous) | B, D, F, G |
| +30 jours après la page | Bilan de la liste d'attente | A |
| En parallèle | Essai personnel de psa_car_controller pendant deux semaines | E, F |

### Décision du 7 décembre

- Contrat proposé par le fabricant → **D** (panneau Smart Life).
- Sinon, test local réussi et au moins 20 inscrits avec ce câble → **B**.
- Test local en échec → **G** et **F** deviennent les pistes principales.
- Aucune condition remplie → arrêt du volet produit ; l'outil reste pour usage personnel.
