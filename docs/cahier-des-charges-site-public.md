# Cahier des charges : site public (phase 3a)

Rédigé le 2026-11-15. Options A et G de `docs/business-cases.md`. Les lots et les critères d'acceptation sont repris dans `PLAN.md`, phase 3a. Les règles de `CLAUDE.md` s'appliquent, sauf mention contraire consignée dans `docs/decisions-produit.md`.

## 1. But

Un site gratuit qui attire des propriétaires de voitures électriques, leur rend un service en une minute, et mesure la demande. Il prépare trois sources de revenu sans en dépendre : le réglage automatique (appli), le lien vers un câble programmable, la comparaison d'offres d'électricité.

**Promesse :** « La limite de charge à 80 % pour les voitures qui n'en ont pas, en heures creuses. »

**Ce que le site doit prouver d'ici début janvier :** combien de visiteurs, combien d'inscrits à la liste d'attente, combien possèdent le câble « dé », combien cliquent sur le lien du câble.

## 2. Ce qui ne doit pas bouger

- **`site/` n'est pas modifié par cette piste.** La page personnelle de Mathieu, son adresse (`youkier.github.io/recharge-ds3/`), son jeton et sa publication GitHub Pages restent tels quels.
- **Le calcul est partagé, pas recopié à la main.** Le site public utilise `site/calc.js`, `site/vehicules.js` et `site/vehicules.json`, copiés à l'identique par le script de construction. `tests/golden-cases.json` reste la référence.
- **Aucun lien avec le service de Mathieu.** Le site public ne contient ni l'adresse du Worker, ni champ de jeton, ni mention de MyDS ou de la DS 3 de Mathieu. Sa politique CSP n'autorise aucune connexion vers `*.workers.dev`.
- **Aucune donnée personnelle collectée par le site.** Pas de compte, pas de cookie, réglages dans le navigateur du visiteur.

## 3. Architecture

Un moteur partagé, deux interfaces : la page personnelle (`site/`) et le site public (`public/`). L'interface publique est écrite à part, parce que ses textes, son parcours de première visite et ses pages n'ont rien à voir avec l'outil personnel, et pour que les deux pistes n'écrivent jamais dans les mêmes fichiers.

```
public/
  gabarits/       gabarits HTML (base, accueil, modèle, guide, page simple)
  contenu/        textes des guides et des pages fixes, en fragments HTML
  donnees/
    modeles.json  modèles qui ont une page (voir § 6)
    offres.json   liens sortants : liste d'attente, câble, don (voir § 7)
    tarifs.json   prix par défaut, avec date et source (voir § 5)
  app/            app-public.js, style.css, icônes, image de partage
tools/build-public.mjs   construit dist/public/ (Node, sans dépendance)
tests/public-*.test.mjs  tests de la construction et du lien avec le calcul
dist/                    sortie de construction, ignorée par git
```

- HTML, CSS et JavaScript natifs, aucune dépendance npm, aucune requête vers un autre site au chargement.
- **Le texte est dans le HTML généré**, pas produit par JavaScript : c'est ce que lisent les moteurs de recherche. Le calcul, lui, s'exécute dans le navigateur.
- `tools/build-public.mjs` : lit les gabarits, le contenu et les données, copie les modules partagés depuis `site/`, écrit `dist/public/`. Même entrée, même sortie (pas de date du jour dans les pages, sauf `tarifs.json`).
- Variable `PUBLIC_INDEXABLE` : absente, toutes les pages portent `noindex` et `robots.txt` interdit tout ; à `1`, le site est indexable. Variable `PUBLIC_ORIGINE` : adresse du site pour les liens canoniques et le plan du site.

## 4. Pages

| Adresse | Contenu | Rôle |
|---|---|---|
| `/` | Titre, promesse, trois étapes, calcul, résultat, « Comment régler », liste d'attente, questions fréquentes | Arrivée depuis les forums, conversion |
| `/limite-de-charge/<marque>-<modele>/` | Une page par modèle sans limite de charge : le problème sur ce modèle, le calcul prérempli, la méthode | Référencement (« limiter la charge à 80 % e-208 ») |
| `/guides/charge-differee-de-la-voiture/` | Régler l'heure dans la voiture, limites connues | Référencement, aide |
| `/guides/cable-ou-borne-programmable/` | Régler une plage horaire sur un câble ou une borne connectés | Référencement, aide, lien du câble |
| `/guides/pourquoi-80-pour-cent/` | Pourquoi ne pas charger à 100 % tous les jours, avec sources | Référencement |
| `/financement/` | Comment le site est financé, liste des liens rémunérés, bouton de don | Confiance, obligation d'information |
| `/confidentialite/` | Aucune donnée collectée par le site, mesure d'audience, formulaire de liste d'attente | Confiance |
| `/mentions-legales/` | Éditeur, hébergeur | Obligation |
| `404.html`, `sitemap.xml`, `robots.txt` | | Technique |

Chaque page : un seul `<h1>`, un `<title>` et une description uniques, un lien canonique sans paramètres, les balises de partage (titre, description, image), `lang="fr"`. Navigation commune : Accueil, Guides, Financement.

## 5. Le calcul

**Première visite : trois questions**, à la place d'un écran de paramètres.

1. **Votre voiture** : marque, modèle, version (liste `vehicules.json`), ou « elle n'est pas dans la liste » avec saisie de la capacité utile en kWh.
2. **Votre recharge** : prise classique (10 A), prise renforcée (16 A, 3,7 kW), borne 7,4 kW (32 A), ou autre courant. Tension 230 V. Le rendement se déduit du courant comme dans `site/app.js`.
3. **Vos heures creuses et votre départ** : début, fin, heure de départ. Rappel : « vos heures creuses figurent sur votre facture ».

Puis, chaque soir, une seule saisie : la batterie à l'arrivée.

- Entrées passées à `plan()` : celles de `tests/golden-cases.json`. Valeurs par défaut neutres : cible 80 %, SOH 100 %, `pre` 0, `deduct` faux, mode « finir à la fin des heures creuses », heures creuses 22:00–06:00, départ 07:30. Prix par défaut lus dans `public/donnees/tarifs.json` (tarif réglementé heures creuses, **avec date et source vérifiées**, voir § 11).
- **Vocabulaire sans matériel imposé** : « Démarrer la charge à 00:35 », « Fin à 06:00 », jamais « la prise » ni « Smart Life » dans le résultat.
- Les quatre statuts de `plan()` ont chacun leur message : `ok`, `short` (cible non atteinte dans les heures creuses : dire de combien, et le coût du dépassement), `none` (« pas de charge nécessaire ce soir »), `err` (saisie à corriger, champ désigné).
- Sous le résultat : énergie, durée, coût de la nuit, et **deux chiffres qui se partagent** : l'économie annuelle estimée par rapport aux heures pleines et le nombre de nuits à 100 % évitées. Leur mode de calcul est écrit sur la page, hypothèses comprises (nombre de recharges par an saisi ou par défaut).
- **Lien de partage** : un bouton copie une adresse qui contient les réglages (voiture, courant, heures creuses, départ, cible), jamais la batterie du soir. Ouvrir ce lien préremplit le calcul. Les paramètres inconnus ou invalides sont ignorés.
- Réglages enregistrés dans `localStorage`, dans un `try/catch`, sous une clé différente de celle de la page personnelle.
- Paramètres avancés (SOH, tension, rendement, prix, mode « commencer au début ») dans un bloc replié.

**Limites connues, à écrire dans l'aide plutôt qu'à contourner :** une seule plage d'heures creuses par nuit ; recharge monophasée seulement ; pas de préconditionnement.

## 6. Pages par modèle

`public/donnees/modeles.json`, une entrée par modèle :

```json
{
  "slug": "peugeot-e-208",
  "marque": "Peugeot", "modele": "e-208",
  "limite_native": false,
  "charge_differee": "debut_seul",
  "sources": [{ "url": "…", "lu_le": "2026-11-…", "ce_que_dit_la_source": "…" }]
}
```

- `limite_native` : la voiture propose-t-elle une limite de charge. `charge_differee` : `debut_seul`, `debut_et_fin`, `aucune` ou `inconnu`.
- **Aucune page n'est générée sans au moins une source lue** (notice du constructeur ou essai de presse), comme pour `docs/vehicules-a-verifier.md`. Un champ `inconnu` s'affiche comme tel : « nous ne savons pas encore ».
- Le script de construction refuse une entrée sans source ou dont le modèle est absent de `vehicules.json`.
- Premiers candidats, **à vérifier un par un** : Peugeot e-208 et e-2008, Opel Corsa Electric et Mokka Electric, DS 3 E-Tense, Citroën ë-C4. Objectif : 10 à 15 pages, pas plus tant que le passage n'est pas mesuré.
- Les textes diffèrent réellement d'une page à l'autre (capacité, durée type d'une recharge de 20 à 80 % sur prise 16 A, particularités du modèle). Pas de page qui ne change que le nom du modèle.

## 7. « Comment régler » : l'emplacement qui porte la suite

Sous le résultat, une question : **« Comment lancez-vous la charge ? »** Chaque réponse affiche un encart. Les encarts et leurs liens viennent de `public/donnees/offres.json` : ajouter une offre ou activer un encart est un changement de données, pas de code.

| Réponse | Encart en version 1 | Suite possible |
|---|---|---|
| Un câble ou une borne avec une appli | Guide « plage horaire » ; question « quel modèle ? » ; si câble Smart Life : « le réglage automatique arrive, prévenez-moi » | Réglage automatique par l'appli Android (phase 3b, option B) |
| La charge différée de la voiture | Guide ; avertissement si le modèle n'a qu'une heure de début | Lecture de la batterie (options E et F) |
| Rien de programmable | Explication honnête des solutions : régler la voiture si elle le permet, ou un câble programmable (**lien rémunéré, signalé comme tel**) | Affiliation (option G) |
| Je ne sais pas | Trois questions pour s'y retrouver | |

- Encarts prévus mais **désactivés** en version 1 (`"actif": false`) : `reglage-automatique`, `offres-electricite`.
- Aucune recommandation de prise connectée grand public pour recharger une voiture : risque d'échauffement sur une charge longue à fort courant.
- Tout lien rémunéré porte `rel="sponsored nofollow noopener"` et la mention visible « lien rémunéré ». Les offres sans rémunération restent présentées au même niveau.

## 8. Liste d'attente

- Juste sous « Comment régler » : « Vous voulez que ça se règle tout seul ? » puis un bouton vers un **formulaire externe hébergé dans l'Union européenne** (lien sortant, rien d'intégré dans la page).
- Trois questions dans le formulaire : voiture, câble ou borne (marque et modèle), adresse e-mail. Texte d'information : à quoi sert l'adresse, combien de temps elle est gardée, comment se désinscrire.
- L'adresse du formulaire est dans `offres.json`. Tant qu'elle est vide, le bouton n'est pas affiché.

## 9. Mesure d'audience

- Sans cookie ni identifiant, sans bandeau. **Avant de choisir l'outil, vérifier sur cnil.fr qu'il peut être dispensé de consentement** dans la configuration retenue.
- À compter : pages vues par page, clics vers la liste d'attente, clics vers le câble, clics vers le don. Si l'outil ne compte pas les clics sortants, passer par des pages relais (`/aller/liste-attente/`), comptées comme des pages vues, après vérification que les conditions du programme d'affiliation le permettent.
- Rien n'est compté sur la page personnelle de Mathieu.

## 10. Sécurité, accessibilité, performance

- CSP : `default-src 'none'`, scripts, styles et images de même origine, `connect-src 'self'` plus le domaine de mesure si nécessaire, `base-uri 'none'`, `form-action 'none'`. Par en-tête HTTP si l'hébergeur le permet, sinon par balise.
- Aucun script tiers en dehors de la mesure d'audience. Aucune police externe.
- Lisible à 380 px de large, thèmes clair et sombre, libellés sur tous les champs, navigation au clavier, contrastes suffisants.
- Page d'accueil : moins de 150 Ko transférés hors image de partage.

## 11. Ce qu'on attend de Mathieu

Rien de ce qui suit ne bloque les lots S1 à S4.

1. **Nom du site et nom de domaine**, sans marque automobile (environ 10 € par an).
2. **Hébergement** : accord pour publier `dist/public/` sur Cloudflare Pages relié au dépôt GitHub (même compte que le Worker, publication à chaque `git push`), ou autre choix. La marche exacte est à lire sur `developers.cloudflare.com` avant de proposer les clics.
3. **Formulaire de liste d'attente** : création du compte et du formulaire, puis son adresse.
4. **Mentions légales** : ce que Mathieu accepte de publier comme identité d'éditeur, et à partir de quand une micro-entreprise est nécessaire (à vérifier, voir `docs/business-cases.md`).
5. **Relecture des textes** de l'accueil et du premier guide, sur le Pixel.
6. Plus tard : inscription au programme Amazon Partenaires, bouton de don, messages sur les forums.

**Données que Claude Code ne peut pas inventer** (sources hors des domaines autorisés) : prix du tarif réglementé, faits par modèle, position de la CNIL. Soit Mathieu autorise la lecture de la source, soit la recherche est faite dans la conversation Claude de Mathieu, qui rend les valeurs avec leurs sources.

## 12. Hors périmètre de la version 1

Comparateur d'offres d'électricité, bouton de réglage automatique, comptes utilisateurs, publicité, autres langues, plages d'heures creuses multiples, recharge triphasée, installation en PWA (à ajouter si la mesure montre des visiteurs réguliers).

## 13. Lots

| Lot | Contenu | Autonome ? |
|---|---|---|
| S1 | Script de construction, gabarit de base, accueil avec calcul et première visite, tests | Oui |
| S2 | « Comment régler », `offres.json`, liste d'attente (bouton masqué sans adresse), lien de partage | Oui |
| S3 | Guides, pages fixes (financement, confidentialité, mentions légales en brouillon), plan du site, balises de partage | Oui, textes à relire |
| S4 | Pages par modèle : gabarit, contrôles du script, deux entrées d'exemple marquées « à vérifier » et non publiées | Oui ; les vraies entrées attendent les sources |
| S5 | Mise en ligne provisoire, non indexable | Non : hébergement (Mathieu) |
| S6 | Domaine, site indexable, mesure d'audience, formulaire, messages sur les forums | Non : Mathieu |

Les critères d'acceptation sont dans `PLAN.md`, phase 3a.
