# Worker de programmation

Service Cloudflare minimal : règle le **début** de la plage de charge du câble par l'API Tuya, puis relit le câble. Code : `src/index.js` (module ES, Web Crypto et fetch, aucune dépendance). Tests : `node --test "tests/**/*.test.mjs"` depuis la racine du dépôt (Tuya simulé, aucun réseau).

## Variables

| Nom | Type | Rôle |
|---|---|---|
| `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_DEVICE_ID` | secrets | clés du projet Tuya, identifiant du câble (jamais fourni par une requête) |
| `JETON_ACCES` | secret | jeton attendu dans `Authorization: Bearer ...` |
| `TUYA_ENDPOINT` | variable | `https://openapi.tuyaeu.com` (valeur par défaut) |
| `ORIGINE_AUTORISEE` | variable | origine GitHub Pages pour le CORS, sans chemin (par exemple `https://<compte>.github.io`) |
| `LIMITEUR` | binding | limite d'appels (voir `docs/cloudflare-findings.md`) ; absent en local : repli en mémoire avec avertissement |

## En local

1. Copier `.dev.vars.example` en `.dev.vars` et le remplir (fait par Mathieu ; ce fichier est ignoré par git, ne jamais le partager).
2. `npx wrangler dev` dans ce dossier, puis par exemple :
   `curl -H "Authorization: Bearer <jeton>" http://localhost:8787/api/etat`

Aucune connexion ni déploiement n'est faite ici (`wrangler login`, `secret put` et `deploy` : voir la skill `deploiement`, par Mathieu).

## Routes (et seulement elles)

Toute requête sans jeton valide reçoit **401** avant toute autre logique ; ensuite limite d'appels (**429**), route inconnue **404**, mauvaise méthode **405**, corps invalide ou champ en trop **400**. `OPTIONS` répond au préflight CORS de l'origine autorisée seulement.

- `GET /api/etat` : lecture seule.
- `POST /api/programmer`, corps `{"allumage":"HH:MM"}` (00:00 à 23:59) : lit la plage, écrit `ss` = début et `m` = 2 (jamais `dt`, `se`, courant ni autre réglage), relit le câble.
  Si l'heure de Paris est déjà dans `[allumage, fin)` (minuit pris en compte), le début écrit est l'heure actuelle et la réponse porte `"immediat":true`.
- `POST /api/programmer`, corps `{"desactiver":true}` : **pas encore disponible** (test T7) : 501 `{"ok":false,"erreur":"non_disponible"}`, rien n'est lu ni écrit. Point d'extension : fonction `desactiver()`.

Succès : `{"ok":true,"debut":"HH:MM","fin":"HH:MM","plage_active":true|false,"charge_active":null}`. `charge_active` est `null` tant que T7 n'a pas identifié le mécanisme de charge.
Échec : `{"ok":false,"erreur":"hors_ligne"|"jeton"|"tuya"|"delai"|"relecture_differente"|"non_disponible"}` (502, 502, 502, 504, 502, 501). Correspondance avec les codes Tuya : `docs/tuya-findings.md`.
Le succès n'est annoncé que si la valeur relue sur le câble correspond à ce qui a été demandé.
