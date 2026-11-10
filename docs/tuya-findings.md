# Résultats vérifiés sur l'API Tuya

Chaque ligne : ce qui a été vérifié, comment (URL de documentation ou commande), résultat. Identifiants masqués.

## Appareil

- Nom dans Smart Life :
- Catégorie Tuya :
- Mode d'instruction (standard / DP) :

## Vérifié dans la documentation officielle (2026-11-10, aucun appel réel encore)

| Point | Résultat | Source |
|---|---|---|
| Signature, jeton | `str = client_id + t + nonce + stringToSign` | https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g |
| Signature, autres appels | `str = client_id + access_token + t + nonce + stringToSign` | idem |
| Algorithme | `sign = HMAC-SHA256(str, secret)`, hexadécimal en MAJUSCULES | idem |
| `stringToSign` | `METHODE \n Content-SHA256 \n entêtes signés (ligne vide si aucun) \n URL` | idem |
| `Content-SHA256` | SHA-256 hex du corps (corps vide : `e3b0c442…b855`) | idem |
| URL signée | chemin + `?` + paramètres triés par nom, joints par `&` | idem |
| En-têtes | `client_id`, `sign`, `sign_method: HMAC-SHA256`, `t` (13 chiffres), `access_token` (sauf jeton), `nonce` | idem |
| Vecteurs de test | deux exemples avec valeurs et `sign` attendu : reproduits à l'identique par `tests/tuya-sign.test.mjs` (hors ligne, passent) | idem |
| Endpoint Europe centrale | `https://openapi.tuyaeu.com` | https://developer.tuya.com/en/docs/iot/api-request?id=Ka4a8uuo1j4t4 |
| Chemins appareil | `GET /v1.0/devices/{id}/functions`, `/status`, `/specifications` ; `POST /v1.0/devices/{id}/commands` | https://developer.tuya.com/en/docs/cloud/device-control?id=K95zu01ksols7 |
| Liste des appareils (1) | `GET /v1.3/iot-03/devices` ; paramètres facultatifs `source_type` (asset par défaut, homeApp, tuyaUser, product), `source_id`, `page_size` (max 200) ; résultat `result.list[]` avec `name`, `category`, `id`, `online` (et `local_key`, que la sonde n'affiche jamais) | https://developer.tuya.com/en/docs/cloud/dc413408fe?id=Kc09y2ons2i3b |
| Liste des appareils (2) | `GET /v1.0/users/{uid}/devices` (uid obligatoire, `page_no` 0 = première page) ; `result[]` avec `name`, `category`, `id`, `online` | https://developer.tuya.com/en/docs/cloud/cacc9c4989?id=Ka7kk03zdecl4 |

## Hypothèses (non vérifiées, à confirmer par appel réel)

- `GET /v1.0/token?grant_type=1` et la forme de la réponse (`result.access_token`, `expire_time`) : connus de la skill, non retrouvés sur une page officielle lors de cette recherche. Confirmé au test T1.
- Variante `/v1.0/iot-03/devices/{id}/...` (functions, specification, status) : citée par la skill et par des résultats de recherche (IoT Core), mais la page « Device Control » officielle utilise `/v1.0/devices/{id}/...`. La sonde utilise par défaut le chemin documenté ; l'option `--iot03` essaie l'autre. Noter lequel fonctionne.
- La spécification s'appelle `specifications` (v1.0 doc) ou `specification` (skill) ; des versions v1.1/v1.2 existent selon les pages.
- `GET /v1.3/iot-03/devices` sans paramètre (source_type asset par défaut) peut renvoyer une liste vide pour des appareils liés par le compte Smart Life : dans ce cas ajouter `TUYA_UID` (facultatif) dans `tools/.env` pour essayer `source_type=tuyaUser` puis `/v1.0/users/{uid}/devices`.
- `GET /v2.0/cloud/thing/{id}/shadow/properties` (option `releve --shadow`) : source skill uniquement, non vérifiée.
- Le code et le format du « début de plage de charge » : inconnus. `ecrire-debut` refuse de s'exécuter tant que `CODE_DEBUT_PLAGE` et `formaterDebut()` ne sont pas renseignés dans la sonde.
- Format de réponse d'erreur : la sonde lit `success`, `code`, `msg` (skill). À confirmer.

## Fonctions et états

| Code | Type | Valeurs | Source | Date |
|---|---|---|---|---|

## À vérifier lors des tests réels

La sonde lit `tools/.env` elle-même ; commandes : `node tools/tuya-probe.mjs <action>`.

- T1 : `token` (signature acceptée, jeton obtenu) ; `appareils` (le câble apparaît, noter noms et catégories des autres appareils) ; `etat` (lecture de l'état). Noter si `/v1.0/devices/...` répond ou s'il faut `--iot03`. Noter l'état « en ligne » et la catégorie du câble.
- T2 : `fonctions`, `spec` (la plage de charge est-elle listée ?), puis `releve`, changement de l'heure de début dans Smart Life, `releve`, `compare`. Si absente de `status`, retenter `releve --shadow`. Identifier code, type et format (heure, minutes, valeur encodée) ; renseigner `CODE_DEBUT_PLAGE` et `formaterDebut()`. Vérifier si début et fin sont dans la même valeur.
- T3 : `ecrire-debut HH:MM` (simulation), puis avec `--confirmer` à +5 min ; l'heure apparaît dans Smart Life et la charge démarre.
- T4 : même essai avec internet coupé côté box (10 min).
- T5 : voiture branchée, charge bloquée plus de 2 h : redémarre-t-elle au début de plage ?
- T6 : deux écritures le même soir, une seule plage ; courant, fin de plage et programmation de préconditionnement inchangés (`releve` avant/après + `compare`).

## Tests du point d'arrêt

| Test | Résultat | Détails | Date |
|---|---|---|---|
| T1 Lecture de l'état | | | |
| T2 Allumer / éteindre | | | |
| T3 Démarrage différé exécuté par l'appareil | | | |
| T4 Exécution sans internet | | | |
| T5 Redémarrage de la charge après 2 h prise éteinte | | | |

## Décision

