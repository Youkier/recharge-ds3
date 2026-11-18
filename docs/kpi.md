# Indicateurs du volet produit

Définitions seulement. Aucune valeur n'est écrite ici : le dépôt est public. Les valeurs vont dans le tableau de bord privé de Mathieu. Les seuils sont des **propositions** (`business-dev`, 2026-11-18) tant que Mathieu ne les a pas consignés dans `docs/decisions-produit.md`.

## Règle de mesure

Le site ne pose aucun cookie et ne reconnaît aucun visiteur. On ne garde que des comptages par jour : événement, valeur d'une liste fermée, nombre. Jamais la batterie saisie, le SOH, les prix, les heures creuses, une adresse IP ou un identifiant ; aucun lien entre deux événements. Conséquence : pas de « visiteurs uniques » ni d'« utilisateurs réguliers ».

## Données comptées (par jour)

1. Pages vues par type de page (accueil, guide, page modèle).
2. Calculs aboutis (une heure de début affichée), sans la batterie saisie.
3. Voiture choisie (marque et modèle de la liste, ou « pas dans la liste »).
4. Courant choisi (10 A, 16 A, 32 A, autre).
5. Réponse à « Comment lancez-vous la charge ? ».
6. Clics vers la liste d'attente.
7. Clics vers le câble (lien rémunéré).
8. Lien de partage copié, et lien de partage ouvert.

## Indicateurs

Principaux : 1 et 2.

| # | Option | Indicateur | Définition exacte | Source | Fréquence | Seuil (proposition) | Décision |
|---|---|---|---|---|---|---|---|
| 1 | A, G | Calculs aboutis par semaine | Nombre de résultats affichant une heure de début (statuts `ok` ou `short`). Remplace « 300 utilisateurs réguliers », non mesurable sans identifiant : hypothèse de 3 à 5 soirs par semaine par habitué, soit 900 à 1 500 calculs pour 300 habitués. Biais : plusieurs appareils, curieux d'un soir, robots | Comptage du site | Hebdomadaire | Au-delà de 900 : déclenche G | Début janvier |
| 2 | A | Inscrits à la liste d'attente | Adresses distinctes inscrites au formulaire, sur 30 jours après la mise en ligne indexable | Formulaire | Hebdomadaire | Objectif 100 ; arrêt sous 30 | Début janvier |
| 3 | B | Inscrits avec le câble « dé » | Inscrits dont la réponse « câble » est ce modèle (liste de choix dans le formulaire, pas un champ libre) | Formulaire | Hebdomadaire | 20 au moins | Début janvier |
| 4 | G | Clics vers le câble pour 100 calculs | Clics sur le lien rémunéré divisés par les calculs aboutis de la même période, fois 100 | Comptage du site | Hebdomadaire | À fixer après 30 jours de relevé | Début janvier |
| 5 | B, G | Part « câble ou borne avec une appli » | Ces réponses divisées par toutes les réponses à « Comment lancez-vous la charge ? » | Comptage du site | Hebdomadaire | Aucun : sert à lire 3 et 4 | Début janvier |
| 6 | A, D | Voitures choisies | Les 5 modèles les plus choisis et la part de « pas dans la liste » | Comptage du site | Mensuelle | Aucun : choisit les pages modèles et les fabricants à démarcher | Début janvier |
| 7 | A | Bouche-à-oreille | Liens de partage copiés, et liens ouverts (hypothèse du plan : 3 %) | Comptage du site | Hebdomadaire | Aucun | Début janvier |
| 8 | D | Voie du fabricant | Réponse du fabricant (aucune, oui, non, contrat proposé) après la relance du 5 décembre ; ventes mensuelles relevées sur Amazon | Mathieu | Au relevé | Contrat proposé : D ; silence : en attente | 7 décembre |

F (appli qui complète MyDS) n'a pas d'indicateur du site : sa décision dépend de la réponse de Stellantis et de l'essai de psa_car_controller.

## Stockage proposé (à valider)

Un petit service de comptage à nous, sur le compte Cloudflare existant, à la même adresse que le site : aucun script tiers, la CSP actuelle suffit. Le stockage (Workers Analytics Engine ou D1 : conservation et gratuité non vérifiées) est à revoir par `tech-lead`. La dispense de consentement de la CNIL est à vérifier sur cnil.fr avant le lot S6 (page « solutions pour les outils de mesure d'audience », non lue en entier le 2026-11-18). Avant S6 : la FAQ de l'accueil (« Rien n'est envoyé ») et la page de confidentialité décrivent ces comptages.

## Ce qui n'est pas un indicateur

Pages vues brutes, durée de visite, provenance : elles ne décident rien.
