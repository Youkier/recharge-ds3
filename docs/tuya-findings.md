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

**Test d'isolement (2026-11-11, action `isolement`, lecture seule, contenu jamais affiché)** : compte principal relié avec liaison manuelle du câble seul ; lectures tentées sur un thermomètre du même compte, non coché dans le projet.

| Appel | Résultat |
|---|---|
| `GET /v1.0/iot-03/devices/{autre}` | refusé, `code=1106 permission deny` |
| `GET /v1.0/devices/{autre}` | **accepté**, objet de 22 champs |
| `GET /v1.0/iot-03/devices/{autre}/status` | **accepté**, 4 états |
| `GET /v2.0/cloud/thing/{autre}/shadow/properties` | **accepté**, 6 points de données |

Conclusion : **la sélection d'appareils à la liaison ne cloisonne pas l'accès**. Les clés d'un projet relié à un compte donnent accès aux appareils de tout ce compte. Seul un compte relié qui ne possède que le câble isole réellement.

**Nouveau test d'isolement (2026-11-14, après reprise)** : compte principal délié, câble réappairé sur le compte dédié (propriétaire), nouvel Access Secret. Le câble reste lisible (jeton OK, 29 points de données via shadow, `x_charge_mode` au même format). Lectures tentées sur un appareil du compte principal :

| Appel | Résultat |
|---|---|
| `GET /v1.0/iot-03/devices/{autre}` | refusé, `code=1106 permission deny` |
| `GET /v1.0/devices/{autre}` | refusé, `code=1106 permission deny` |
| `GET /v1.0/iot-03/devices/{autre}/status` | refusé, `code=1106 permission deny` |
| `GET /v2.0/cloud/thing/{autre}/shadow/properties` | refusé, `code=40001900 No space permission` |

Conclusion : **isolement vérifié**, condition de reprise de la phase 2a remplie.

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

## Écriture d'un point de données

- `POST /v2.0/cloud/thing/{device_id}/shadow/properties/issue`, corps `{"properties": "<texte JSON>"}` (la valeur de `properties` est une **chaîne**), réponse `{"success": true, "result": {}}` ; échoue si l'appareil est hors ligne ; 4 appels/s au plus. Source : https://developer.tuya.com/en/docs/cloud/c057ad5cfd?id=Kcp2kxdzftp91 (documentation, pas encore d'appel réel).
- Pour le câble : `{"properties": "{\"x_charge_mode\":\"{\\\"m\\\":2,\\\"dt\\\":0,\\\"ss\\\":\\\"HH:MM\\\",\\\"se\\\":\\\"06:00\\\"}\"}"}`. Activer la plage = `m` = 2 (observé : réactivation dans l'appli fait passer `m` de 0 à 2).
- **Hypothèse à vérifier** : la programmation Smart Life « marche à 7h » (T0a) fait passer `m` à 0, ce qui « désactive » la plage. Vérifiable par un relevé un matin après 7h.

## Fonctions et états

| Code | Type | Valeurs | Source | Date |
|---|---|---|---|---|
| `x_charge_mode` (dp 151) | string (JSON) | `{"m":2,"dt":0,"ss":"04:00","se":"06:00"}`. **Confirmé en T2** : plage de charge différée, `ss` = début et `se` = fin, en `HH:MM` ; début et fin dans la même valeur (relire puis ne changer que `ss`). `m` = 2 avec plage active, **`m` = 0 quand la plage est désactivée dans l'appli, et le câble se met alors à charger immédiatement** (`x_work_st_debug` WAIT → WORKING, `x_work_state` 202 → 300, `cp` 9.5 → 6.5 dans `x_charger_info`). Désactiver la plage n'empêche donc pas la charge : c'est le mode « charge immédiate ». Après réactivation (04:00–06:00) : valeur identique au relevé initial, câble revenu en attente ; seul `x_metrics` garde la trace d'une session brève (`d` 0 → 190, `e` = 0). `dt` inconnu | relevés shadow avant/après changement dans l'appli 04:00 → 04:30, puis désactivation | 2026-11-11 |
| `x_charge_history` (dp 105) | string (JSON) | `{"t":"2026-11-10 17:46:51","s":"17:46","e":"06:00","d":43997,"c":246}` : dernière charge (début, fin, durée en s ?, `c` inconnu) | relevé shadow | 2026-11-11 |
| `x_work_state` (dp 101) | value | 202 ; `x_work_st_debug` (dp 109, enum) = `WAIT` | relevé shadow | 2026-11-11 |
| `x_metrics` (dp 102) | string (JSON) | `{"L1":[2200,153,33],…,"t":230,"p":33,"d":470,"e":0}` pendant une charge : L1 = [tension ×10 V, courant ×10 A, puissance ×100 W] ; `p` = puissance ×100 W ; `d` = durée de la session en dixièmes de seconde (+300 en 30 s) ; `e` = énergie (unité à préciser) ; `t` = température ×10 ? | relevés shadow pendant T3 | 2026-11-11 |
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
- T4 : même essai avec internet coupé côté box (10 min). Reporté le 2026-11-14.
- T5 : voiture branchée, charge bloquée plus de 2 h : redémarre-t-elle au début de plage ? Validé le 2026-11-14.
- T6 : supprimé le 2026-11-14 (plus de programmation de préconditionnement) ; la partie API a réussi le 2026-11-11.
- T7 : `releve --shadow --iot03`, arrêt de la charge dans Smart Life, nouveau relevé, `compare` ; puis vérification voiture branchée.

## Tests du point d'arrêt

| Test | Résultat | Détails | Date |
|---|---|---|---|
| T0a Plage du câble + programmation Smart Life | **Réussi avec effet de bord** | Observé par Mathieu : la plage du câble se règle, s'active et la charge a lieu sur la plage. Quand la programmation Smart Life « marche à 7h » se déclenche, elle **désactive la plage** (celle-ci reste désactivée ensuite). Conséquence : la plage doit être réactivée chaque soir, sinon pas de charge la nuit suivante | 2026-11-11 |
| T0b Même essai, box coupée | **Reporté** avec T4 | À faire avant la mise en service de la phase 2b | 2026-11-14 |
| T1 Lecture de l'état | **Réussi** | Jeton OK ; état lisible uniquement via `/v2.0/cloud/thing/{id}/shadow/properties` (29 points de données fabricant) ; câble seul visible dans la console (contrôle visuel) | 2026-11-11 |
| T2 Identification du réglage de plage | **Réussi** | Début de plage changé dans Smart Life (04:00 → 04:30) : seul `x_charge_mode` change, `ss` passe de `"04:00"` à `"04:30"`, rien d'autre ne bouge | 2026-11-11 |
| T3 Écrire le début de plage par l'API | **Réussi** | Deux écritures réelles (`ecrire-debut --confirmer`) : 04:00 → 23:08 puis 23:08 → 23:05, relues conformes, aucun autre réglage modifié. Smart Life affiche la nouvelle heure (Mathieu). À 23:05 le câble passe `WAIT` → `WORKING`, voiture en charge (Mathieu) : `x_metrics` L1 = [2200, 153, 33] soit 220,0 V, 15,3 A, 3,3 kW ; `cp` 6.5 | 2026-11-11 |
| T6 (partiel) Écritures répétées | **Réussi pour la partie API** | 3e écriture le même soir (23:05 → 04:00) pendant la charge : relue conforme, une seule plage, courant/plafond/options inchangés. **Le câble applique la nouvelle plage immédiatement** : charge arrêtée en moins de 5 s (`WAIT`, 0 A, `cp` 9.5). Reste à vérifier par Mathieu : programmation de préconditionnement intacte dans Smart Life | 2026-11-11 |
| T3b Réactivation de la plage par l'API | **Réussi** | Plage désactivée dans Smart Life (charge immédiate en cours, `m` = 0) ; écriture `m` = 2 avec la même plage 04:00–06:00 : relue conforme, charge arrêtée en moins de 5 s (`WAIT`, 0 A, `cp` 9.5), aucun autre réglage modifié | 2026-11-11 |
| T6 (suite) Programmation de préconditionnement | **Supprimé** | Plus de programmation Smart Life : préconditionnement sur la batterie | 2026-11-14 |
| T4 Exécution sans internet | **Reporté** (pas levé) | À faire avant la mise en service de la phase 2b. Raison (Mathieu) : la plage s'exécute de la même façon, réglée à la main ou par l'API | 2026-11-14 |
| T5 Redémarrage de la charge après 2 h prise éteinte | **Validé par Mathieu** | Constat en usage, pas d'essai instrumenté par la sonde | 2026-11-14 |
| T7 Désactivation de la charge (soir sans charge) | **Réussi en partie, mécanisme abandonné** | Relevés `tools/releves/releve-2026-11-14T21-45-39`, `…21-46-34`, `…21-47-10`. Plage désactivée dans Smart Life : `m` 2 → 0, charge immédiate (`WORKING`, 300, 15,3 A, `cp` 6.5). Bouton Smart Life « swipe to pause charging » : `PAUSE` (204), 0 A, `cp` 9.5, **mais aucun point de réglage ne change** (`x_charge_mode` reste `m` = 0, `x_do_charge` reste `false`) : commande ponctuelle invisible dans le relevé, non identifiée. Sortie de pause par l'API : `ecrire-debut 03:30` (`m` 0 → 2) relu conforme, câble `PAUSE` → `WAIT` (202), aucun autre réglage modifié. Pas de recherche plus poussée : soirs sans charge traités par une plage courte (décision du 2026-11-14) | 2026-11-14 |

## Codes d'erreur Tuya et correspondance du Worker (2026-11-14)

Source : https://developer.tuya.com/en/docs/iot/error-code?id=K989ruxx88swc (documentation lue ; **tous les codes autres que 1106 sont à confirmer en réel**). Observés en réel : `1106 permission deny`, `2003 function not support`, `40001900 No space permission` (tests d'isolement).

| Code Tuya (documentation) | Sens | Erreur du Worker |
|---|---|---|
| 1010, 1011, 1012, 1400 | jeton expiré ou invalide | jeton Tuya redemandé et appel rejoué une fois ; si ça échoue encore : `jeton` |
| 1004, 1013, 1106, 60009001, 28841002, 28841102, 28841105 | signature, horloge, permission, abonnement ou autorisation du projet | `jeton` (= accès à l'API Tuya à revoir) |
| 2001, 40000801 | appareil hors ligne | `hors_ligne` |
| message contenant « offline » (repli, à confirmer) | l'écriture hors ligne « échoue » selon la doc, code exact non vérifié | `hors_ligne` |
| 1110, 1113, 1199, 28841104, tout autre code, réponse non JSON, panne réseau | autres | `tuya` |
| appel sans réponse en 10 s | | `delai` |

Statuts HTTP du Worker : `hors_ligne`, `jeton`, `tuya`, `relecture_differente` : 502 ; `delai` : 504. Seul le code numérique Tuya est journalisé (jamais le message ni la réponse).

À confirmer par un essai réel : le code renvoyé par l'écriture quand le câble est hors ligne ; le caractère immédiat de la répercussion (le Worker relit jusqu'à 3 fois, 1,5 s, 2 s puis 2,5 s après l'écriture, la sonde attendait 5 s) ; l'effet sur la charge d'un début de plage réglé à l'heure actuelle (cas « heure déjà passée »).

Worker (révisé le 2026-11-14 après T7) : plus de `charge_active` ; `{"desactiver":true}` écrit la plage courte (début = `se` relu − 1 min, `m` = 2), relue comme une programmation normale, jamais `immediat`.

## Pilotage local, sans cloud (piste du 2026-11-12 ; L1 et L2 faits le 2026-11-15)

Idée : écrire `x_charge_mode` (dp 151) directement par le réseau de la maison (protocole local Tuya, TCP 6668), avec l'identifiant du câble et sa clé locale. Repli sans internet et base d'une éventuelle appli ; pour l'usage de Mathieu, la voie cloud (Worker) reste retenue (décision du 2026-11-12). Source du protocole : https://github.com/jasonacox/tinytuya (rétro-ingénierie communautaire, pas de documentation Tuya).

Le câble a été réappairé sur le compte dédié le 2026-11-14 : la clé locale est à récupérer à nouveau avant L1.

**À confirmer lors des tests L (affirmations reprises de tinytuya, non vérifiées sur ce câble)** : la clé locale change à chaque appairage ; une seule connexion locale à la fois (d'où Smart Life fermée pendant les essais) ; découverte par diffusion UDP sur les ports 6666, 6667 et 7000 ; `tinytuya.find_device` renvoie notamment `ip` et `version`.

Préparation : `py -m pip install tinytuya`, puis `node tools/tuya-probe.mjs cle-locale` (pose `TUYA_LOCAL_KEY` dans `tools/.env` sans l'afficher). Smart Life fermée pendant les essais. Commandes : `python tools/tuya-local-test.py <action>`.

| Test | Commande | Réussi si | Si échec | Résultat | Date |
|---|---|---|---|---|---|
| L1 Le câble s'annonce en local | `scan` | adresse et version de protocole affichées | Essayer `TUYA_LOCAL_IP` + `TUYA_LOCAL_VERSION` ; si le port 6668 ne répond pas : câble « cloud seulement », **piste abandonnée** | | |
| L2 Lecture locale | `etat` | le dp 151 est lu, même valeur que par le cloud | Clé périmée ou mauvaise version ; si le dp 151 n'est pas exposé en local : piste abandonnée | **Réussi** : protocole **3.5** (3.4 refusé), 13 dp lus en local : 101, 102, 106, 107, 109, 150, 151, 152, 155, 156, 157, 188, 189. dp 151 = `{"m":2,"dt":0,"ss":"03:30","se":"06:00"}`, même plage que dans Smart Life (confirmé par Mathieu). La sonde (`etat`, `releve --shadow`) renvoie `code=2003 function not support` sur ses anciens chemins v1.0 ; le Worker (shadow v2.0 seul) fonctionne le même jour | 2026-11-15 |
| L3 Écriture locale | `ecrire-debut HH:MM --confirmer` (à +5 min, voiture branchée) | valeur relue conforme, heure visible dans Smart Life, charge démarrée à l'heure | Arrêt, on en parle | **Réussi** : deux écritures locales (03:30 → 00:15, puis 00:15 → 00:12), relues conformes, aucun autre point modifié ; 00:15 visible dans Smart Life (Mathieu) ; charge démarrée à 00:12, constatée par Mathieu (relecture locale à 00:14 : plage 00:12–06:00) | 2026-11-16 |
| L4 Sans internet (teste le repli local ; ne remplace pas T4, qui reste à faire avant la phase 2b) | box : internet coupé, Wi-Fi gardé ; `ecrire-debut` à +5 min `--confirmer` | écriture acceptée et charge démarrée sans internet | Le local ne remplace pas le cloud : retour au plan Worker | **À faire plus tard** (reporté par Mathieu). Méthode : Claude Code n'a plus internet pendant la coupure, donc une seule commande validée **avant** la coupure, lancée en arrière-plan : elle attend la coupure (essai toutes les 5 s, 10 min au plus), règle en local un départ à +2 min, relit et note le résultat dans un fichier lu au retour d'internet. Mathieu observe sur la voiture l'arrêt puis la reprise de la charge | |

À noter aussi : la version de protocole (3.3, 3.4, 3.5), la liste des dp visibles en local, et si `cle-locale` renvoie bien `local_key` par `GET /v1.0/devices/{id}`.

Constaté le 2026-11-15 : `GET /v1.0/devices/{id}` renvoie bien `local_key` (16 caractères) ; protocole 3.5 ; l'adresse et la version peuvent être passées à `tools/tuya-local-test.py` par les variables d'environnement `TUYA_LOCAL_IP` et `TUYA_LOCAL_VERSION` (non secrètes). Un second appareil répond sur le port 6668 (192.168.0.9), non identifié.

## Décision


## Protocole local 3.5 en JavaScript (lot C1)

Date : 2026-11-15. Source unique : le code de **tinytuya 1.21.1** (MIT) installé sur le PC (`python -m pip show tinytuya`), lu localement, dossier `tinytuya/core/`. Rien n'est repris d'ailleurs. Implémentation : `local/tuya-local.js` (Web Crypto seulement). Preuve : `tests/tuya-local.test.mjs` contre `tests/tuya-local-vecteurs.json`, produit par `tools/gen-vecteurs-tuya-local.py` (tinytuya fabrique les trames avec une clé factice et des aléas fixés ; les réponses du « câble » y sont fabriquées avec `pack_message` puis relues par `unpack_message` et `_decode_payload`). Le JS envoie et relit exactement les mêmes octets. **Tout ce qui suit est vérifié contre tinytuya, pas encore contre le vrai câble (lot C2).**

| Élément | Valeur reprise | Origine (tinytuya 1.21.1) |
|---|---|---|
| Format de trame 3.5 | en-tête 18 octets `>IHIII` : préfixe `0x00006699`, 2 octets nuls, séquence, commande, longueur ; puis IV (12) + chiffré + étiquette GCM (16) ; pied `0x00009966`. Longueur = 12 + clair + 16 | `core/header.py` (`MESSAGE_HEADER_FMT_6699`, `PREFIX_6699_*`, `SUFFIX_6699_*`), `core/message_helper.py` : `pack_message`, `parse_header`, `unpack_message` |
| Chiffrement d'une trame | AES-128-GCM, IV aléatoire de 12 octets placé dans la trame, AAD = en-tête sans le préfixe (14 octets), étiquette de 128 bits | `core/crypto_helper.py` : `encrypt` / `decrypt` (`iv`, `header`, `tag`) |
| Code de retour | le clair d'une trame **reçue** commence par 4 octets de code de retour (retirés) ; celui d'une trame envoyée n'en a pas | `message_helper.unpack_message` (`no_retcode=False`), `pack_message` (`retcode` seulement si entier) |
| Numéros de commande | 3 négociation (début), 4 réponse, 5 fin ; 0x0d écriture (`CONTROL_NEW`) ; 0x10 lecture (`DP_QUERY_NEW`) ; 8 annonce d'état (ignorée) | `core/command_types.py` |
| Négociation, étape 1 | cmd 3, nonce local de 16 octets, chiffré avec la clé locale, sans en-tête de version | `XenonDevice._negotiate_session_key_generate_step_1`, `header.NO_PROTOCOL_HEADER_CMDS` |
| Négociation, étape 2 | cmd 4 : nonce du câble (16) + HMAC-SHA256(clé locale, nonce local) (32) ; le client vérifie le HMAC | `_negotiate_session_key_generate_step_3` |
| Négociation, étape 3 | cmd 5 : HMAC-SHA256(clé locale, nonce du câble) ; aucune réponse lue | `_negotiate_session_key_generate_step_3`, `_negotiate_session_key` |
| Clé de session | AES-GCM(clé locale, IV = 12 premiers octets du nonce local, sans AAD) de (nonce local XOR nonce câble) ; on garde les 16 premiers octets du chiffré (`[12:28]`) | `_negotiate_session_key_generate_finalize` |
| Numéro de séquence | compteur du client, démarre à 1, +1 par trame envoyée (négociation comprise) ; les réponses du câble portent leur propre compteur | `XenonDevice.__init__` (`seqno = 1`), `_encode_message` |
| Lecture | cmd 0x10, corps `{}`, sans en-tête de version ; réponse lue en `dps` ou `data.dps` | `generate_payload` (`payload_dict["v3.5"]`, `DP_QUERY` -> `DP_QUERY_NEW`), `_decode_payload` |
| Écriture | cmd 0x0d ; corps JSON compact `{"protocol":5,"t":<secondes>,"data":{"dps":{"151":"<texte JSON>"}}}` précédé de l'en-tête de version `3.5` + 12 octets nuls | `payload_dict["v3.5"]` (`CONTROL` -> `CONTROL_NEW`), `generate_payload` (espaces retirés), `Device.set_value`, `_encode_message` |
| Émulation Web Crypto | **aucune nécessaire** : tout passe par AES-GCM et HMAC-SHA256 de Web Crypto (la dérivation de la clé de session utilise AES-GCM, pas AES-ECB) | |

Choix du module, non fournis par tinytuya : nombre de relectures (3, précédées de pauses de 0,5 s, 1,5 s puis 2,5 s), accusé d'écriture attendu 2 s au plus (son absence n'est pas une erreur, la relecture décide), échéance globale de 20 s.

**À confirmer sur le vrai câble (lot C2)** : forme exacte de l'accusé d'écriture et des annonces d'état (le faux câble en suppose : un accusé cmd 0x0d vide, puis une annonce cmd 8) ; forme de la réponse de lecture (`dps` ou `data.dps`, avec ou sans en-tête de version : le module accepte les trois) ; comportement d'un câble qui reçoit une négociation avec une mauvaise clé (le module conclut `cle` sur trame refusée ou connexion fermée, mais `delai` si le câble se tait) ; comportement du câble quand Smart Life est ouverte sur le même câble ; délai réel de répercussion de l'écriture (trois relectures espacées de 0,5, 1,5 et 2,5 s suffisent-elles ?) ; adresse IPv4 réservée dans la box.

## Recherche automatique du câble (lot C2, partie code, 2026-11-17)

Source : code et tests (`local/recherche.js`, `tests/tuya-local-recherche.test.mjs`), faux réseau seulement ; **rien n'est encore vérifié sur le vrai réseau**.

- Ordre des adresses : `TUYA_LOCAL_IP`, puis `tools/releves/cable-adresse.json` (adresse seule, ignorée si absente, corrompue ou non privée), puis /24 des interfaces IPv4 privées du PC.
- Une adresse n'est retenue que si `lireEtat()` y réussit (négociation de la clé) ; port 6668 ouvert (sonde 400 ms, 32 en parallèle) ne suffit pas. Zéro ou plusieurs câbles : `hors_ligne`. Échéance globale 30 s. La recherche ne lit ni n'écrit rien d'autre.
- **À vérifier sur le vrai réseau** : durée d'un balayage /24 réel sous Windows (profil Public, pare-feu) ; le câble tolère-t-il une sonde TCP ouverte puis fermée sans données, suivie de la négociation ; comportement d'un autre appareil au port 6668 ; cas du VPN ou des cartes virtuelles (/24 en plus).

## Coque Android : lot C3 (code écrit le 2026-11-19, rien n'est encore construit ni essayé)

Source de chaque ligne : pages de developer.android.com lues le 2026-11-19, sauf mention. **Aucun de ces éléments n'est encore éprouvé : le premier passage de GitHub Actions (`.github/workflows/android.yml`) le fera.** Le PC n'a ni JDK, ni SDK, ni émulateur.

| Élément | Valeur retenue | Source |
|---|---|---|
| Android Gradle plugin | 9.5.1 (Gradle 9.6.0 au moins, JDK 17, Build Tools 36.0.0, API 37 au plus) | `build/releases/gradle-plugin` |
| Kotlin | intégré à AGP depuis 9.0 : aucun plugin `org.jetbrains.kotlin.android` (il ferait échouer la construction) ; Kotlin Gradle plugin 2.2.10 livré avec AGP 9.0 (la version exacte de 9.5.1 n'est pas indiquée) | `build/migrate-to-built-in-kotlin`, notes de AGP 9.0 |
| DSL | nouvelle DSL (par défaut en 9.0) : `assets.directories` remplace `srcDirs` (déprécié) | `reference/tools/gradle-api/9.0/.../AndroidSourceDirectorySet` |
| androidx.webkit | 1.18.0, stable du 2026-10-21 | `jetpack/androidx/releases/webkit` |
| JUnit | 4.13.2 : **numéro non donné par la doc Android** (elle montre `testImplementation "junit:junit:$jUnitVersion"`) ; dernière version de JUnit 4 d'après mes connaissances, à confirmer par la résolution Maven | `training/testing/local-tests` |
| Pont | `WebViewCompat.addWebMessageListener(webView, nom, Set<String> règlesOrigine, listener)` ; règle `https://appassets.androidplatform.net` ; `onPostMessage(WebView, WebMessageCompat, Uri origine, boolean isMainFrame, JavaScriptReplyProxy)` ; côté page `PontLocal.postMessage(chaîne)` et `PontLocal.onmessage = e => e.data` ; **`JavaScriptReplyProxy` est `@UiThread`** : les réponses repartent par le fil principal | `reference/androidx/webkit/WebViewCompat`, `JavaScriptReplyProxy`, `WebMessageCompat` |
| Fichiers servis | `WebViewAssetLoader.PathHandler.handle(String)` (suffixe après `/assets/`, `null` = repli sur le réseau, `new WebResourceResponse(null,null,null)` = 404) ; domaine par défaut `appassets.androidplatform.net` ; `AssetsPathHandler` déduit le type MIME par `URLConnection.guessContentTypeFromName` : remplacé par un gestionnaire maison au type fixé (les modules ES exigent un type JavaScript) | `reference/androidx/webkit/WebViewAssetLoader`, `.PathHandler`, `.AssetsPathHandler` |
| Réseau | `ConnectivityManager.registerNetworkCallback(NetworkRequest, NetworkCallback)` avec `NetworkRequest.Builder().addTransportType(TRANSPORT_WIFI)` ; `Network.bindSocket(Socket)` (socket non connecté) ; `getLinkProperties(network).linkAddresses` ; permission `ACCESS_NETWORK_STATE` | `reference/android/net/Network`, `NetworkRequest.Builder`, `ConnectivityManager` |
| Thème | `@android:style/Theme.DeviceDefault.DayNight` existe (« DeviceDefault theme for day/night activities ») ; **le suivi de `prefers-color-scheme` par la WebView n'est pas vérifié par la doc** (à voir sur les captures) | `reference/android/R.style` |
| Sauvegardes | `android:allowBackup="false"` + `android:dataExtractionRules` (`cloud-backup` et `device-transfer`, `exclude domain=… path="."`) | `identity/data/autobackup` |
| FLAG_SECURE | `Window.setFlags(FLAG_SECURE, FLAG_SECURE)` / `clearFlags` | `reference/android/view/WindowManager.LayoutParams` |
| Émulateur | `-no-window`, `-gpu swiftshader_indirect`, `-no-snapshot`, `-noaudio`, `-no-boot-anim`, `-timezone`, `-netfast`, `-accel on` existent ; **`-no-metrics` n'est pas dans la page : non utilisé** ; `avdmanager create avd -n -k [-f]`, `list device -c` (l'option `-d` n'est pas dans la page) ; la page signale `avdmanager` et `emulator` comme dépréciés au profit de la CLI `android` : non adoptée (script maison décidé le 2026-11-19) | `studio/run/emulator-commandline`, `studio/command-line/avdmanager` |
| KVM sur runner | règle udev `KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"` puis `udevadm control --reload-rules` et `udevadm trigger --name-match=kvm` ; valable pour les runners Linux de 2 vCPU | github.blog, changelog du 2024-04-02 |
| Écran Pixel 9 et Pixel 10 | **identiques** : 6,3 pouces, 1080 x 2424, 422 ppi (densité d'AVD 420) : un seul profil | `support.google.com/pixelphone/answer/7158570`, fiches `store.google.com` (via recherche) |
| Réseau de l'émulateur | l'hôte est joignable en `10.0.2.2` : décrit par la documentation de l'émulateur (page « Set up Android Emulator networking », **non relue ce jour**, connaissance générale) ; le comportement des adresses `10.0.2.x` inoccupées (délai ou refus) est à observer | à confirmer au premier passage |
| Actions GitHub (empreintes de commit, API des références git de chaque dépôt officiel) | `actions/setup-java` v6.3.0 `d1374f8ac74474200d16ef8ecee22c7ae7a51880` ; `actions/upload-artifact` v7.0.2 `cf430e030ddbb5b0abf93d22962f4752f3646cd9` ; `actions/download-artifact` v8.0.2 `9000827ccba6bdab643e8b6fd33ac0654aef8333` ; `gradle/actions` v6.4.1 (étiquette annotée) `8da46b539cd8fe6ab27ca75128919a18d757604c` ; `checkout` v7.0.1 et `setup-node` v7.1.0 : empreintes déjà dans `pages.yml`, revérifiées | `api.github.com/repos/<dépôt>/git/ref/tags/<étiquette>` |

**Contrat du pont** (messages JSON, un entier `n` pour associer la réponse) : voir l'en-tête de `android/essai/transport-pont.js`. Opérations : `demarrage`, `variante`, `prefixeWifi`, `cable`, `saisirCle`, `sonder`, `ouvrir`, `envoyer`, `recevoir`, `fermer`. Le filtre Kotlin (`FiltreReseau.kt`) est testé en JUnit ; le client JavaScript est testé sous Node contre un pont simulé (`tests/essai-pont.test.mjs`).

**Écarts à signaler** : (1) la clé du câble est lue par la page au moment de chaque action (opération `cable`) parce que le protocole écrit en JavaScript en a besoin ; elle n'est jamais stockée, affichée ni journalisée par la page (test), mais « jamais gardée par la page » de la décision du 2026-11-18 n'est tenu qu'au sens « jamais conservée entre deux actions » ; (2) `ouvrir` et `sonder` acceptent un port ou une adresse quelconque et les refusent (`refuse`) : c'est ce qui permet de prouver le refus sur émulateur ; (3) les actions de mise au point (`am start --es action …`) n'existent que dans la version de mise au point.

**À lever au premier passage de GitHub Actions** : résolution des dépendances et acceptation de la nouvelle DSL (`assets.directories`, `lint { checkReleaseBuilds }`), compilation Kotlin, tests JUnit ; présence de l'image `system-images;android-36;google_apis;x86_64` ; profil `pixel_9` dans `avdmanager list device -c` ; arbre `uiautomator dump` de l'écran natif (identifiants `fr.rechargeds3.coque:id/champ_id`, `champ_cle`, `bouton_enregistrer`) ; adresse 10.0.2.2 vers le faux câble ; `Network.bindSocket` sur le réseau Wi-Fi de l'émulateur ; thème sombre vu par la page ; liste des fichiers de `assets/` de l'APK (profils `assets/dexopt/` ignorés) ; liste des permissions de l'APK (la permission interne `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` d'androidx.core est tolérée).
