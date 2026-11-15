# Worker de programmation

Service Cloudflare minimal : règle le **début** de la plage de charge du câble par l'API Tuya, puis relit le câble. Code : `src/index.js` (point d'entrée) et `src/service.js` (logique) (module ES, Web Crypto et fetch, aucune dépendance). Tests : `node --test "tests/**/*.test.mjs"` depuis la racine du dépôt (Tuya simulé, aucun réseau).

## Variables

| Nom | Type | Rôle |
|---|---|---|
| `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_DEVICE_ID` | secrets | clés du projet Tuya, identifiant du câble (jamais fourni par une requête) |
| `JETON_ACCES` | secret | jeton attendu dans `Authorization: Bearer ...` |
| `TUYA_ENDPOINT` | variable | `https://openapi.tuyaeu.com` (valeur par défaut) |
| `ORIGINE_AUTORISEE` | variable | origine GitHub Pages pour le CORS, sans chemin (par exemple `https://<compte>.github.io`) |
| `EXIGER_LIMITEUR` | variable | `"1"` dans `wrangler.toml` : si le binding `LIMITEUR` manque, toute requête authentifiée reçoit 503 `tuya` (journal `limiteur_absent_exige`), sans repli en mémoire |
| `LIMITEUR` | binding | limite d'appels par minute (voir `docs/cloudflare-findings.md`) ; s'y ajoute toujours une limite de 30 appels par heure en mémoire |

## En local

1. Copier `.dev.vars.example` en `.dev.vars` et le remplir (fait par Mathieu ; ce fichier est ignoré par git, ne jamais le partager).
2. `npx.cmd wrangler dev --var EXIGER_LIMITEUR:0 --show-interactive-dev-session=false` dans ce dossier (`--var clé:valeur` remplace la valeur de `wrangler.toml`, et `--show-interactive-dev-session` est un booléen : source https://developers.cloudflare.com/workers/wrangler/commands/workers/). Le binding `LIMITEUR` est reconnu en local ; `EXIGER_LIMITEUR:0` n'est utile que s'il ne l'est pas (sinon le Worker local répondrait 503). Puis par exemple :
   `curl -H "Authorization: Bearer <jeton>" http://localhost:8787/api/etat`

Aucune connexion ni déploiement n'est faite ici (voir la skill `deploiement` : `wrangler login` et `secret put` par Mathieu ; `deploy` lancé par Claude après accord de Mathieu dans la demande d'autorisation).

## Routes (et seulement elles)

Toute requête sans jeton valide reçoit **401** avant toute autre logique (le jeton `JETON_ACCES` doit faire au moins 32 caractères, sinon tout est refusé et `configuration_incomplete` est journalisé) ; ensuite limiteur absent alors qu'il est exigé (**503**), limite d'appels (**429**), route inconnue **404**, mauvaise méthode **405**, corps invalide, champ en trop, ou `Content-Length` absent, non numérique ou supérieur à 512 **400**. Toutes les réponses portent `Vary: Origin`. `OPTIONS` répond au préflight CORS de l'origine autorisée seulement.

- `GET /api/etat` : lecture seule.
- `POST /api/programmer`, corps `{"allumage":"HH:MM"}` (00:00 à 23:59) : lit la plage, écrit `ss` = début et `m` = 2 (jamais `dt`, `se`, courant ni autre réglage), relit le câble.
  Si l'heure de Paris est déjà dans `[allumage, fin)` (minuit pris en compte), le début écrit est l'heure actuelle et la réponse porte `"immediat":true`.
- `POST /api/programmer`, corps `{"desactiver":true}` : plage courte. Lit la plage, écrit début = fin relue moins une minute (`00:00` donne `23:59`) et active la plage (seuls `ss` et `m` changent), relit. Jamais d'`immediat`. Réponse : `{"ok":true,"debut":"HH:MM","fin":"HH:MM","plage_active":true,"courte":true}`.

Succès : `{"ok":true,"debut":"HH:MM","fin":"HH:MM","plage_active":true|false}`.
Échec : `{"ok":false,"erreur":"hors_ligne"|"jeton"|"tuya"|"delai"|"relecture_differente"}` (502, 502, 502, 504, 502). Correspondance avec les codes Tuya : `docs/tuya-findings.md`.
Le succès n'est annoncé que si la valeur relue sur le câble correspond à ce qui a été demandé.
