#!/usr/bin/env bash
# Lance un émulateur Android sans fenêtre sur un runner GitHub Actions Linux (lot C3.3 de la phase 3b).
# Script maison, sans action tierce : règle udev KVM, sdkmanager, avdmanager, emulator, attente du démarrage complet.
#
#   android/ci/emulateur.sh <niveau d'API : 35 ou 36> [nom de l'AVD]
#
# Ne fait rien d'autre que préparer et démarrer l'émulateur ; il reste lancé en arrière-plan à la sortie du script.
# Journal de l'émulateur : $SORTIE_CI/emulateur.log (SORTIE_CI vaut android-ci-sortie par défaut).
#
# Sources (relevées le 2026-11-19) :
#   règle udev KVM : github.blog, changelog du 2024-04-02 « hardware accelerated Android virtualization » ;
#   options de l'émulateur : developer.android.com/studio/run/emulator-commandline (-no-window, -gpu swiftshader_indirect,
#     -no-snapshot, -noaudio, -no-boot-anim, -timezone, -netfast, -accel on) ;
#   avdmanager : developer.android.com/studio/command-line/avdmanager (create avd -n -k [-f], list device -c) ;
#     l'option -d <profil> existe aussi, mais n'est pas dans cette page : on la tente seulement si le profil est listé ;
#   écran du Pixel 9 et du Pixel 10 : 6,3 pouces, 1080 x 2424, 422 ppi, identiques (support.google.com/pixelphone/answer/7158570
#     et store.google.com, fiches techniques) : un seul profil, densité 420.
set -euo pipefail

API="${1:?usage : emulateur.sh NIVEAU_API [NOM_AVD]}"
NOM="${2:-essai-api${API}}"
SORTIE="${SORTIE_CI:-android-ci-sortie}"
mkdir -p "$SORTIE"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "emulateur.sh : ANDROID_HOME absent" >&2; exit 1; }
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$SDK/emulator:$PATH"
IMAGE="system-images;android-${API};google_apis;x86_64"
# Dossier des AVD fixé : avdmanager et emulator le lisent tous deux (sinon avdmanager peut écrire ailleurs, ex. ~/.config/.android).
export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"

# 1. KVM (règle udev du changelog GitHub), sinon l'émulateur est inutilisable.
if [ ! -e /dev/kvm ]; then echo "emulateur.sh : /dev/kvm absent : ce runner ne permet pas l'accélération matérielle" >&2; exit 1; fi
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules > /dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm

# 2. Paquets du SDK : licences, outils, émulateur, image système.
yes | sdkmanager --licenses > /dev/null 2>&1 || true
echo "--- images système disponibles pour l'API ${API} :"
sdkmanager --list 2> /dev/null | grep -E "system-images;android-${API}[.;]" | sed 's/ *|.*//' | sort -u || true
sdkmanager --install "platform-tools" "emulator" "$IMAGE" > "$SORTIE/sdkmanager.log" 2>&1 \
  || { tail -20 "$SORTIE/sdkmanager.log" >&2; echo "emulateur.sh : image $IMAGE introuvable ou installation impossible" >&2; exit 1; }

# 3. Profil d'appareil : on affiche la liste (demandé), puis pixel_9 s'il existe.
echo "--- avdmanager list device -c :"
avdmanager list device -c | tee "$SORTIE/profils.txt"
PROFIL=()
if grep -qx "pixel_9" "$SORTIE/profils.txt"; then PROFIL=(-d pixel_9); echo "--- profil pixel_9 présent : utilisé"; else echo "--- profil pixel_9 absent : écran fixé dans config.ini"; fi
echo no | avdmanager create avd --force -n "$NOM" -k "$IMAGE" "${PROFIL[@]}"

# 4. config.ini : dimensions du Pixel 9 / Pixel 10 (1080 x 2424, densité 420), clavier matériel (pas de clavier à l'écran
#    qui masquerait les champs lors des essais), un peu plus de mémoire.
CONFIG="$ANDROID_AVD_HOME/${NOM}.avd/config.ini"
[ -f "$CONFIG" ] || { echo "emulateur.sh : $CONFIG introuvable" >&2; exit 1; }
fixer() { if grep -q "^$1=" "$CONFIG"; then sed -i "s|^$1=.*|$1=$2|" "$CONFIG"; else echo "$1=$2" >> "$CONFIG"; fi; }
fixer hw.lcd.width 1080
fixer hw.lcd.height 2424
fixer hw.lcd.density 420
fixer hw.keyboard yes
fixer hw.ramSize 3072
echo "--- config.ini :"; grep -E "^(hw\.lcd\.|hw\.keyboard|hw\.ramSize|image\.sysdir|tag\.id|abi\.type)" "$CONFIG" | tee "$SORTIE/config-avd.txt"

# 5. Démarrage sans fenêtre, sans son ni instantané.
nohup emulator -avd "$NOM" -no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim \
  -timezone Europe/Paris -netfast -accel on > "$SORTIE/emulateur.log" 2>&1 &
echo "--- émulateur lancé (pid $!), attente du démarrage complet"

adb start-server > /dev/null
timeout 300 adb wait-for-device
for i in $(seq 1 90); do
  if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = "1" ]; then break; fi
  sleep 4
  if [ "$i" = 90 ]; then tail -30 "$SORTIE/emulateur.log" >&2; echo "emulateur.sh : démarrage trop long" >&2; exit 1; fi
done

# 6. Réglages de test : pas d'animation (arbre d'interface stable pour uiautomator), écran allumé.
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell svc power stayon true || true
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true

echo "--- appareil prêt : API $(adb shell getprop ro.build.version.sdk | tr -d '\r'), Android $(adb shell getprop ro.build.version.release | tr -d '\r')"
adb shell wm size
adb shell wm density
