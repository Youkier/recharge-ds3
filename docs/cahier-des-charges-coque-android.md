# Cahier des charges : coque Android, pilotage local (phase 3b)

Rédigé le 2026-11-15. Les lots et les critères d'acceptation sont repris dans `PLAN.md`, phase 3b. Les règles de `CLAUDE.md` s'appliquent ; les deux exceptions demandées sont au § 9.

## 0. État final (E4, 2026-11-22) : ce qui a remplacé l'architecture ci-dessous

Les §§ 3 à 7 décrivent le plan d'origine (protocole en JavaScript embarqué, pont TCP générique). Depuis les décisions des 2026-11-21 et 2026-11-22, l'appli est la suivante ; en cas de contradiction, ce paragraphe fait foi.

- **Le protocole local n'a qu'une implémentation dans l'appli, en Kotlin** (`android/.../cable/` : négociation 3.5, lecture, écriture de `ss`, `se` et `m` du dp 151, relecture, démarrage tardif). `local/tuya-local.js` n'est plus embarqué : il reste pour l'outil PC (`tools/tuya-local.mjs`), aligné sur le même contrat (`{ allumage, fin, duree_min, depart }` ou `{ desactiver, fin }`).
- **Plus de pont TCP générique.** La page ne dispose que d'opérations fermées (`RoutesPont.kt`, testée) : lire, programmer, chercher, état de la configuration, saisie de la clé, notifications et attente (`attenteDebut`, `attenteEtat`, `attenteAnnuler`, `attenteAcquitter`). La clé et l'identifiant ne traversent jamais la WebView. Seul `TransportTcp` ouvre une connexion (IPv4 privée, port 6668).
- **Une seule instance d'`OperationsCable` et de `PiloteAttente` par processus** (`ProprietaireCable`), partagées par l'activité (singleTask) et le service.
- **L'attente est tenue par le natif** : `PiloteAttente` (hébergé par le service de premier plan `AttenteWifi`) attend le Wi-Fi de la maison puis le câble (lecture toutes les 5 s, recherche après 60 s de silence, 10 min au plus), envoie avec une seule règle « jamais de second envoi après une écriture », persiste son état dans un fichier privé sans secret et notifie (textes fixes, début et fin à régler à la main en cas d'échec). La page n'est qu'une vue. Balayer l'appli n'annule rien ; « Annuler » n'agit qu'avant l'envoi ; une attente dont le processus a été tué est signalée au lancement suivant.
- **Un seul fichier de cas pour la règle « heure passée »** : `tests/plage-tardif-cas.json`, lu par le Worker, la coque et `local/`.
- Version de mise au point seulement : `android/essai/` (page d'essai), débogage de la WebView, actions par adb, durée d'attente raccourcie (`attente_max_s`), journal du pilote (lignes « ESSAI », sans secret ni adresse).

## 1. But

Sur le Pixel de Mathieu, la page personnelle avec un bouton « Programmer la charge » qui règle le câble **par le Wi-Fi de la maison**, sans cloud Tuya, sans Worker et sans internet.

- **Pour l'usage personnel :** ne plus dépendre de l'essai gratuit IoT Core de Tuya (échéance du 2026-12-11, prolongations de 6 mois non garanties).
- **Pour le volet produit :** c'est le prototype de l'option B. Rien n'est publié : un fichier APK installé par câble USB, pas de Play Store, pas de paiement.

Le Worker et le réglage manuel dans Smart Life restent disponibles (règle n°2).

## 2. Ce qui est déjà prouvé, et ce qui ne l'est pas

| Point | État | Source |
|---|---|---|
| Le câble accepte le protocole local Tuya **3.5** sur le port TCP 6668 (3.4 refusé) | Prouvé depuis le PC, en Python (L2) | `docs/tuya-findings.md` |
| Lecture et écriture locales du dp 151 (`x_charge_mode`), charge démarrée à l'heure | Prouvé depuis le PC (L3) | idem |
| Écriture locale sans internet | **Non testé** (L4) | idem |
| Protocole 3.5 écrit en JavaScript avec Web Crypto | **À prouver** (lot C1) | |
| Connexion TCP au câble depuis une appli Android sur le Pixel | **À prouver** (lot C3) | |
| Le câble accepte une connexion locale quand Smart Life est ouverte ailleurs | Inconnu, à observer | |

Le protocole local n'a pas de documentation Tuya. La référence est le code de tinytuya (https://github.com/jasonacox/tinytuya, licence MIT), déjà utilisé par `tools/tuya-local-test.py`. **Rien n'est inventé** : chaque élément du protocole repris (en-tête, négociation de la clé de session, chiffrement, numéros de commande) est noté dans `docs/tuya-findings.md` avec le fichier de tinytuya d'où il vient, puis confirmé sur le câble.

## 3. Architecture retenue

```
local/
  tuya-local.js        protocole 3.5 et les deux actions, JavaScript pur, sans dépendance
  transport-node.mjs   connexion TCP pour Node (node:net), pour les essais depuis le PC
tools/
  tuya-local.mjs               ligne de commande : etat, ecrire-debut, desactiver (charge tools/.env lui-même)
  gen-vecteurs-tuya-local.py   produit les vecteurs de test avec tinytuya et une clé factice
tests/
  tuya-local.test.mjs          vecteurs + faux câble simulé
  tuya-local-vecteurs.json
android/                       projet Gradle : une activité, une WebView, un pont TCP
```

**Trois choix, à consigner dans `docs/decisions-produit.md` :**

1. **Le protocole est écrit une seule fois, en JavaScript**, et tourne à l'identique dans Node (essais depuis le PC, tests automatiques) et dans la WebView du téléphone. Il est donc vérifié sur le vrai câble avant que le moindre outil Android soit installé.
2. **Coque native minimale, sans Capacitor ni autre cadre** : une activité Kotlin, une WebView qui affiche une copie de `site/` embarquée dans l'APK, et un pont qui ouvre une connexion TCP. Moins de dépendances à tenir à jour, plus proche de la règle n°7.
3. **Le pont ne sait faire qu'une chose : une connexion TCP vers une adresse IPv4 privée, port 6668.** Toute la logique (quoi lire, quoi écrire, quoi refuser) reste dans `local/tuya-local.js`, couverte par les tests Node.

**Repli si le lot C1 bute sur Web Crypto** (primitive absente, par exemple AES-ECB) : s'arrêter et en parler. Deux sorties possibles : chiffrement fait par le pont natif, ou protocole entier en Kotlin avec un pont à deux actions.

## 4. Le module `local/tuya-local.js`

**Interface de transport**, fournie par l'appelant :

```
ouvrir(ip, port, delaiMs) · envoyer(octets) · recevoir(delaiMs) → octets · fermer()
```

**Ce que le module expose, et rien d'autre** (règle n°9, pas d'envoi de commande quelconque) :

| Fonction | Effet |
|---|---|
| `lireEtat(cfg, transport)` | Lit le dp 151 et renvoie `{ debut, fin, plage_active }` |
| `programmer(cfg, transport, { allumage: "HH:MM" })` | Écrit le début de plage, plage activée |
| `programmer(cfg, transport, { desactiver: true })` | Plage courte : début = fin relue moins une minute, plage activée |

`cfg` = `{ ip, deviceId, cleLocale, version: "3.5" }`.

**Mêmes garanties que le Worker** (`worker/src/service.js`, contrat de `PLAN.md` phase 2a) :

- N'écrit **que** `ss`, `se` et `m` du dp 151 (`se` ajouté le 2026-11-22, règle 9 élargie). Jamais `dt`, le courant, ni un autre point de données.
- Avant d'écrire : relit la valeur, vérifie que c'est un objet aux clés exactes `m`, `dt`, `ss`, `se`, avec des heures valides. Sinon, **rien n'est envoyé**.
- Heure validée au format strict `HH:MM`. Demande `{ allumage, fin, duree_min, depart }` ou `{ desactiver, fin }`. Heure déjà passée ou dans moins de 10 min (décision du 2026-11-22, remplace le démarrage immédiat) : démarrage tardif, début = maintenant + 10 min, fin = min(début + durée, départ), signalé par `tardif: true` ; départ trop proche : erreur `trop_tard`, rien n'est écrit. Fuseau Europe/Paris, quel que soit le réglage du téléphone.
- Après l'écriture : relecture. Succès seulement si la valeur relue est celle demandée et qu'aucun autre point de réglage n'a changé (mêmes points volatils ignorés que dans `tools/tuya-local-test.py`).
- **Réponses au même format que le Worker**, pour que `interpreterReponse()` de `site/service.js` et les alertes OK / KO servent telles quelles :
  - succès : `{ ok: true, debut, fin, plage_active, tardif, courte }` ;
  - échec : `{ ok: false, erreur }` avec `hors_ligne` (connexion impossible), `delai`, `relecture_differente`, `trop_tard`, et deux codes nouveaux : `cle` (négociation ou déchiffrement refusés : clé fausse ou câble réappairé) et `format` (valeur du câble inattendue, rien n'a été écrit).
- Une seule connexion à la fois, fermée dans tous les cas. Délai global de 20 s, comme le Worker.
- La clé n'apparaît jamais dans un message d'erreur, un journal ou une exception.

## 5. La coque `android/`

- Kotlin, une seule activité, pas de bibliothèque d'interface. Dépendances limitées au strict nécessaire (chargement de fichiers embarqués par la WebView), versions figées, dépôts `google()` et `mavenCentral()` seulement.
- **Contenu affiché :** une copie de `site/` placée dans l'APK par la construction, servie à la WebView sous une adresse `https` interne (mécanisme à vérifier sur `developer.android.com`), pour que les modules ES, `localStorage` et Web Crypto fonctionnent. La construction vérifie que les fichiers copiés sont identiques à ceux de `site/` (empreintes), ce qui couvre le critère « toute application Android reproduit `tests/golden-cases.json` ».
- **WebView verrouillée :** aucun contenu distant chargé, toute navigation hors de l'adresse interne s'ouvre dans le navigateur, accès aux fichiers désactivé, débogage de la WebView désactivé hors version de mise au point, CSP de la page conservée.
- **Pont TCP** (`@JavascriptInterface` ou canal de messages) : `ouvrir`, `envoyer`, `recevoir`, `fermer`, octets échangés en base64. Il refuse tout port autre que 6668 et toute adresse qui n'est pas une IPv4 privée (10/8, 172.16/12, 192.168/16). Une seule connexion ouverte. Délais sur chaque opération.
- **Permission réseau local.** Depuis Android 17, une appli qui cible le SDK 37 doit déclarer et demander `ACCESS_LOCAL_NETWORK` ; sans elle, une connexion TCP locale échoue par dépassement de délai, ce qui ressemble à un câble hors ligne. Source : https://developer.android.com/privacy-and-security/local-network-permission. À relire avant de fixer le SDK cible ; l'appli doit distinguer « permission refusée » de « câble injoignable ».
- **Clé locale et identifiant du câble :** saisis une fois par Mathieu dans la vue Paramètres de la coque (champ masqué, jamais réaffiché), stockés chiffrés par le magasin de clés d'Android, hors des sauvegardes (`allowBackup="false"`). Ils ne passent jamais par Claude, ni par le dépôt, ni par un journal. Un bouton « Effacer la clé ».
- **Adresse du câble :** saisie une fois, puis **recherche automatique en secours** si elle ne répond plus (décision du 2026-11-17, `docs/decisions-produit.md`) : port 6668 sur le réseau /24 de l'adresse connue, par le même pont, câble confirmé par sa clé ; la nouvelle adresse est enregistrée. Pas de réservation dans la box.
- **Signature :** une clé de signature stable, créée sur le PC de Mathieu et gardée **hors du dépôt**. Sans elle, chaque nouvelle version obligerait à désinstaller l'appli, donc à ressaisir la clé du câble.
- Version minimale d'Android : celle du Pixel 9 suffit.

## 6. Intégration à la page (lot C4)

Jusqu'au lot C3, **`site/` n'est pas modifié** : la coque affiche une page d'essai à part (`android/essai/`).

Au lot C4, changement minimal et gardé dans `site/` : si le pont est présent (`window.PontLocal`), la vue Paramètres propose un mode « Local (Wi-Fi de la maison) » à côté du mode « Service ». Sans pont (navigateur, GitHub Pages), la page se comporte exactement comme aujourd'hui, ce qu'un test vérifie.

- Mode Local : le bouton appelle `programmer()` du module local au lieu du service. Mêmes libellés, mêmes alertes, même rappel de l'heure à régler à la main en cas d'échec.
- Messages propres au local : « Connectez le téléphone au Wi-Fi de la maison » (`hors_ligne`), « Clé du câble refusée : le câble a peut-être été réappairé » (`cle`), « Autorisez l'accès au réseau local » (permission).
- Pas de bascule automatique et silencieuse vers le service : un échec local affiche l'alerte KO, avec un bouton « Envoyer par le service » si celui-ci est configuré.
- Le lot C4 attend que le critère « une semaine d'usage réel » de la phase 2c soit validé, ou l'accord explicite de Mathieu.

## 7. Tests

- **Vecteurs** (`tests/tuya-local-vecteurs.json`) produits par tinytuya avec une clé factice et des aléas fixés : trames de négociation, lecture, écriture. Le module doit produire et relire exactement ces octets. Aucune vraie clé, aucun identifiant réel dans le dépôt.
- **Faux câble** en JavaScript (transport simulé) : négociation réussie ; clé fausse ; délai dépassé ; valeur au format inattendu (rien n'est écrit) ; relecture différente ; autre point modifié pendant l'écriture ; heure déjà passée ; plage courte ; trame coupée en deux ; deux réponses dans la même trame.
- **Garde-fous** : un test échoue si le module peut écrire un autre point que le dp 151, ou une autre clé que `ss` et `m`.
- **Pont** : tests unitaires Kotlin sur le filtre d'adresses et de port.
- Tout passe par `node --test "tests/**/*.test.mjs"`, donc par le contrôle avant publication existant.

## 8. Lots et points d'arrêt

| Lot | Contenu | Qui | Point d'arrêt |
|---|---|---|---|
| C1 | `local/tuya-local.js`, transport Node, vecteurs, faux câble, tests | Claude Code seul | Primitive absente de Web Crypto : arrêt |
| C2 | Essai réel depuis le PC : `node tools/tuya-local.mjs etat`, puis `ecrire-debut HH:MM` en simulation, puis `--confirmer` à +5 min, voiture branchée. Résultats comparés à L2 et L3 | Claude Code lance, Mathieu valide chaque commande | Lecture ou écriture refusée : arrêt, le script Python reste la référence |
| C3 | Coque minimale et page d'essai « Lire l'état » sur le Pixel | Claude Code ; Mathieu : outils Android, débogage USB, saisie de la clé | **L'essai décisif.** Échec : arrêt, on en parle |
| C4 | Mode Local dans la page, clé chiffrée, alertes, signature stable | Claude Code ; Mathieu teste sur le Pixel | |
| C5 | Deux semaines d'usage réel en mode Local ; L4 et T4 refaits depuis le téléphone, internet coupé | Mathieu | Décision : le Worker reste-t-il en secours ? |

`tools/.env` contient la clé locale : il n'est supprimé qu'après le lot C2 **et** après copie de la clé dans le gestionnaire de mots de passe de Mathieu.

## 9. Ce qu'on attend de Mathieu

1. **Deux exceptions à valider**, à consigner dans `docs/decisions-produit.md` :
   - règle n°7 : un projet Gradle et ses dépendances dans `android/` (rien ne change côté page ni côté Worker) ;
   - règle n°9 : le pont TCP est un canal bas niveau, limité au port 6668 et aux adresses privées ; les deux seules actions restent dans le module.
2. **Réglages de Claude Code** (fichiers protégés, modification soumise à accord) : voir `PLAN.md`, phase 3, « Préparation ».
3. **Avant le lot C2 :** clé locale copiée dans le gestionnaire de mots de passe ; câble joignable depuis le PC (routeur AX55 en mode point d'accès, adresse du câble réservée dans la box).
4. **Avant le lot C3 :** Android Studio installé sur le PC (un dossier `.android` existe déjà : vérifier s'il l'est), débogage USB activé sur le Pixel, création de la clé de signature.
5. **Pendant les lots C2, C3 et C5 :** validation des commandes une par une, saisie de la clé sur le téléphone, constats sur la voiture.

## 10. Sécurité : à ajouter à `SECURITE.md` avant le lot C4

- La clé locale est désormais aussi sur le téléphone. Téléphone perdu : réappairer le câble (nouvelle clé), puis ressaisir.
- La clé de signature de l'APK est un secret du PC : jamais dans le dépôt. Le contrôle avant commit doit refuser `*.jks` et `*.keystore`.
- Un APK n'est installé que s'il a été construit sur le PC de Mathieu à partir du dépôt.
- Relecture sécurité de `local/tuya-local.js` et du pont par `testeur-relecteur`, puis une fois par le modèle le plus capable, avant le lot C4.

## 11. Hors périmètre

Publication sur le Play Store, paiement, récupération de la clé par QR code (attend la réponse de Tuya), découverte du câble sans adresse de départ (la recherche de secours part toujours de l'adresse connue), réglage automatique à l'arrivée sur le Wi-Fi, iPhone, autres modèles de câbles.
