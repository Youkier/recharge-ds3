#!/usr/bin/env bash
# Scénarios d'essai de la coque sur émulateur, contre le faux câble TCP (lot C3.4 de la phase 3b).
# Piloté par adb seul : install, am start, uiautomator dump + input (écran natif), logcat, screencap. Aucune dépendance de test.
#
#   android/ci/scenarios.sh <apk de mise au point> <dossier de sortie>
#
# Le faux câble (tools/faux-cable-tcp.mjs, clé factice) est lancé ici sur 127.0.0.1:6668 du runner ; l'émulateur le joint
# par 10.0.2.2:6668. Rien ne touche le vrai câble. Échec du script si une ligne ESSAI ne correspond pas à l'attendu.
#
# Versions debug seulement : l'action est demandée par `am start --es action ...` (le pont ne la transmet jamais en release).
# La clé factice et l'identifiant factice sont saisis dans l'écran natif par uiautomator + input. Depuis la v0.3 ils sont
# mémorisés chiffrés : on ne les ressaisit que pour changer de clé (données de l'appli effacées d'abord, pm clear).
set -euo pipefail

APK="${1:?usage : scenarios.sh APK SORTIE}"
SORTIE="${2:?usage : scenarios.sh APK SORTIE}"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="fr.rechargeds3.coque"
ACT="$PKG/.MainActivity"
TAG="RechargeEssai"
CLE_OK="CLE-FACTICE-0000"      # = CLE_FACTICE de tools/faux-cable-tcp.mjs
CLE_KO="CLE-FAUSSE-00000"      # 16 caractères, refusée par le faux câble
IDENTIFIANT="ID-FACTICE-0001"
THEME_COURANT="clair"
mkdir -p "$SORTIE"
LIGNES="$SORTIE/lignes-essai.txt"
: > "$LIGNES"

FAUX_PID=""
nettoyer() {
  code=$?
  # Toujours laisser les traces, même en cas d'échec.
  adb logcat -d -v raw -s "$TAG:I" > "$SORTIE/logcat-essai.txt" 2> /dev/null || true
  adb logcat -d -b crash > "$SORTIE/logcat-crash.txt" 2> /dev/null || true
  adb exec-out screencap -p > "$SORTIE/derniere-capture.png" 2> /dev/null || true
  adb shell uiautomator dump /sdcard/ui-final.xml > /dev/null 2>&1 && adb exec-out cat /sdcard/ui-final.xml > "$SORTIE/derniere-interface.xml" 2> /dev/null || true
  if [ -n "$FAUX_PID" ]; then kill "$FAUX_PID" 2> /dev/null || true; fi
  adb shell cmd uimode night no > /dev/null 2>&1 || true
  exit "$code"
}
trap nettoyer EXIT

echec() { echo "ÉCHEC : $*" >&2; exit 1; }
etape() { echo; echo "=== $*"; }

# --- Faux câble ---
node "$RACINE/tools/faux-cable-tcp.mjs" > "$SORTIE/faux-cable.log" 2>&1 &
FAUX_PID=$!
for i in $(seq 1 50); do
  if ss -Htln "( sport = :6668 )" | grep -q 6668; then break; fi
  sleep 0.2
  if [ "$i" = 50 ]; then cat "$SORTIE/faux-cable.log" >&2; echo "faux câble non démarré" >&2; exit 1; fi
done
echo "faux câble à l'écoute (pid $FAUX_PID)"
connexions_ouvertes_log() { grep -c "connexion ouverte" "$SORTIE/faux-cable.log" || true; }
connexions_fermees_log() { grep -c "connexion fermée" "$SORTIE/faux-cable.log" || true; }
connexions_etablies() { ss -Htn state established "( sport = :6668 )" | wc -l | tr -d ' '; }

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

# Même chose pour un élément de la page (WebView) : uiautomator expose l'attribut id HTML comme resource-id="<id>".
centre_web() {
  local nom="$1" xml noeud nombres
  for _ in $(seq 1 20); do
    xml="$(ui_dump || true)"
    noeud="$(printf '%s' "$xml" | grep -o "<node [^>]*resource-id=\"${nom}\"[^>]*>" | head -1 || true)"
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

# Vrai si une ligne ESSAI de l'action est déjà dans logcat (sans attendre).
ligne_vue() { adb logcat -d -v raw -s "$TAG:I" | tr -d '\015' | grep '^ESSAI ' | grep -q "\"action\":\"$1\""; }

# Ouvre l'appli sur la vraie page (site/), sans action adb. La clé n'est saisie que si elle change.
demarrer_page() {
  local cle="${1:-$CLE_OK}"
  adb logcat -c
  adb shell am force-stop "$PKG"
  [ "$cle" != "$CLE_ENREGISTREE" ] && oublier_donnees
  adb shell am start -W -n "$ACT" > /dev/null
  if [ -z "$CLE_ENREGISTREE" ]; then saisir_cle "$cle"; CLE_ENREGISTREE="$cle"; fi
}

# Saisie de l'identifiant et de la clé dans l'écran natif, puis « Enregistrer ».
saisir_cle() {
  local cle="$1"
  toucher champ_id;  adb shell input text "$IDENTIFIANT"
  toucher champ_cle; adb shell input text "$cle"
  toucher bouton_enregistrer
}

capturer() { adb exec-out screencap -p > "$SORTIE/$1.png"; echo "capture : $1.png"; }

mode_theme() { # clair | sombre
  THEME_COURANT="$1"
  if [ "$1" = "sombre" ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  sleep 2
  echo "thème : $(adb shell cmd uimode night | tr -d '\r')"
}

# Clé actuellement enregistrée dans l'appli (vide : rien d'enregistré).
CLE_ENREGISTREE=""
oublier_donnees() { adb shell pm clear "$PKG" > /dev/null; CLE_ENREGISTREE=""; }

# Démarre l'application à neuf : demarrer <action|-> [ip] [heure] [clé]. La clé n'est saisie que si elle change.
demarrer() {
  local action="$1" ip="${2:-}" heure="${3:-}" cle="${4:-$CLE_OK}" extras=()
  adb logcat -c
  adb shell am force-stop "$PKG"
  [ "$cle" != "$CLE_ENREGISTREE" ] && oublier_donnees
  [ "$action" != "-" ] && extras+=(--es action "$action")
  [ -n "$ip" ] && extras+=(--es ip "$ip")
  [ -n "$heure" ] && extras+=(--es heure "$heure")
  adb shell am start -W -n "$ACT" "${extras[@]}" > /dev/null
  if [ -z "$CLE_ENREGISTREE" ]; then saisir_cle "$cle"; CLE_ENREGISTREE="$cle"; fi
}

# Vrai si l'écran natif de saisie est affiché (sans attendre).
formulaire_affiche() { ui_dump | grep -q ":id/champ_cle\""; }
fichier_cable() { adb shell run-as "$PKG" cat shared_prefs/cable.xml 2> /dev/null | tr -d '\r' || true; }

# Attend la ligne ESSAI de l'action (jusqu'à $2 secondes) et l'affiche (JSON seul).
attendre_essai() {
  local action="$1" delai="${2:-60}" ligne="" i
  for i in $(seq 1 "$delai"); do
    ligne="$(adb logcat -d -v raw -s "$TAG:I" | tr -d '\015' | grep '^ESSAI ' | grep "\"action\":\"${action}\"" | tail -1 | sed 's/^ESSAI //' || true)"
    if [ -n "$ligne" ]; then echo "$ligne"; return 0; fi
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

# --- Installation ---
etape "Installation"
adb install -r "$APK" > /dev/null
echo "version installée : $(adb shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r ')"
echo "permissions demandées par l'APK :"
adb shell dumpsys package "$PKG" | grep -E "android.permission\.[A-Z_]+" | sort -u | sed 's/^ */  /'
if adb shell dumpsys package "$PKG" | grep -q ACCESS_LOCAL_NETWORK; then echec "ACCESS_LOCAL_NETWORK ne doit pas être déclarée"; fi

# --- Scénarios en thème clair ---
mode_theme clair
OUVERTES_AVANT_TOUT="$(connexions_ouvertes_log)"

etape "S1 Lecture par l'adresse 10.0.2.2"
demarrer lire 10.0.2.2
L="$(attendre_essai lire 60)"
verifier "S1 lecture" "$L" 'l.ok === true && l.debut === "03:30" && l.fin === "06:00" && l.ip === "10.0.2.2"'

etape "S2 Recherche sans adresse"
demarrer chercher
L="$(attendre_essai chercher 90)"
verifier "S2 recherche sans adresse" "$L" 'l.ok === true && l.ip === "10.0.2.2"'

etape "S3 Adresse muette 10.0.2.250 puis câble trouvé"
demarrer chercher 10.0.2.250
L="$(attendre_essai chercher 90)"
verifier "S3 adresse muette puis trouvé" "$L" 'l.ok === true && l.ip === "10.0.2.2"'

etape "S4 Clé fausse : erreur cle"
demarrer lire 10.0.2.2 "" "$CLE_KO"
L="$(attendre_essai lire 60)"
verifier "S4 clé fausse" "$L" 'l.ok === false && l.erreur === "cle"'

etape "S5 Filtre du pont : 10.0.2.2:6669, 127.0.0.1, 010.0.0.1, adresse publique, sondes interdites, sw.js en 404"
AVANT_FILTRE="$(connexions_ouvertes_log)"
demarrer filtre
L="$(attendre_essai filtre 60)"
verifier "S5 filtre du pont" "$L" 'l.ok === true'
sleep 1
[ "$(connexions_ouvertes_log)" = "$AVANT_FILTRE" ] || echec "S5 : le faux câble a vu une connexion pendant les essais de refus"

etape "S6 Programmer (version de mise au point) puis relecture conforme"
demarrer programmer 10.0.2.2 05:00
L="$(attendre_essai programmer 60)"
verifier "S6 programmer" "$L" 'l.ok === true && l.fin === "06:00" && (l.debut === "05:00" || l.immediat === true)'
DEBUT_PROGRAMME="$(LIGNE="$L" node -e 'console.log(JSON.parse(process.env.LIGNE).debut)')"
demarrer lire 10.0.2.2
L="$(attendre_essai lire 60)"
verifier "S6 relecture" "$L" "l.ok === true && l.debut === \"${DEBUT_PROGRAMME}\" && l.fin === \"06:00\""

# --- Mémorisation chiffrée (v0.3) ---
etape "S10a Relance : ni clé à ressaisir, ni adresse (adresse retenue après S6)"
demarrer lire
sleep 2
formulaire_affiche && echec "S10a : l'écran de saisie revient après une simple relance"
L="$(attendre_essai lire 60)"
verifier "S10a lecture à l'adresse retenue" "$L" 'l.ok === true && l.ip === "10.0.2.2"'

etape "S10b Fichier privé : bloc chiffré, ni clé ni identifiant en clair"
F="$(fichier_cable)"
printf '%s' "$F" | grep -q 'name="bloc">v1:' || echec "S10b : bloc chiffré absent du fichier privé"
printf '%s' "$F" | grep -q 'name="adresse">10.0.2.2<' || echec "S10b : adresse retenue absente"
if printf '%s' "$F" | grep -F -e "$CLE_OK" -e "$IDENTIFIANT" > /dev/null; then echec "S10b : clé ou identifiant en clair dans le fichier privé"; fi
echo "OK  S10b fichier privé chiffré"

etape "S10c Réinstallation par-dessus (install -r) : configuration conservée"
adb install -r "$APK" > /dev/null
demarrer lire
sleep 2
formulaire_affiche && echec "S10c : l'écran de saisie revient après une mise à jour"
L="$(attendre_essai lire 60)"
verifier "S10c lecture après mise à jour" "$L" 'l.ok === true && l.ip === "10.0.2.2"'

# --- Vraie page (site/, lot C4) : pastille, gestes du soir, programmation relue ---
etape "S11 Vraie page : pastille « Câble prêt » à l'adresse retenue, sans recherche"
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S11 état à l'ouverture" "$L" 'l.etat === "pret"'
ligne_vue page-chercher && echec "S11 : une recherche a été lancée sans geste"
capturer "clair-5-page-accueil"

etape "S12 Vraie page : bouton inactif avant le geste, puis « Programmer » relu conforme"
adb logcat -c
toucher_web sendBtn
sleep 3
ligne_vue page-programmer && echec "S12 : envoi parti sans confirmation de la batterie"
toucher_web socPlus
toucher_web sendBtn
L="$(attendre_essai page-programmer 60)"
verifier "S12 programmer depuis la page" "$L" 'l.ok === true && /^[0-2][0-9]:[0-5][0-9]$/.test(l.debut) && l.fin === "06:00"'
DEBUT_PAGE="$(LIGNE="$L" node -e 'console.log(JSON.parse(process.env.LIGNE).debut)')"
sleep 1
capturer "clair-6-page-programme"
demarrer lire 10.0.2.2
L="$(attendre_essai lire 60)"
verifier "S12 relecture" "$L" "l.ok === true && l.debut === \"${DEBUT_PAGE}\" && l.fin === \"06:00\""

etape "S13 Vraie page, clé refusée : pastille « clé », « Programmer » n'envoie rien"
demarrer_page "$CLE_KO"
L="$(attendre_essai page-etat 60)"
verifier "S13 état clé refusée" "$L" 'l.etat === "cle"'
adb logcat -c
toucher_web socPlus
toucher_web sendBtn
sleep 3
ligne_vue page-programmer && echec "S13 : envoi lancé alors que la clé est refusée"
capturer "clair-7-page-cle-refusee"
demarrer_page "$CLE_OK"
L="$(attendre_essai page-etat 60)"
echo "état après ressaisie de la bonne clé : $L"

etape "S10d Oublier le câble : confirmation, puis écran de saisie et fichier vidé"
adb logcat -c
adb shell am force-stop "$PKG"
adb shell am start -W -n "$ACT" --es action cle > /dev/null
toucher bouton_oublier
toucher button1
sleep 2
formulaire_affiche || echec "S10d : l'écran de saisie n'est pas affiché après « Oublier »"
printf '%s' "$(fichier_cable)" | grep -q 'name="bloc"' && echec "S10d : le bloc est encore présent après « Oublier »"
CLE_ENREGISTREE=""
echo "OK  S10d oublier"

# --- Captures, en clair puis en sombre : écran natif, accueil de la page, résultat ---
for THEME in clair sombre; do
  etape "S7 Captures en thème $THEME"
  mode_theme "$THEME"
  adb logcat -c
  adb shell am force-stop "$PKG"
  oublier_donnees
  adb shell am start -W -n "$ACT" > /dev/null
  centre champ_cle > /dev/null
  capturer "${THEME}-1-ecran-natif"
  saisir_cle "$CLE_OK"
  CLE_ENREGISTREE="$CLE_OK"
  sleep 3
  capturer "${THEME}-2-accueil"
  demarrer lire 10.0.2.2
  L="$(attendre_essai lire 60)"
  verifier "S7 résultat ($THEME)" "$L" 'l.ok === true'
  sleep 1
  capturer "${THEME}-3-resultat"
done
mode_theme clair
demarrer lire 10.0.2.2 "" "$CLE_KO"
L="$(attendre_essai lire 60)"
verifier "S7 résultat clé refusée" "$L" 'l.erreur === "cle"'
sleep 1
capturer "clair-4-resultat-cle-refusee"

# --- Rien ne reste ouvert, rien d'interdit dans logcat ---
etape "S8 Aucune connexion restée ouverte"
sleep 2
[ "$(connexions_etablies)" = "0" ] || echec "S8 : des connexions restent établies vers le faux câble après les actions"
adb shell input keyevent KEYCODE_BACK
sleep 2
[ "$(connexions_etablies)" = "0" ] || echec "S8 : des connexions restent établies après la sortie de l'activité"
OUV="$(connexions_ouvertes_log)"; FER="$(connexions_fermees_log)"
echo "connexions vues par le faux câble : ${OUV} ouvertes, ${FER} fermées (dont les sondes)"
[ "$OUV" = "$FER" ] || echec "S8 : ouvertures et fermetures du faux câble différentes"
[ "$OUV" -gt "$OUVERTES_AVANT_TOUT" ] || echec "S8 : le faux câble n'a vu aucune connexion"

etape "S9 Ni clé, ni identifiant, ni trame dans logcat"
adb logcat -d > "$SORTIE/logcat-complet.txt"
if grep -F -e "$CLE_OK" -e "$CLE_KO" -e "$IDENTIFIANT" "$SORTIE/logcat-complet.txt" > /dev/null; then
  echec "S9 : la clé ou l'identifiant factice apparaît dans logcat"
fi
# Seul l'étiquette fixe porte des lignes de l'application ; toutes commencent par ESSAI.
if adb logcat -d -v raw -s "$TAG:*" | tr -d '\015' | grep -v '^ESSAI ' | grep -v '^-* beginning of' | grep -q .; then
  echec "S9 : une ligne de l'application sous l'étiquette $TAG ne commence pas par ESSAI"
fi
rm -f "$SORTIE/logcat-complet.txt" # volumineux et sans intérêt s'il est propre

echo
echo "TOUS LES SCÉNARIOS SONT PASSÉS ($(wc -l < "$LIGNES" | tr -d ' ') lignes ESSAI vérifiées)"
