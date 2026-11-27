#!/usr/bin/env bash
# Aides communes des scénarios d'essai de la coque sur émulateur (phase 3b, lot C3.4). Fichier SOURCÉ, jamais lancé seul :
#   scenarios-essentiels.sh   parcours de l'usage (S1 à S17, S22, S21, S13, S14, S10d, captures) ; API 35 et 36 ; bloquant
#   scenarios-atypiques.sh    cas atypiques de la revue UX (S-A à S-I2, S8) ; API 36 ; bloquant sauf S-I2
# Chaque fichier : « set -euo pipefail », APK, SORTIE, GROUPE, puis « . commun.sh ».
#
# Principe (décision du 2026-11-27) : la CI teste le produit, elle ne le compense pas.
#   - MISE EN PLACE avant chaque scénario : Wi-Fi VALIDÉ dans l'émulateur, faux câble (10.0.2.2:6668) JOIGNABLE depuis l'émulateur,
#     appli arrêtée, configuration (clé, adresse) conforme. Un échec de la mise en place est « environnement » : on la retente
#     (3 essais), chaque nouvelle tentative est comptée (tentatives-mise-en-place.txt, synthèse) et au-delà de SEUIL_TENTATIVES la CI échoue.
#   - Les données de l'appli ne sont effacées (pm clear) que si ni la clé ni l'adresse retenues ne sont conformes.
#   - AUCUNE nouvelle tentative dans une vérification : une ligne ESSAI qui ne correspond pas est un échec, à la première lecture.
#
# Le faux câble (tools/faux-cable-tcp.mjs, clé factice) tourne sur 127.0.0.1:6668 du runner ; l'émulateur le joint par 10.0.2.2:6668.
# Rien ne touche le vrai câble. Versions debug seulement : l'action est demandée par `am start --es action ...` (le pont ne la
# transmet jamais en release). La clé et l'identifiant factices sont saisis dans l'écran natif par uiautomator + input ; mémorisés
# chiffrés depuis la v0.3, on ne les ressaisit que pour changer de clé.
# Options du faux câble : --plage, --delai-reponse, --silence-apres-ecriture ; tools/heure-page.mjs donne l'heure que la page calcule.

: "${APK:?commun.sh : APK absent}" "${SORTIE:?commun.sh : SORTIE absent}" "${GROUPE:?commun.sh : GROUPE absent}"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG="fr.rechargeds3.coque"
ACT="$PKG/.MainActivity"
TAG="RechargeEssai"
CLE_OK="CLE-FACTICE-0000"      # = CLE_FACTICE de tools/faux-cable-tcp.mjs
CLE_KO="CLE-FAUSSE-00000"      # 16 caractères, refusée par le faux câble
IDENTIFIANT="ID-FACTICE-0001"
CLE_COURTE="CLE-123"            # 7 caractères : « Enregistrer » reste grisé (S-A)
IDENTIFIANT_KO="ID.INVALIDE"    # le point n'est pas permis dans un identifiant (S-A)
THEME_COURANT="clair"
mkdir -p "$SORTIE"
LIGNES="$SORTIE/lignes-essai.txt"
: > "$LIGNES"
ATTENTE_RESUME="$SORTIE/attente-resume.txt" # résumé de l'attente et mesures de démarrage (TotalTime, délai jusqu'au premier page-etat)
: > "$ATTENTE_RESUME"
# Nouvelles tentatives de MISE EN PLACE (jamais d'une vérification) : une ligne par tentative échouée, comptée à la fin.
TENTATIVES="$SORTIE/tentatives-mise-en-place.txt"
: > "$TENTATIVES"
SEUIL_TENTATIVES="${SEUIL_TENTATIVES:-6}"
# Clé et marque de code de verrouillage tenues dans des fichiers : les scénarios « essayer » tournent dans des sous-shells.
FICHIER_CLE="$SORTIE/cle-enregistree.etat"
MARQUE_PIN="$SORTIE/code-verrouillage.pose"
: > "$FICHIER_CLE"
rm -f "$MARQUE_PIN"
CLE_ENREGISTREE=""
enregistrer_cle() { CLE_ENREGISTREE="$1"; printf '%s' "$1" > "$FICHIER_CLE"; }

FAUX_PID=""
nettoyer() {
  code=$?
  # Toujours laisser les traces, même en cas d'échec.
  adb logcat -d -v raw -s "$TAG:I" > "$SORTIE/logcat-essai.txt" 2> /dev/null || true
  adb logcat -d -b crash > "$SORTIE/logcat-crash.txt" 2> /dev/null || true
  adb exec-out screencap -p > "$SORTIE/derniere-capture.png" 2> /dev/null || true
  adb shell uiautomator dump /sdcard/ui-final.xml > /dev/null 2>&1 && adb exec-out cat /sdcard/ui-final.xml > "$SORTIE/derniere-interface.xml" 2> /dev/null || true
  # Le faux câble peut avoir été relancé dans un sous-shell (essayer) : le PID fait foi dans son fichier.
  [ -f "${PID_FAUX:-/inexistant}" ] && FAUX_PID="$(cat "$PID_FAUX")"
  if [ -n "$FAUX_PID" ]; then kill "$FAUX_PID" 2> /dev/null || true; fi
  if [ -n "${E0_PIN_POSE:-}" ] || [ -f "$MARQUE_PIN" ]; then e0_remettre; fi
  adb shell cmd uimode night no > /dev/null 2>&1 || true
  adb shell settings put system font_scale 1.0 > /dev/null 2>&1 || true # S-J : même en échec, police normale
  ecrire_synthese "$code" || true
  exit "$code"
}
trap nettoyer EXIT

# Synthèse du groupe (fichier et résumé de la tâche GitHub) : niveau d'API, nombre de nouvelles tentatives, échecs, relevés.
ecrire_synthese() { # ecrire_synthese <code de sortie>
  local code="$1" n
  n="$(wc -l < "$TENTATIVES" 2> /dev/null | tr -d ' ' || echo ?)"
  {
    echo "### Scénarios « $GROUPE » (API $(adb shell getprop ro.build.version.sdk 2> /dev/null | tr -d '\r'))"
    echo "- sortie : code $code"
    echo "- nouvelles tentatives de mise en place : **$n** (seuil $SEUIL_TENTATIVES)"
    if [ -s "$TENTATIVES" ]; then sed 's/^/  - /' "$TENTATIVES"; fi
    echo "- scénarios en échec : $(wc -l < "$SYNTHESE" 2> /dev/null | tr -d ' ')"
    if [ -s "$SYNTHESE" ]; then sed 's/^/  - /' "$SYNTHESE"; fi
    echo "- relevés non bloquants : $(wc -l < "$RELEVES" 2> /dev/null | tr -d ' ')"
  } > "$SORTIE/synthese.md" 2> /dev/null || true
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$SORTIE/synthese.md" >> "$GITHUB_STEP_SUMMARY" 2> /dev/null || true; fi
}

# En cas d'échec, l'écran du moment est déposé avec les captures (zéro si l'émulateur ne répond plus).
# Dans un scénario lancé par « essayer » (SCENARIO_COURANT défini), l'échec est consigné dans la synthèse et ne fait sortir que le sous-shell.
SYNTHESE="$SORTIE/synthese-echecs.txt"
: > "$SYNTHESE"
SCENARIO_COURANT=""
RELEVES="$SORTIE/releves-cas-atypiques.txt" # constats non bloquants (comportement à décider par Mathieu)
: > "$RELEVES"
echec() {
  echo "ÉCHEC${SCENARIO_COURANT:+ $SCENARIO_COURANT} : $*" >&2
  if [ -n "$SCENARIO_COURANT" ]; then
    echo "ÉCHEC $SCENARIO_COURANT : $*" >> "$SYNTHESE"
    adb exec-out screencap -p > "$SORTIE/echec-ecran-${SCENARIO_COURANT// /_}.png" 2> /dev/null || true
  else
    adb exec-out screencap -p > "$SORTIE/echec-ecran.png" 2> /dev/null || true
  fi
  exit 1
}

# --- Mise en place (environnement) ---------------------------------------------------------------------------------------------
noter_tentative() { # noter_tentative <scénario> <raison> : une nouvelle tentative de MISE EN PLACE (jamais d'une vérification)
  echo "$(date +%T) $1 : $2" >> "$TENTATIVES"
  echo "NOUVELLE TENTATIVE de mise en place ($1) : $2" >&2
}
# Wi-Fi de l'émulateur connecté ET validé par Android (accès à Internet vérifié). Format de dumpsys non reconnu : état de « cmd wifi ».
wifi_valide() {
  local c lignes
  # WIFI_VALIDE_REQUIS=0 : se contenter de « connecté » (si l'émulateur ne pouvait pas valider l'accès Internet sur un runner donné).
  if [ "${WIFI_VALIDE_REQUIS:-1}" = 0 ]; then adb shell cmd wifi status 2> /dev/null | tr -d '' | grep -q 'Wifi is connected'; return; fi
  c="$(adb shell dumpsys connectivity 2> /dev/null | tr -d '\015' || true)"
  lignes="$(grep 'NetworkAgentInfo' <<< "$c" | grep 'WIFI' || true)"
  if [ -n "$lignes" ]; then grep -q 'VALIDATED' <<< "$lignes"; return; fi
  adb shell cmd wifi status 2> /dev/null | tr -d '\015' | grep -q 'Wifi is connected'
}
# Faux câble joignable DEPUIS l'émulateur (10.0.2.2:6668) : connexion sans donnée (une « sonde » pour le faux câble), prouvée par
# la ligne « connexion ouverte » de son journal (le code de sortie de nc n'est pas fiable). nc absent de l'image : relevé, barrière passée.
NC_VU=""
cable_joignable() {
  local avant apres
  if [ -z "$NC_VU" ]; then
    if adb shell 'command -v nc' > /dev/null 2>&1; then NC_VU=oui; else NC_VU=non; releve "barrière : nc absent de l'image, joignabilité du faux câble non vérifiée depuis l'émulateur"; fi
  fi
  [ "$NC_VU" = oui ] || return 0
  avant="$(connexions_ouvertes_log)"
  timeout 15 adb shell 'nc -w 3 10.0.2.2 6668 < /dev/null' > /dev/null 2>&1 || true
  sleep 1
  apres="$(connexions_ouvertes_log)"
  [ "$apres" -gt "$avant" ]
}
# Barrière : Wi-Fi validé (60 s au plus), puis faux câble joignable (5 essais espacés de 2 s : le temps de l'écoute).
barriere() {
  local i
  for i in $(seq 1 20); do
    if wifi_valide; then break; fi
    if [ "$i" = 20 ]; then echo "barrière : Wi-Fi de l'émulateur non validé après 60 s" >&2; return 1; fi
    sleep 3
  done
  for i in 1 2 3 4 5; do
    if cable_joignable; then return 0; fi
    sleep 2
  done
  echo "barrière : faux câble 10.0.2.2:6668 injoignable depuis l'émulateur" >&2
  return 1
}
# Barrière seule, entre deux scénarios enchaînés (parcours essentiel) : 3 essais comptés, puis échec classé « environnement ».
barriere_lineaire() { # barriere_lineaire <scénario>
  local essai
  for essai in 1 2 3; do
    if barriere; then return 0; fi
    noter_tentative "$1" "barrière non franchie (essai $essai/3)"
    sleep 5
  done
  echec "ENVIRONNEMENT : barrière de mise en place non franchie avant $1 (Wi-Fi validé et faux câble joignable)"
}
# État de l'appli et de l'émulateur remis à zéro, SANS toucher aux données de l'appli.
remettre_environnement() {
  adb shell svc wifi enable > /dev/null 2>&1 || true
  adb shell cmd uimode night no > /dev/null 2>&1 || true
  THEME_COURANT="clair"
  adb shell settings put system font_scale 1.0 > /dev/null 2>&1 || true
  e0_remettre
  adb shell am force-stop "$PKG" > /dev/null 2>&1 || true
  lancer_faux
  [ -f "${PID_FAUX:-/inexistant}" ] && FAUX_PID="$(cat "$PID_FAUX")"
  return 0
}
# Clé factice enregistrée ET adresse du faux câble retenue : l'appli peut être relancée telle quelle (sans pm clear).
configuration_conforme() {
  [ "$(cat "$FICHIER_CLE" 2> /dev/null || true)" = "$CLE_OK" ] || return 1
  grep -q 'name="adresse">10.0.2.2<' <<< "$(fichier_cable)"
}
configurer_appli() {
  if configuration_conforme; then echo "mise en place : clé et adresse conformes, données conservées"; return 0; fi
  oublier_donnees
  demarrer_page "$CLE_OK"
  page_prete "mise en place"
}
# mise_en_place <scénario> [neuf] : état de l'environnement, barrière, configuration de l'appli (omise avec « neuf » : le scénario
# efface lui-même les données). Rend 1 si elle reste impossible après 3 essais (classe « environnement »).
mise_en_place() {
  local nom="$1" mode="${2:-}" essai rc
  for essai in 1 2 3; do
    set +e
    ( SCENARIO_COURANT=""; set -e; remettre_environnement; barriere; [ "$mode" = neuf ] || configurer_appli )
    rc=$?
    set -e
    CLE_ENREGISTREE="$(cat "$FICHIER_CLE" 2> /dev/null || true)" # le sous-shell a pu changer la clé
    [ "$rc" = 0 ] && return 0
    noter_tentative "$nom" "mise en place échouée (essai $essai/3)"
    [ "$essai" = 3 ] || sleep 5
  done
  return 1
}
mise_en_place_ou_echec() { mise_en_place "$@" || echec "ENVIRONNEMENT : mise en place impossible avant $1"; }

# releve_echec <nom> <fonction> [neuf] : scénario non bloquant (relevé seulement) ; même isolation et même mise en place que essayer.
releve_echec() {
  local nom="$1" fonction="$2" rc=0
  if ! mise_en_place "$nom" "${3:-}"; then releve "$nom : mise en place impossible (environnement), scénario non lancé"; return 0; fi
  set +e
  ( SCENARIO_COURANT=""; set -e; "$fonction" )
  rc=$?
  set -e
  [ "$rc" = 0 ] || releve "$nom : échec NON bloquant (voir le journal et les artefacts)"
}

# essayer <nom> <fonction> [neuf] : mise en place, puis le scénario dans un sous-shell ; son échec est consigné (« ÉCHEC <nom> : … ») et le suivant passe.
essayer() {
  local nom="$1" fonction="$2" rc=0
  if ! mise_en_place "$nom" "${3:-}"; then
    echo "ÉCHEC $nom : ENVIRONNEMENT, mise en place impossible après 3 essais (scénario non lancé)" | tee -a "$SYNTHESE" >&2
    return 0
  fi
  set +e
  ( SCENARIO_COURANT="$nom"; set -e; "$fonction" )
  rc=$?
  set -e
  if [ "$rc" != 0 ]; then
    # Échec par une commande sans « echec » (set -e) : consigné aussi, une seule fois.
    grep -q "^ÉCHEC $nom : " "$SYNTHESE" || echo "ÉCHEC $nom : une commande a échoué (code $rc), voir le journal" | tee -a "$SYNTHESE" >&2
    echo "=== $nom : ÉCHEC, scénario suivant (la mise en place le remet en état)"
  fi
}
# Fin de groupe : constats, scénarios en échec, nombre de tentatives. Échoue au-delà du seuil de tentatives, quoi qu'il arrive.
conclure() {
  local n
  n="$(wc -l < "$TENTATIVES" | tr -d ' ')"
  echo
  echo "Constats non bloquants :"
  cat "$RELEVES"
  echo
  echo "Nouvelles tentatives de mise en place : $n (seuil $SEUIL_TENTATIVES)"
  if [ -s "$TENTATIVES" ]; then cat "$TENTATIVES"; fi
  if [ -s "$SYNTHESE" ]; then
    echo
    echo "SCÉNARIOS EN ÉCHEC ($(wc -l < "$SYNTHESE" | tr -d ' ')) :"
    cat "$SYNTHESE"
    # ATYPIQUES_BLOQUANTS=0 : les échecs du groupe « atypiques » ne font pas échouer le job. Le seuil de tentatives, lui, reste bloquant.
    if [ "$GROUPE" != atypiques ] || [ "${ATYPIQUES_BLOQUANTS:-1}" = 1 ]; then exit 1; fi
    echo "(non bloquant : voir synthese-echecs.txt)"
  fi
  if [ "$n" -gt "$SEUIL_TENTATIVES" ]; then
    echo "ÉCHEC : $n nouvelles tentatives de mise en place (seuil $SEUIL_TENTATIVES) : environnement instable, voir tentatives-mise-en-place.txt" >&2
    exit 1
  fi
  echo "TOUS LES SCÉNARIOS « $GROUPE » SONT PASSÉS ($(wc -l < "$LIGNES" | tr -d ' ') lignes ESSAI vérifiées)"
}

etape() { echo; echo "=== $*"; }
# Utilisés dès S12 (et par les cas atypiques) : à définir avant tout scénario.
releve() { echo "RELEVÉ $*" | tee -a "$RELEVES"; }
contient() { grep -F -q -- "$2" <<< "$1"; } # here-string : pas de SIGPIPE avec pipefail
# --- Faux câble ---
node "$RACINE/tools/faux-cable-tcp.mjs" > "$SORTIE/faux-cable.log" 2>&1 &
FAUX_PID=$!
echo "$FAUX_PID" > "$SORTIE/faux.pid"
for i in $(seq 1 50); do
  if ss -Htln "( sport = :6668 )" | grep -q 6668; then break; fi
  sleep 0.2
  if [ "$i" = 50 ]; then cat "$SORTIE/faux-cable.log" >&2; echo "faux câble non démarré" >&2; exit 1; fi
done
echo "faux câble à l'écoute (pid $FAUX_PID)"
connexions_ouvertes_log() { grep -c "connexion ouverte" "$SORTIE/faux-cable.log" || true; }
connexions_fermees_log() { grep -c "connexion fermée" "$SORTIE/faux-cable.log" || true; }
connexions_etablies() { ss -Htn state established "( sport = :6668 )" | wc -l | tr -d ' '; }

# Relance le faux câble avec ces options (aucune : plage 03:30-06:00, réponses immédiates). Les points de données repartent de zéro.
PID_FAUX="$SORTIE/faux.pid"
lancer_faux() {
  local i ancien
  ancien="$(cat "$PID_FAUX" 2> /dev/null || echo "$FAUX_PID")"
  if [ -n "$ancien" ]; then
    kill "$ancien" 2> /dev/null || true
    for i in $(seq 1 25); do ss -Htln "( sport = :6668 )" | grep -q 6668 || break; sleep 0.2; done
  fi
  FAUX_PID=""
  node "$RACINE/tools/faux-cable-tcp.mjs" "$@" >> "$SORTIE/faux-cable.log" 2>&1 &
  FAUX_PID=$!
  echo "$FAUX_PID" > "$PID_FAUX"
  for i in $(seq 1 50); do
    if ss -Htln "( sport = :6668 )" | grep -q 6668; then echo "faux câble relancé (pid $FAUX_PID), options : ${*:-aucune}"; return 0; fi
    sleep 0.2
  done
  echec "faux câble non redémarré (options : $*)"
}
# Câble débranché : le faux câble est arrêté (le Wi-Fi de l'émulateur, lui, reste allumé).
arreter_faux() {
  local p i
  p="$(cat "$PID_FAUX" 2> /dev/null || echo "$FAUX_PID")"
  [ -n "$p" ] && kill "$p" 2> /dev/null || true
  for i in $(seq 1 25); do ss -Htln "( sport = :6668 )" | grep -q 6668 || break; sleep 0.2; done
  FAUX_PID=""
  rm -f "$PID_FAUX"
}
ecritures_log() { grep -c "écriture reçue" "$SORTIE/faux-cable.log" || true; }
contacts_avec_donnees_log() { grep -c "avec données" "$SORTIE/faux-cable.log" || true; }
# --- Outils adb ---
ui_dump() {
  local i
  for i in 1 2 3 4 5 6; do
    if adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; then adb exec-out cat /sdcard/ui.xml; return 0; fi
    sleep 1
  done
  return 1
}

# Centre (x y) de la vue dont le resource-id se termine par « :id/<nom> » ; attend son apparition (20 s au plus).
centre() {
  local nom="$1" xml noeud nombres
  for _ in $(seq 1 20); do
    xml="$(ui_dump || true)"
    noeud="$(printf '%s' "$xml" | grep -o "resource-id=\"[^\"]*:id/${nom}\"[^>]*>" | head -1 || true)"
    if [ -n "$noeud" ]; then
      nombres="$(printf '%s' "$noeud" | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')"
      # shellcheck disable=SC2086
      set -- $nombres
      echo "$(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))"
      return 0
    fi
    sleep 1
  done
  echec "vue « $nom » introuvable à l'écran"
}
toucher() { local c; c="$(centre "$1")"; adb shell input tap $c; }

# Même chose pour un élément de la page (WebView) : uiautomator n'expose pas les id HTML (resource-id vide), seulement
# le texte accessible ; on cherche donc le nœud dont le texte (ou la description, pour un lien à icône comme « Paramètres », dont
# le libellé est un aria-label) COMMENCE par <texte> (ex. « Programmer la charge »).
centre_web() {
  local nom="$1" xml noeud nombres
  for _ in $(seq 1 20); do
    xml="$(ui_dump || true)"
    noeud="$(printf '%s' "$xml" | grep -o -E "<node [^>]* (text|content-desc)=\"${nom}[^>]*>" | head -1 || true)"
    if [ -n "$noeud" ]; then
      nombres="$(printf '%s' "$noeud" | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')"
      # shellcheck disable=SC2086
      set -- $nombres
      echo "$(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))"
      return 0
    fi
    sleep 1
  done
  echec "élément « $nom » de la page introuvable à l'écran"
}
toucher_web() { local c; c="$(centre_web "$1")"; adb shell input tap $c; }

# --- Lecture de l'écran (uiautomator) : le texte de la page se cherche tel quel dans l'arbre, SANS apostrophe (échappée) ---
DUMP=""
attendre_texte_page() { # attendre_texte_page <texte> [délai en s] ; laisse le dernier dump dans DUMP
  local texte="$1" delai="${2:-40}" i
  for i in $(seq 1 "$delai"); do
    DUMP="$(ui_dump || true)"
    if contient "$DUMP" "$texte"; then return 0; fi
    sleep 1
  done
  echec "texte « $texte » absent de l'écran après ${delai} s"
}
chercher_texte_page() { # comme attendre_texte_page, mais rend 1 au lieu d'échouer
  local texte="$1" delai="${2:-40}" i
  for i in $(seq 1 "$delai"); do
    DUMP="$(ui_dump || true)"
    if contient "$DUMP" "$texte"; then return 0; fi
    sleep 1
  done
  return 1
}
ecran_sans() { # ecran_sans <texte> <message d'échec>
  DUMP="$(ui_dump || true)"
  if contient "$DUMP" "$1"; then echec "$2"; fi
}
ecran_avec() { # ecran_avec <texte> <message d'échec> : texte attendu déjà affiché ; 5 lectures (l'arbre de la WebView peut être en retard)
  chercher_texte_page "$1" 5 || echec "$2"
}


# Vrai si une ligne ESSAI de l'action est déjà dans logcat (sans attendre).
# Journal lu d'abord en entier : un « grep -q » en bout de tube pourrait faire échouer le tube (SIGPIPE, pipefail).
ligne_vue() {
  local journal
  journal="$(adb logcat -d -v raw -s "$TAG:I" | tr -d '\015' || true)"
  printf '%s\n' "$journal" | grep '^ESSAI ' | grep -c "\"action\":\"$1\"" > /dev/null
}

# Ouvre l'appli sur la vraie page (site/), sans action adb. La clé n'est saisie que si elle change.
demarrer_page() {
  local cle="${1:-$CLE_OK}"
  adb logcat -c
  adb shell am force-stop "$PKG"
  [ "$cle" != "$CLE_ENREGISTREE" ] && oublier_donnees
  # Mesure (gratuite) : TotalTime de « am start -W » et délai jusqu'au premier page-etat, seulement sans saisie de clé.
  local demarre; demarre="$(date +%s%N)"
  adb shell am start -W -n "$ACT" | tr -d '\r' | grep -E "TotalTime|WaitTime" | tr '\n' ' ' | sed 's/^/DÉMARRAGE /; s/$/\n/' >> "$ATTENTE_RESUME" || true
  if [ -z "$CLE_ENREGISTREE" ]; then saisir_cle "$cle"; enregistrer_cle "$cle"; rm -f "$SORTIE/mesure-page-etat.tmp"; else echo "$demarre" > "$SORTIE/mesure-page-etat.tmp"; fi
}

# Saisie de l'identifiant et de la clé dans l'écran natif, puis « Enregistrer ».
saisir_cle() {
  local cle="$1"
  toucher champ_id;  adb shell input text "$IDENTIFIANT"
  toucher champ_cle; adb shell input text "$cle"
  toucher_apres_defilement bouton_enregistrer
}

# Vue sous le clavier ou hors de l'écran (formulaire dans un ScrollView depuis la v0.3) : uiautomator ne la liste pas.
# On fait défiler vers le bas jusqu'à la voir (4 essais), puis on la touche.
toucher_apres_defilement() {
  local nom="$1" xml taille l h essai
  taille="$(adb shell wm size | tr -d '\r' | grep -o '[0-9]\+x[0-9]\+' | tail -1)"
  l="${taille%x*}"; h="${taille#*x}"
  for essai in 1 2 3 4; do
    xml="$(ui_dump || true)"
    if printf '%s' "$xml" | grep -q "resource-id=\"[^\"]*:id/${nom}\""; then toucher "$nom"; return 0; fi
    adb shell input swipe $(( l / 2 )) $(( h / 2 )) $(( l / 2 )) $(( h / 5 )) 300
    sleep 1
  done
  toucher "$nom"
}

capturer() { adb exec-out screencap -p > "$SORTIE/$1.png"; echo "capture : $1.png"; }

mode_theme() { # clair | sombre
  THEME_COURANT="$1"
  if [ "$1" = "sombre" ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  sleep 2
  echo "thème : $(adb shell cmd uimode night | tr -d '\r')"
}

# Clé actuellement enregistrée dans l'appli (vide : rien d'enregistré).
oublier_donnees() { adb shell pm clear "$PKG" > /dev/null; enregistrer_cle ""; SOC_PAGE=38; }

# Démarre l'application à neuf : demarrer <action|-> [ip] [heure] [clé]. La clé n'est saisie que si elle change.
demarrer() {
  local action="$1" ip="${2:-}" heure="${3:-}" cle="${4:-$CLE_OK}" extras=()
  adb logcat -c
  adb shell am force-stop "$PKG"
  [ "$cle" != "$CLE_ENREGISTREE" ] && oublier_donnees
  [ "$action" != "-" ] && extras+=(--es action "$action")
  [ -n "$ip" ] && extras+=(--es ip "$ip")
  [ -n "$heure" ] && extras+=(--es heure "$heure")
  adb shell am start -W -n "$ACT" "${extras[@]}" | tr -d '\r' | grep -E "TotalTime|WaitTime" | tr '\n' ' ' | sed 's/^/DÉMARRAGE (action) /; s/$/\n/' >> "$ATTENTE_RESUME" || true
  if [ -z "$CLE_ENREGISTREE" ]; then saisir_cle "$cle"; enregistrer_cle "$cle"; fi
}

# Lecture par la page d'essai : UNE seule lecture, vérifiée telle quelle (pas de seconde chance : le premier contact est l'affaire de
# l'appli, pas de la CI ; la barrière de mise en place garantit un environnement prêt).
# lire_essai <ip> : met la ligne ESSAI dans L (pas de sous-shell : le relevé s'écrit sur la sortie).
lire_essai() {
  demarrer lire "$1"
  L="$(attendre_essai lire 60)"
}

# Vrai si l'écran natif de saisie est affiché (sans attendre).
formulaire_affiche() { ui_dump | grep -q ":id/champ_cle\""; }
fichier_cable() { adb shell run-as "$PKG" cat shared_prefs/cable.xml 2> /dev/null | tr -d '\r' || true; }

# Attend la ligne ESSAI de l'action (jusqu'à $2 secondes) et l'affiche (JSON seul).
attendre_essai() {
  local action="$1" delai="${2:-60}" ligne="" i
  for i in $(seq 1 "$delai"); do
    ligne="$(adb logcat -d -v raw -s "$TAG:I" | tr -d '\015' | grep '^ESSAI ' | grep "\"action\":\"${action}\"" | tail -1 | sed 's/^ESSAI //' || true)"
    if [ -n "$ligne" ]; then
      if [ "$action" = page-etat ] && [ -f "$SORTIE/mesure-page-etat.tmp" ]; then
        echo "DÉLAI page-etat : $(( ($(date +%s%N) - $(cat "$SORTIE/mesure-page-etat.tmp")) / 1000000 )) ms après le lancement de l'appli (granularité : 1 s d'interrogation de logcat)" >> "$ATTENTE_RESUME"
        rm -f "$SORTIE/mesure-page-etat.tmp"
      fi
      echo "$ligne"; return 0
    fi
    sleep 1
  done
  echec "aucune ligne ESSAI pour l'action « $action » après ${delai} s"
}

# Vérifie une expression JavaScript sur la ligne JSON (variable l). Valeurs maîtrisées seulement.
verifier() {
  local nom="$1" ligne="$2" expr="$3"
  printf '%s %s\n' "$nom" "$ligne" >> "$LIGNES"
  LIGNE="$ligne" EXPR="$expr" node -e '
    const l = JSON.parse(process.env.LIGNE);
    const ok = new Function("l", "return (" + process.env.EXPR + ")")(l);
    if (!ok) { console.error("attendu : " + process.env.EXPR); process.exit(1); }
  ' || echec "$nom : la ligne ESSAI ne correspond pas : $ligne"
  echo "OK  $nom : $ligne"
}

# Démarrage tardif (décision du 2026-11-22) : la plage écrite par la page (ou la page d'essai) a pour fin 06:00 en écriture normale,
# ou une fin bornée par le départ (07:30) si le téléphone est déjà entre l'heure de début calculée et le départ : le début est alors
# maintenant + 10 min et la ligne ESSAI porte tardif:true. Un scénario lancé entre 07:20 et 07:30 (heure de Paris) reçoit « trop tard »
# (rien n'est écrit) : il faut alors le relancer plus tard.
FIN_PAGE='(l.fin === "06:00" || l.tardif === true)'
# S15 à S17 : notifications REFUSÉES d'avance (refus définitif, sans fenêtre système) : le service d'attente tourne quand même, la page suit l'état.
refuser_notifications() {
  adb shell pm revoke "$PKG" android.permission.POST_NOTIFICATIONS > /dev/null 2>&1 || true
  adb shell pm set-permission-flags "$PKG" android.permission.POST_NOTIFICATIONS user-fixed > /dev/null 2>&1 || true
}
accorder_notifications() {
  adb shell pm clear-permission-flags "$PKG" android.permission.POST_NOTIFICATIONS user-fixed > /dev/null 2>&1 || true
  adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
}
# « Annuler » de l'écran d'attente : voir le commentaire de S16.
toucher_annuler_attente() {
  local bornes gauche haut droite densite taille l h
  # L'écran d'attente est affiché (la ligne ESSAI page-attente-wifi l'a déjà prouvé). Sur API 36, uiautomator n'a pas
  # remonté « Régler à la main » alors que la capture le montre (CI du 22/11) : relevé non bloquant, dump gardé pour diagnostic.
  if ! chercher_texte_page "Régler à la main" 20; then
    releve "écran d'attente : « Régler à la main » absent du dump uiautomator (visible sur la capture ?)"
    printf '%s' "$DUMP" > "$SORTIE/dump-attente-$(date +%s).xml"
  fi
  bornes="$(printf '%s' "$DUMP" | grep -o "<node [^>]* text=\"En attente du Wi-Fi et du câble…[^>]*>" | head -1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')"
  if [ -z "$bornes" ]; then
    # Repli : « Annuler » occupe la moitié gauche de la barre, juste au-dessus du bouton principal (capture S16, 1080 x 2424 :
    # centre vers 26 % de la largeur, 86 % de la hauteur).
    taille="$(adb shell wm size | tr -d '\015' | grep -o '[0-9]\+x[0-9]\+' | tail -1)"
    l="${taille%x*}"; h="${taille#*x}"
    releve "écran d'attente : bouton principal absent du dump, « Annuler » touché par position (${l}x${h})"
    adb shell input tap $(( l * 26 / 100 )) $(( h * 86 / 100 ))
    return 0
  fi
  # shellcheck disable=SC2086
  set -- $bornes
  gauche="$1"; haut="$2"; droite="$3"
  densite="$(adb shell wm density | tr -d '\015' | grep -o '[0-9]\+' | tail -1)"
  adb shell input tap $(( gauche + (droite - gauche) / 4 )) $(( haut - 32 * densite / 160 ))
}
# --- Outils communs de l'attente en arrière-plan (S22, S21, S-I) : code de verrouillage, écran, batterie ---
PIN_E0="1234"
E0_PIN_POSE=""
# Un code de verrouillage est posé : drapeau ET fichier (les scénarios « essayer » tournent dans des sous-shells ; la mise en place
# suivante, ou le trap de sortie, doit pouvoir le retirer).
poser_marque_pin() { E0_PIN_POSE=1; : > "$MARQUE_PIN"; }
# Remise en état avant chaque scénario et à la sortie, même si un scénario échoue (le drapeau ou le fichier de marque dit si un code est posé).
e0_remettre() {
  adb shell dumpsys deviceidle unforce > /dev/null 2>&1 || true
  adb shell input keyevent KEYCODE_WAKEUP > /dev/null 2>&1 || true
  sleep 1
  adb shell wm dismiss-keyguard > /dev/null 2>&1 || true
  if [ -n "$E0_PIN_POSE" ] || [ -f "$MARQUE_PIN" ]; then
    sleep 1
    # Le code n'est tapé que si l'écran de verrouillage est affiché : jamais dans une appli au premier plan.
    if ecran_verrouille; then
      adb shell input text "$PIN_E0" > /dev/null 2>&1 || true
      adb shell input keyevent KEYCODE_ENTER > /dev/null 2>&1 || true
      sleep 1
    fi
    adb shell locksettings clear --old "$PIN_E0" > /dev/null 2>&1 || true
    E0_PIN_POSE=""
    rm -f "$MARQUE_PIN"
  fi
  adb shell settings delete secure lock_screen_lock_after_timeout > /dev/null 2>&1 || true
  adb shell dumpsys battery reset > /dev/null 2>&1 || true
  adb shell settings put global low_power 0 > /dev/null 2>&1 || true # économiseur de batterie (S-I)
  adb shell svc power stayon true > /dev/null 2>&1 || true
}
# Réveil et déverrouillage par le code : la clé du coffre (setUnlockedDeviceRequired) n'est lisible que déverrouillé.
# On éteint d'abord (verrouillage immédiat, réglé plus bas) : le code n'est ainsi tapé que dans l'écran de verrouillage,
# jamais dans une appli restée au premier plan.
# Vrai si l'écran de verrouillage est affiché (vues « keyguard » de l'interface système dans l'arbre).
ecran_verrouille() { local x; x="$(ui_dump || true)"; grep -q 'resource-id="com.android.systemui:id/keyguard_' <<< "$x"; }
# Déverrouillage vérifié, 3 essais (CI du 25/11, API 35 : code refusé ou saisi trop tôt, S21 resté sur l'écran de verrouillage).
e0_deverrouiller() {
  local essai
  for essai in 1 2 3; do
    adb shell input keyevent KEYCODE_SLEEP
    sleep 1
    adb shell input keyevent KEYCODE_WAKEUP
    sleep 1
    adb shell wm dismiss-keyguard
    sleep 1
    adb shell input text "$PIN_E0"
    adb shell input keyevent KEYCODE_ENTER
    sleep 2
    if ! ecran_verrouille; then return 0; fi
    echo "déverrouillage : écran encore verrouillé (essai $essai)"
  done
  echec "écran resté verrouillé après 3 essais de déverrouillage"
}
# Attend une ligne ESSAI de l'action à l'état donné : attendre_etat <action> <etat> [délai en s].
attendre_etat() {
  local action="$1" etat="$2" delai="${3:-60}" ligne="" i
  for i in $(seq 1 "$delai"); do
    ligne="$(adb logcat -d -v raw -s "$TAG:I" | tr -d '\015' | grep '^ESSAI ' | grep "\"action\":\"${action}\"" | grep "\"etat\":\"${etat}\"" | tail -1 | sed 's/^ESSAI //' || true)"
    if [ -n "$ligne" ]; then echo "$ligne"; return 0; fi
    sleep 1
  done
  echec "aucune ligne ESSAI « $action » à l'état « $etat » après ${delai} s"
}
# Vrai si une notification affichée contient ce texte (textes fixes de l'appli ; --noredact : contenu complet).
notification_contient() {
  local liste
  liste="$(adb shell dumpsys notification --noredact 2> /dev/null | tr -d '\015' || true)"
  printf '%s\n' "$liste" | grep -F "$1" > /dev/null
}
# Après demarrer_page : câble prêt à l'adresse retenue, ou retrouvé par la recherche automatique (clé ressaisie,
# données effacées : adresse inconnue). Aucune compensation : si la page n'est ni « prête » ni « sans adresse » (recherche
# automatique en cours), c'est un échec du produit, à la première lecture.
page_prete() {
  local nom="$1" L
  L="$(attendre_essai page-etat 60)"
  if LIGNE="$L" node -e 'process.exit(JSON.parse(process.env.LIGNE).etat === "pret" ? 0 : 1)'; then return 0; fi
  contient "$L" '"etat":"sans_adresse"' || echec "$nom : câble ni prêt ni à localiser à l'ouverture de la page ($L)"
  L="$(attendre_essai page-chercher 150)"
  verifier "$nom câble retrouvé" "$L" 'l.ok === true'
}
# Touche un élément de l'interface système (volet des notifications) par son texte exact, sans tenir compte de la casse.
# Notification repliée : on la déplie en glissant vers le bas sur son titre, puis on recommence.
toucher_texte_systeme() {
  local texte="$1" titre="$2" xml noeud nombres
  for _ in $(seq 1 10); do
    xml="$(ui_dump || true)"
    noeud="$(printf '%s' "$xml" | grep -o -i "<node [^>]* text=\"${texte}\"[^>]*>" | head -1 || true)"
    if [ -n "$noeud" ]; then
      nombres="$(printf '%s' "$noeud" | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')"
      # shellcheck disable=SC2086
      set -- $nombres
      adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
      return 0
    fi
    noeud="$(printf '%s' "$xml" | grep -o "<node [^>]* text=\"${titre}[^>]*>" | head -1 || true)"
    if [ -n "$noeud" ]; then
      nombres="$(printf '%s' "$noeud" | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')"
      # shellcheck disable=SC2086
      set -- $nombres
      adb shell input swipe $(( ($1 + $3) / 2 )) "$2" $(( ($1 + $3) / 2 )) $(( $2 + 400 )) 300
    fi
    sleep 1
  done
  echec "« $texte » introuvable dans le volet des notifications"
}

# --- Attente tenue par le code natif (lot E3) sur la VRAIE page : service AttenteWifi + PiloteAttente ---
# La page n'est qu'une vue : elle démarre l'attente (attenteDebut), relit son état (attenteEtat) et affiche ce que le natif rend. Les lignes
# ESSAI de la page : page-attente-wifi {debut | cable | recherche | envoi | annulee | reprise | refusee | fin} puis page-programmer.
attendre_notification() { # attendre_notification <texte> [délai en s] : écrit les secondes écoulées ; rend 1 si absente
  local texte="$1" delai="${2:-120}" i
  for i in $(seq 0 "$delai"); do
    if notification_contient "$texte"; then echo "$i"; return 0; fi
    sleep 1
  done
  return 1
}
# Diagnostic du retour du Wi-Fi écran éteint (S21, S-I2) : état de la connectivité relevé toutes les 30 s dans <fichier>, avec une seconde
# commande d'activation du Wi-Fi à 30 s (sans réveiller l'écran). Même attente que attendre_notification : n'écrit que les secondes écoulées.
attendre_notification_diag() { # attendre_notification_diag <texte> [délai en s] <fichier>
  local texte="$1" delai="$2" fichier="$3" i
  : > "$fichier"
  for i in $(seq 0 "$delai"); do
    if notification_contient "$texte"; then echo "$i"; return 0; fi
    if [ $(( i % 30 )) = 0 ]; then
      {
        echo "== $(date +%T) +${i} s après le retour du Wi-Fi =="
        adb shell dumpsys connectivity 2>&1 | tr -d '\015' | grep -E "NetworkAgentInfo|WIFI|wlan" | head -20
        adb shell cmd wifi status 2>&1 | tr -d '\015' | head -15
        adb shell dumpsys power 2>&1 | tr -d '\015' | grep -m3 -E "mWakefulness|Wake Locks|AttenteWifi|RechargeDS3"
      } >> "$fichier" 2>&1 || true
      [ "$i" = 30 ] && adb shell svc wifi enable > /dev/null 2>&1 # le Wi-Fi n'est pas revenu : seconde demande
    fi
    sleep 1
  done
  return 1
}
# Journal de l'appli (processus de l'appli, tous les tags : pilote, service, réseau) pour comprendre une attente qui n'aboutit pas.
diag_logcat_appli() { # diag_logcat_appli <fichier>
  local pid
  pid="$(adb shell pidof "$PKG" 2> /dev/null | tr -d '\r' | awk '{print $1}')"
  if [ -n "$pid" ]; then adb logcat -d -v time --pid="$pid" > "$1" 2>&1 || true; else adb logcat -d -v time 2>&1 | grep -F "$PKG" > "$1" || true; fi
  adb shell dumpsys activity services "$PKG" 2> /dev/null | tr -d '\015' >> "$1" || true
}
service_au_premier_plan() { # service_au_premier_plan <fichier de trace>
  adb shell dumpsys activity services "$PKG" | tr -d '\015' > "$1" || true
  grep -q "isForeground=true" "$1"
}
service_en_cours() { grep -q "ServiceRecord{[^}]*AttenteWifi" <(adb shell dumpsys activity services "$PKG" | tr -d '\015'); }
# Commence une attente : Wi-Fi coupé, % modifié (la plage demandée diffère de celle du câble), « Programmer » touché.
attente_commencer() { # attente_commencer <nom>
  adb shell svc wifi disable
  sleep 5
  adb logcat -c
  toucher_web "Ajouter 1 %"
  toucher_web "Programmer la charge"
  L="$(attendre_etat page-attente-wifi debut 40)"
  verifier "$1 attente commencée" "$L" 'l.etat === "debut"'
  sleep 3 # laisse au natif le temps de démarrer son service
}
# Écran natif : vue par son id (balise du dump), attribut, centre ; défilement jusqu'à la voir (formulaire dans un ScrollView).
noeud_de() { grep -o "<node [^>]*resource-id=\"[^\"]*:id/$1\"[^>]*>" <<< "$2" | head -1 || true; }
attribut_de() { sed -n "s/.* $1=\"\([^\"]*\)\".*/\1/p" <<< "$2" | head -1 || true; }
centre_du_noeud() {
  local nombres
  nombres="$(grep -o 'bounds="[^"]*"' <<< "$1" | grep -o '[0-9]\+' | tr '\n' ' ')"
  # shellcheck disable=SC2086
  set -- $nombres
  echo "$(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))"
}
atteindre_vue() { # atteindre_vue <id> : DUMP contient la vue ; défile vers le bas, puis vers le haut
  local nom="$1" taille l h essai
  taille="$(adb shell wm size | tr -d '\r' | grep -o '[0-9]\+x[0-9]\+' | tail -1)"
  l="${taille%x*}"; h="${taille#*x}"
  for essai in 1 2 3 4 5 6; do
    DUMP="$(ui_dump || true)"
    if [ -n "$(noeud_de "$nom" "$DUMP")" ]; then return 0; fi
    if [ "$essai" -le 2 ]; then adb shell input swipe $(( l / 2 )) $(( h / 2 )) $(( l / 2 )) $(( h / 5 )) 300
    else adb shell input swipe $(( l / 2 )) $(( h / 5 )) $(( l / 2 )) $(( h * 4 / 5 )) 300; fi
    sleep 1
  done
  echec "vue native « $nom » introuvable à l'écran"
}
toucher_natif() {
  local c
  atteindre_vue "$1"
  c="$(centre_du_noeud "$(noeud_de "$1" "$DUMP")")"
  # shellcheck disable=SC2086
  adb shell input tap $c
}
vider_champ() { # vider_champ <id> : place le curseur à la fin et efface (24 caractères au plus)
  toucher_natif "$1"
  adb shell input keyevent KEYCODE_MOVE_END
  # shellcheck disable=SC2046
  adb shell input keyevent $(printf 'KEYCODE_DEL %.0s' $(seq 1 24))
}
valeur_native() { # valeur_native <id> <attribut> : lue après défilement (vue introuvable : le script échoue)
  atteindre_vue "$1"
  attribut_de "$2" "$(noeud_de "$1" "$DUMP")"
}

# --- Batterie de la page : boutons « Ajouter 1 % » / « Retirer 1 % » (position lue une fois, puis rafale de touchers) ---
SOC_PAGE=38 # repli : valeur de départ des boutons si le champ n'est pas lisible à l'écran (38 = défaut tant que rien n'est enregistré)
# Valeur du champ batterie affichée par la page, lue dans l'arbre d'accessibilité (champ de saisie, texte numérique) ; vide si illisible.
# Les données de la page ne sont plus effacées entre deux scénarios : la valeur de départ se lit, elle ne se suppose pas.
soc_affiche() {
  local x
  x="$(ui_dump || true)"
  grep -o '<node [^>]*class="android.widget.EditText"[^>]*>' <<< "$x" | grep -o ' text="[0-9]\+"' | head -1 | grep -o '[0-9]\+' || true
}
taper_bouton() { # taper_bouton <libellé> <n>
  local libelle="$1" n="$2" c
  c="$(centre_web "$libelle")"
  if [ "$n" -le 3 ]; then
    for _ in $(seq 1 "$n"); do
      # shellcheck disable=SC2086
      adb shell input tap $c
      sleep 0.3
    done
  else
    adb shell "for i in \$(seq 1 $n); do input tap $c; done"
  fi
}
# Amène la batterie à <cible> % ET la confirme (au moins un geste) : le calcul de la page vaut alors pour cette valeur.
regler_soc() {
  local cible="$1" delta lu
  lu="$(soc_affiche)"
  if [ -n "$lu" ]; then SOC_PAGE="$lu"; else echo "regler_soc : champ batterie illisible, valeur de départ supposée : $SOC_PAGE %"; fi
  delta=$(( cible - SOC_PAGE ))
  if [ "$delta" -gt 0 ]; then taper_bouton "Ajouter 1 %" "$delta"
  elif [ "$delta" -lt 0 ]; then taper_bouton "Retirer 1 %" "$(( -delta ))"
  else taper_bouton "Ajouter 1 %" 1; taper_bouton "Retirer 1 %" 1; fi
  SOC_PAGE="$cible"
}

# Premier lancement complet dans le thème donné (données effacées d'abord), avec les saisies invalides de l'écran natif.
# premier_lancement <clair|sombre> <préfixe de capture>
premier_lancement() {
  local theme="$1" p="$2" L
  mode_theme "$theme"
  oublier_donnees
  SOC_PAGE=38
  adb logcat -c
  adb shell am force-stop "$PKG"
  adb shell am start -W -n "$ACT" > /dev/null
  centre champ_cle > /dev/null
  capturer "${theme}-${p}1-ecran-natif-vide"
  # Identifiant invalide (le point n'est pas permis) avec une clé de 16 caractères : « Enregistrer » est actif, l'erreur s'affiche.
  toucher_natif champ_id;  adb shell input text "$IDENTIFIANT_KO"
  toucher_natif champ_cle; adb shell input text "$CLE_OK"
  toucher_natif bouton_enregistrer
  sleep 1
  [ -n "$(valeur_native texte_erreur text)" ] || echec "$p ($theme) : aucun message d'erreur pour un identifiant invalide"
  if grep -q 'name="bloc"' <<< "$(fichier_cable)"; then echec "$p ($theme) : un identifiant invalide a été enregistré"; fi
  capturer "${theme}-${p}2-ecran-natif-identifiant-invalide"
  # Clé de 7 caractères : « Enregistrer » grisé (le bouton n'est même pas touchable).
  vider_champ champ_cle; adb shell input text "$CLE_COURTE"
  [ "$(valeur_native bouton_enregistrer enabled)" = "false" ] || echec "$p ($theme) : « Enregistrer » actif avec une clé de 7 caractères"
  capturer "${theme}-${p}3-ecran-natif-cle-courte"
  # Saisies correctes.
  vider_champ champ_id;  adb shell input text "$IDENTIFIANT"
  vider_champ champ_cle; adb shell input text "$CLE_OK"
  toucher_natif bouton_enregistrer
  enregistrer_cle "$CLE_OK"
  # Page avec les réglages par défaut : bandeau, batterie vide, pas de « dernière valeur » ; câble à localiser, recherche automatique.
  L="$(attendre_essai page-etat 90)"
  verifier "$p ($theme) état à l'ouverture sans adresse" "$L" 'l.etat === "sans_adresse"'
  # Saisies du premier lancement jamais journalisées : contrôle ICI, avant le prochain « logcat -c » (S9, en fin de script,
  # ne voit plus ce tampon).
  if adb logcat -d | tr -d '\015' | grep -F -q -e "$CLE_COURTE" -e "$IDENTIFIANT_KO" -e "$CLE_OK" -e "$IDENTIFIANT"; then
    echec "$p ($theme) : une saisie de l'écran natif (identifiant ou clé) apparaît dans logcat"
  fi
  attendre_texte_page "Réglages par défaut" 30
  contient "$DUMP" "Entrez votre batterie" || echec "$p ($theme) : « Entrez votre batterie » absent (champ batterie pas vide)"
  if contient "$DUMP" "Dernière valeur"; then echec "$p ($theme) : « Dernière valeur » affiché au premier lancement"; fi
  capturer "${theme}-${p}4-page-reglages-par-defaut" # la recherche est en général en cours (pastille « Recherche du câble… »)
  L="$(attendre_essai page-chercher 150)"
  verifier "$p ($theme) recherche automatique" "$L" 'l.auto === true && l.ok === true'
  attendre_texte_page "Câble prêt" 30
  sleep 1
  capturer "${theme}-${p}5-page-cable-pret"
}
