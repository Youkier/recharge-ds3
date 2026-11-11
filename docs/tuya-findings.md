# Résultats vérifiés sur l'API Tuya

Chaque ligne : ce qui a été vérifié, comment (URL de documentation ou commande), résultat. Identifiants masqués.

## Appareil

- Nom dans Smart Life : (câble « dé », seul appareil coché dans le projet)
- Catégorie Tuya : `dj` (renvoyée par `GET /v1.0/iot-03/devices/{id}/specification`, sans aucune fonction ni état déclarés), appel réel 2026-11-11
- Mode d'instruction : aucun code standard (`status` vide) ; seuls les points de données du fabricant (`x_…`) sont lisibles, via les « shadow properties » v2

## Appels réels (2026-11-11, T1, compte principal relié avec le câble seul)

| Appel | Résultat |
|---|---|
| `GET /v1.0/token?grant_type=1` | OK : signature acceptée, `result.access_token`, `expire_time` = 7200 s |
| `GET /v1.3/iot-03/devices` (sans `source_type`) | `success` mais liste vide. `TUYA_UID` volontairement non renseigné (il interrogerait la liste du compte, qui contient d'autres appareils) |
| `GET /v1.0/devices/{id}/status` (chemin de la doc « Device Control ») | Erreur `code=2003 msg=function not support` |
| `GET /v1.0/iot-03/devices/{id}/status` | OK, liste vide `[]` |
| `GET /v1.0/iot-03/devices/{id}/specification` | OK, `{"category":"dj"}` seulement |
| `GET /v2.0/cloud/thing/{id}/shadow/properties` | **OK** : 29 points de données (`result.properties[]` avec `code`, `dp_id`, `type`, `value`, `time`). C'est le chemin de lecture retenu |

Vérification « câble seul » : faite visuellement par Mathieu dans la console (onglet Devices) ; non vérifiable par l'API sans appel au niveau du compte.

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
| `x_charge_mode` (dp 151) | string (JSON) | `{"m":2,"dt":0,"ss":"04:00","se":"06:00"}`. **Confirmé en T2** : plage de charge différée, `ss` = début et `se` = fin, en `HH:MM` ; début et fin dans la même valeur (relire puis ne changer que `ss`). `m` = 2 avec plage active, **`m` = 0 quand la plage est désactivée dans l'appli, et le câble se met alors à charger immédiatement** (`x_work_st_debug` WAIT → WORKING, `x_work_state` 202 → 300, `cp` 9.5 → 6.5 dans `x_charger_info`). Désactiver la plage n'empêche donc pas la charge : c'est le mode « charge immédiate ». Après réactivation (04:00–06:00) : valeur identique au relevé initial, câble revenu en attente ; seul `x_metrics` garde la trace d'une session brève (`d` 0 → 190, `e` = 0). `dt` inconnu | relevés shadow avant/après changement dans l'appli 04:00 → 04:30, puis désactivation | 2026-11-11 |
| `x_charge_history` (dp 105) | string (JSON) | `{"t":"2026-11-10 17:46:51","s":"17:46","e":"06:00","d":43997,"c":246}` : dernière charge (début, fin, durée en s ?, `c` inconnu) | relevé shadow | 2026-11-11 |
| `x_work_state` (dp 101) | value | 202 ; `x_work_st_debug` (dp 109, enum) = `WAIT` | relevé shadow | 2026-11-11 |
| `x_metrics` (dp 102) | string (JSON) | `{"L1":[2300,0,0],…,"t":210,"p":0,"d":0,"e":0}` (tension ×10 ?, puissance, énergie) | relevé shadow | 2026-11-11 |
| `x_charge_current` (dp 150) | value | 16 ; `x_max_current_cfg` (dp 152) = 16 ; `x_adjust_current` (dp 107) = `[6, 8, 10, 13, 16]`. **Ne jamais écrire** | relevé shadow | 2026-11-11 |
| `x_downcounter` (dp 108) | value | 0 (compte à rebours ? piste de repli) | relevé shadow | 2026-11-11 |
| `x_do_charge` (dp 140), `x_do_reset` (141), `x_do_reboot` (142) | bool | false. **Ne jamais écrire** | relevé shadow | 2026-11-11 |
| `x_sch1` à `x_sch4` (dp 180-183) | raw | sans valeur | relevé shadow | 2026-11-11 |
| Autres | | `x_selftest`, `x_alarm`, `x_charger_info` (firmware 1.9.7, différentiel type B), `x_single_fase_mode`, `x_debug`, `x_lang_cfg`, `x_socket_cfg`, `x_nfc_cfg`, `x_earch_free_cfg`, `x_product_varient`, `x_heartbeat`, `dp_num`, `x_plug_charge` | relevé shadow | 2026-11-11 |

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
| T0a Plage du câble + programmation Smart Life | **Réussi avec effet de bord** | Observé par Mathieu : la plage du câble se règle, s'active et la charge a lieu sur la plage. Quand la programmation Smart Life « marche à 7h » se déclenche, elle **désactive la plage** (celle-ci reste désactivée ensuite). Conséquence : la plage doit être réactivée chaque soir, sinon pas de charge la nuit suivante | 2026-11-11 |
| T0b Même essai, box coupée | Non fait | | |
| T1 Lecture de l'état | **Réussi** | Jeton OK ; état lisible uniquement via `/v2.0/cloud/thing/{id}/shadow/properties` (29 points de données fabricant) ; câble seul visible dans la console (contrôle visuel) | 2026-11-11 |
| T2 Identification du réglage de plage | **Réussi** | Début de plage changé dans Smart Life (04:00 → 04:30) : seul `x_charge_mode` change, `ss` passe de `"04:00"` à `"04:30"`, rien d'autre ne bouge | 2026-11-11 |
| T3 Démarrage différé exécuté par l'appareil | | | |
| T4 Exécution sans internet | | | |
| T5 Redémarrage de la charge après 2 h prise éteinte | | | |

## Décision

