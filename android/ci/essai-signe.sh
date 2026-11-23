#!/usr/bin/env bash
# Essai court de l'APK de publication SIGNÉ (job essai-signe), sur émulateur, sans faux câble ni secret :
#   1. l'appli est lancée AVEC la demande d'action de mise au point (--es action filtre), qui en version debug charge la page d'essai
#      et déclenche l'opération essaiFiltre ; l'APK signé doit l'ignorer : la vraie page est servie (l'accueil s'affiche après
#      la saisie d'une clé factice) et aucune ligne « ESSAI » n'apparaît dans logcat ;
#   2. la page d'essai (assets/android/essai/) n'est pas embarquée dans l'APK signé.
# Limite connue : essaiFiltre ne peut pas être appelée par adb seul sur la version publiée (pas de débogage de la WebView, pas
# d'action adb) ; son refus par le pont (RoutesPont.autorisee + test estDebug) est couvert par les JUnit, et ici on prouve que
# les chemins qui y mènent en mise au point sont fermés.
#
#   android/ci/essai-signe.sh <apk signé> <préfixe des captures>
set -euo pipefail
APK="${1:?usage : essai-signe.sh APK PREFIXE}"
PREFIXE="${2:?usage : essai-signe.sh APK PREFIXE}"
PKG="fr.rechargeds3.coque"
ACT="$PKG/.MainActivity"
echec() { echo "ECHEC essai signé : $*"; exit 1; }

if unzip -Z1 "$APK" | grep -q '^assets/android/essai/'; then echec "la page d'essai est embarquée dans l'APK signé"; fi

ui_dump() {
  local i
  for i in 1 2 3 4 5 6; do
    if adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; then adb exec-out cat /sdcard/ui.xml; return 0; fi
    sleep 1
  done
  return 1
}
toucher() { # toucher <id> : défile au besoin
  local nom="$1" xml noeud n essai
  for essai in 1 2 3 4 5; do
    xml="$(ui_dump || true)"
    noeud="$(printf '%s' "$xml" | grep -o "resource-id=\"[^\"]*:id/${nom}\"[^>]*>" | head -1 || true)"
    if [ -n "$noeud" ]; then
      n="$(printf '%s' "$noeud" | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')"
      # shellcheck disable=SC2086
      set -- $n
      adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
      return 0
    fi
    adb shell input swipe 540 1500 540 500 300
    sleep 1
  done
  echec "vue « $nom » introuvable"
}

adb logcat -c
adb shell pm clear "$PKG" > /dev/null
adb shell am start -W -n "$ACT" --es action filtre > /dev/null
toucher champ_id;  adb shell input text "ID-FACTICE-0001"
toucher champ_cle; adb shell input text "CLE-FACTICE-0000"
adb shell input keyevent KEYCODE_BACK
toucher bouton_enregistrer

# La vraie page est servie : son accueil (texte fixe de site/index.html) s'affiche.
VU=""
for _ in $(seq 1 60); do
  DUMP="$(ui_dump || true)"
  if grep -F -q "Entrez votre batterie" <<< "$DUMP"; then VU=1; break; fi
  sleep 1
done
[ -n "$VU" ] || echec "l'accueil de la page ne s'affiche pas"
adb exec-out screencap -p > "$PREFIXE-accueil.png" || true

# Aucune opération de mise au point n'a tourné : pas de ligne ESSAI, pas de page d'essai.
JOURNAL="$(adb logcat -d -v raw | tr -d '\015' || true)"
if grep -q '^ESSAI ' <<< "$JOURNAL"; then echec "ligne ESSAI présente dans logcat (mise au point active dans l'APK signé)"; fi
if grep -q 'assets/android/essai' <<< "$JOURNAL"; then echec "page d'essai chargée par l'APK signé"; fi
adb shell pidof "$PKG" > /dev/null || echec "l'application ne tourne plus"
echo "OK : APK signé, demande d'action ignorée, accueil servi, essaiFiltre inatteignable"
