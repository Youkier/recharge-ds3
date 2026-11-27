#!/usr/bin/env bash
# Scénarios ESSENTIELS de la coque sur émulateur (API 35 et 36), contre le faux câble TCP (lot C3.4 de la phase 3b) : le parcours de
# l'usage. Bloquants. Piloté par adb seul (install, am start, uiautomator dump + input, logcat, screencap).
#
#   android/ci/scenarios-essentiels.sh <apk de mise au point> <dossier de sortie>
#
# Ordre : installation, S1 à S6, S10a à S10c, S11, S11b, S12, S15 à S17, S22, S21, S21-Wi-Fi (relevé), S13, S14, S10d, S7 (captures), S8, S9.
# Les cas atypiques sont dans scenarios-atypiques.sh (job parallèle) ; les aides et le principe de la mise en place dans commun.sh.
# Une barrière (Wi-Fi validé, faux câble joignable) précède chaque scénario ; son échec est « environnement », compté (voir commun.sh).
set -euo pipefail

APK="${1:?usage : scenarios-essentiels.sh APK SORTIE}"
SORTIE="${2:?usage : scenarios-essentiels.sh APK SORTIE}"
GROUPE="essentiels"
# shellcheck source=commun.sh
. "$(dirname "$0")/commun.sh"

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
barriere_lineaire "S1" # premier contact après le démarrage de l'émulateur : réseau vers 10.0.2.2 prêt avant de tester (CI du 22/11, « hors_ligne »)
demarrer lire 10.0.2.2
L="$(attendre_essai lire 60)"
verifier "S1 lecture" "$L" 'l.ok === true && l.debut === "03:30" && l.fin === "06:00" && l.ip === "10.0.2.2"'

etape "S2 Recherche sans adresse"
barriere_lineaire "S2"
demarrer chercher
L="$(attendre_essai chercher 90)"
verifier "S2 recherche sans adresse" "$L" 'l.ok === true && l.ip === "10.0.2.2"'

etape "S3 Adresse muette 10.0.2.250 puis câble trouvé"
barriere_lineaire "S3"
demarrer chercher 10.0.2.250
L="$(attendre_essai chercher 90)"
verifier "S3 adresse muette puis trouvé" "$L" 'l.ok === true && l.ip === "10.0.2.2"'

etape "S4 Clé fausse : erreur cle"
barriere_lineaire "S4"
demarrer lire 10.0.2.2 "" "$CLE_KO"
L="$(attendre_essai lire 60)"
verifier "S4 clé fausse" "$L" 'l.ok === false && l.erreur === "cle"'

etape "S5 Filtre du pont : aucune route générique (ouvrir, envoyer, recevoir, sonder…), transport natif limité à IPv4 privée:6668 (10.0.2.2:6669, 127.0.0.1, 010.0.0.1, adresse publique, lien local, nom refusés), opérations qui refusent adresse ou heure invalide, sw.js en 404"
barriere_lineaire "S5" # avant le relevé du compteur : la sonde de la barrière est une connexion du faux câble
AVANT_FILTRE="$(connexions_ouvertes_log)"
demarrer filtre
L="$(attendre_essai filtre 60)"
verifier "S5 filtre du pont" "$L" 'l.ok === true'
sleep 1
[ "$(connexions_ouvertes_log)" = "$AVANT_FILTRE" ] || echec "S5 : le faux câble a vu une connexion pendant les essais de refus"

etape "S6 Programmer (version de mise au point) puis relecture conforme"
barriere_lineaire "S6"
demarrer programmer 10.0.2.2 05:00
L="$(attendre_essai programmer 60)"
verifier "S6 programmer" "$L" 'l.ok === true && ((l.debut === "05:00" && l.fin === "06:00") || l.tardif === true)'
DEBUT_PROGRAMME="$(LIGNE="$L" node -e 'console.log(JSON.parse(process.env.LIGNE).debut)')"
FIN_PROGRAMMEE="$(LIGNE="$L" node -e 'console.log(JSON.parse(process.env.LIGNE).fin)')"
lire_essai 10.0.2.2
verifier "S6 relecture" "$L" "l.ok === true && l.debut === \"${DEBUT_PROGRAMME}\" && l.fin === \"${FIN_PROGRAMMEE}\""

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
barriere_lineaire "S11"
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S11 état à l'ouverture" "$L" 'l.etat === "pret"'
ligne_vue page-chercher && echec "S11 : une recherche a été lancée sans geste"
sleep 2 # laisse la page finir son rendu (API 36 : capture vide vue le 2026-11-21)
capturer "clair-5-page-accueil"

etape "S11b Thème sombre en cours d'usage : la page suit (activité recréée hors envoi)"
adb logcat -c
mode_theme sombre
L="$(attendre_essai page-etat 60)"
verifier "S11b page rechargée en sombre" "$L" 'l.etat === "pret"'
sleep 2
capturer "sombre-5-page-accueil"
adb logcat -c
mode_theme clair
L="$(attendre_essai page-etat 60)"
sleep 2

etape "S12 Vraie page : bouton inactif avant le geste, puis « Programmer » relu conforme"
adb logcat -c
# Le bouton est inactif tant que le % n'est pas confirmé ; si une confirmation précédente a été restaurée à la relance (voulu depuis le
# 2026-11-22), il n'y a pas d'état « non confirmé » à vérifier ici.
DUMP="$(ui_dump || true)"
if contient "$DUMP" "confirmez la batterie"; then
  toucher_web "Programmer la charge"
  sleep 3
  ligne_vue page-programmer && echec "S12 : envoi parti sans confirmation de la batterie"
else
  releve "S12 : confirmation du % déjà restaurée à la relance, vérification « bouton inactif avant le geste » non faite"
fi
toucher_web "Ajouter 1 %"
toucher_web "Programmer la charge"
L="$(attendre_essai page-programmer 60)"
verifier "S12 programmer depuis la page" "$L" "l.ok === true && /^[0-2][0-9]:[0-5][0-9]\$/.test(l.debut) && $FIN_PAGE"
DEBUT_PAGE="$(LIGNE="$L" node -e 'console.log(JSON.parse(process.env.LIGNE).debut)')"
FIN_ECRITE_PAGE="$(LIGNE="$L" node -e 'console.log(JSON.parse(process.env.LIGNE).fin)')"
sleep 1
capturer "clair-6-page-programme"
demarrer lire 10.0.2.2
L="$(attendre_essai lire 60)"
verifier "S12 relecture" "$L" "l.ok === true && l.debut === \"${DEBUT_PAGE}\" && l.fin === \"${FIN_ECRITE_PAGE}\""

refuser_notifications
etape "S15 Programmer avant d'être sur le Wi-Fi : attente, puis envoi automatique à la connexion"
barriere_lineaire "S15"
# E3 : l'attente est tenue par le code natif (service AttenteWifi) ; la page ne fait que la suivre. Plage par défaut (03:30-06:00) sur le
# faux câble avant chaque scénario d'attente : sinon la page lit une plage identique à la demande, affiche « Déjà programmé » et
# n'envoie rien (constaté en CI sur API 36, S16).
lancer_faux
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S15 état initial" "$L" 'l.etat === "pret"'
adb shell svc wifi disable
sleep 5
adb logcat -c
toucher_web "Ajouter 1 %"
toucher_web "Programmer la charge"
L="$(attendre_essai page-attente-wifi 30)"
verifier "S15 attente du Wi-Fi" "$L" 'l.etat === "debut"'
sleep 1
capturer "clair-9-attente-wifi"
ligne_vue page-programmer && echec "S15 : envoi parti sans Wi-Fi"
adb shell svc wifi enable
L="$(attendre_essai page-programmer 120)"
verifier "S15 envoi automatique à la connexion" "$L" "l.ok === true && $FIN_PAGE"

etape "S16 Attente du Wi-Fi annulée : rien n'est envoyé, heure manuelle affichée"
barriere_lineaire "S16"
lancer_faux # plage par défaut : S15 a laissé sur le faux câble la plage que S16 redemande (« Déjà programmé »)
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S16 état initial" "$L" 'l.etat === "pret"'
adb shell svc wifi disable
sleep 5
adb logcat -c
toucher_web "Retirer 1 %"
toucher_web "Programmer la charge"
L="$(attendre_essai page-attente-wifi 30)"
verifier "S16 attente du Wi-Fi" "$L" 'l.etat === "debut"'
# L'écran d'attente (E3) : l'état en haut, la consigne, puis « Annuler » (moitié gauche) et « Régler à la main » (moitié droite) juste
# au-dessus du bouton principal. « Annuler » est affiché mais absent de l'arbre d'accessibilité lu par uiautomator (constaté le
# 2026-11-21) : on le touche au quart gauche du bouton principal, 32 dp au-dessus de lui (densité lue sur l'appareil).
toucher_annuler_attente

ANNULEE=""
for _ in $(seq 1 20); do
  J="$(adb logcat -d -v raw -s "$TAG:I" | tr -d '\015' || true)"
  if printf '%s\n' "$J" | grep '^ESSAI ' | grep -c '"etat":"annulee"' > /dev/null; then ANNULEE=1; break; fi
  sleep 1
done
[ -n "$ANNULEE" ] || echec "S16 : pas de ligne « annulee » après « Annuler »"
adb shell svc wifi enable
sleep 10
ligne_vue page-programmer && echec "S16 : envoi parti après « Annuler »"
capturer "clair-10-attente-annulee"
echo "OK  S16 annulation"

etape "S17 Câble éteint au moment de « Programmer » (débranché la journée) : attente du câble, envoi dès qu'il répond"
barriere_lineaire "S17"
kill "$FAUX_PID" 2> /dev/null || true
wait "$FAUX_PID" 2> /dev/null || true
sleep 1
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S17 câble éteint à l'ouverture" "$L" 'l.etat === "muet"'
adb logcat -c
toucher_web "Ajouter 1 %"
toucher_web "Programmer la charge"
L="$(attendre_essai page-attente-wifi 40)"
verifier "S17 attente du câble" "$L" 'l.etat === "debut" || l.etat === "cable" || l.etat === "lecture"'
sleep 12
ligne_vue page-programmer && echec "S17 : envoi parti alors que le câble est éteint"
capturer "clair-11-attente-cable"
node "$RACINE/tools/faux-cable-tcp.mjs" >> "$SORTIE/faux-cable.log" 2>&1 &
FAUX_PID=$!
echo "$FAUX_PID" > "$PID_FAUX"
L="$(attendre_essai page-programmer 90)"
verifier "S17 envoi dès que le câble répond" "$L" "l.ok === true && $FIN_PAGE"

etape "S22 Attente annulée depuis la notification : rien n'est envoyé, notification « Attente annulée », puis résultat à la réouverture"
barriere_lineaire "S22"
lancer_faux
demarrer_page
page_prete "S22"
accorder_notifications # après demarrer_page : pm clear retire les permissions
attente_commencer "S22"
service_au_premier_plan "$SORTIE/attente-services-s22.txt" || echec "S22 : service d'attente absent ou pas au premier plan"
notification_contient "En attente du Wi-Fi et du câble" || echec "S22 : notification d'attente absente"
notification_contient "10 min au plus" || echec "S22 : la notification d'attente ne dit pas la durée maximale"
# L'appli passe en arrière-plan : la notification de résultat n'est publiée que si l'appli n'est pas visible.
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell cmd statusbar expand-notifications
sleep 2
capturer "clair-12-notification-attente"
toucher_texte_systeme "Annuler" "En attente du Wi-Fi"
sleep 4
ligne_vue page-programmer && echec "S22 : envoi parti après « Annuler » dans la notification"
notification_contient "Attente annulée" || echec "S22 : notification « Attente annulée » absente"
notification_contient "À régler à la main dans Smart Life : début" || echec "S22 : la notification d'annulation ne donne pas le début à régler à la main"
capturer "clair-13-notification-annulee"
adb shell cmd statusbar collapse
adb shell svc wifi enable
sleep 10
ligne_vue page-programmer && echec "S22 : envoi parti au retour du Wi-Fi après « Annuler »"
service_en_cours && echec "S22 : le service tourne encore après l'annulation"
# Réouverture : la page montre l'annulation, puis la notification est retirée.
adb logcat -c
adb shell am start -W -n "$ACT" > /dev/null
L="$(attendre_etat page-attente-wifi fin 40)"
verifier "S22 annulation vue par la page à la réouverture" "$L" 'l.ok === false && l.code === "local_attente_annulee"'
sleep 3
notification_contient "Attente annulée" && echec "S22 : la notification de résultat reste après que la page l'a montré"
echo "S22 : annulation par la notification conforme" >> "$ATTENTE_RESUME"
echo "OK  S22 annulation depuis la notification"

# S21 est BLOQUANT depuis E3 (le pilote natif tient l'attente : la WebView gelée écran éteint n'y change rien).
# Exception TEMPORAIRE (décision de Mathieu du 2026-11-22, version 0.5) : sur API 36, S21 a échoué sans connexion au faux câble
# après le retour du Wi-Fi écran éteint, alors qu'il passe sur API 35. En attendant le diagnostic (s21-connectivite.txt,
# logcat-appli-s21.txt), S21 est relevé sans bloquer sur API 36 seulement. À retirer pour la 0.5.1.
etape "S21 Attente écran éteint et verrouillé 330 s, faux câble coupé puis rétabli : le pilote le retrouve, envoie et notifie au plus 2 min après"
barriere_lineaire "S21"
# L'émulateur ne reconnecte pas le Wi-Fi écran éteint (diagnostic du 22/11) : on garde le Wi-Fi allumé et on débranche le câble (faux câble
# arrêté) pendant l'attente et les 330 s, puis on le rebranche. Le pilote lit toutes les 5 s, cherche après 60 s de silence, retrouve le
# câble, envoie et notifie, écran toujours éteint et verrouillé. La WebView d'une page cachée est gelée au-delà de 5 min : le natif n'en dépend pas.
lancer_faux
adb shell locksettings set-pin "$PIN_E0" > /dev/null
poser_marque_pin
adb shell settings put secure lock_screen_lock_after_timeout 0 # verrouillé dès l'extinction de l'écran
adb shell dumpsys battery unplug
adb shell svc power stayon false
e0_deverrouiller
oublier_donnees # clé ressaisie code posé (clé du magasin recréée dans ces conditions)
demarrer_page
page_prete "S21"
accorder_notifications
arreter_faux
demarrer_page # la page relit le câble : « muet » (sinon « Programmer » enverrait tout de suite)
L="$(attendre_essai page-etat 60)"
verifier "S21 câble débranché à l'ouverture" "$L" 'l.etat === "muet"'
adb logcat -c
toucher_web "Ajouter 1 %"
toucher_web "Programmer la charge"
L="$(attendre_etat page-attente-wifi debut 40)"
verifier "S21 attente commencée" "$L" 'l.etat === "debut"'
sleep 3
adb shell input keyevent KEYCODE_SLEEP
sleep 5
service_au_premier_plan "$SORTIE/attente-services-s21.txt" || echec "S21 : service d'attente absent ou pas au premier plan, écran éteint"
ECR_AVANT="$(ecritures_log)"
sleep 325
ligne_vue page-programmer && echec "S21 : envoi parti alors que le câble est débranché"
[ "$(ecritures_log)" = "$ECR_AVANT" ] || echec "S21 : une écriture est arrivée au faux câble pendant qu'il était arrêté"
ECRAN_S21="$(adb shell dumpsys power | tr -d '\015' | grep -m1 -o 'mWakefulness=[A-Za-z]*' || true)"
T0=$(date +%s)
lancer_faux # le câble est rebranché
DELAI_NOTIF="$(attendre_notification_diag "harge programmée" 180 "$SORTIE/s21-connectivite.txt" || true)"
diag_logcat_appli "$SORTIE/logcat-appli-s21.txt"
[ -n "$DELAI_NOTIF" ] || echec "S21 : notification « Charge programmée » absente 180 s après le retour du câble (voir logcat-appli-s21.txt)"
T1=$(date +%s)
# L'écran doit être resté éteint jusqu'à l'envoi : c'est le pilote natif qui a envoyé, pas une page réveillée.
ECRAN_ENVOI="$(adb shell dumpsys power | tr -d '\015' | grep -m1 -o 'mWakefulness=[A-Za-z]*' || true)"
case "$ECRAN_ENVOI" in
  mWakefulness=Asleep|mWakefulness=Dozing) ;;
  *) echec "S21 : l'écran n'était plus éteint au moment de l'envoi ($ECRAN_ENVOI)" ;;
esac
[ $(( T1 - T0 )) -le 120 ] || echec "S21 : notification publiée $(( T1 - T0 )) s après le retour du câble (critère : 2 min au plus)"
echo "S21 : notification $(( T1 - T0 )) s après le retour du câble, écran éteint et verrouillé depuis 330 s ($ECRAN_S21)" | tee -a "$ATTENTE_RESUME"
adb shell dumpsys notification --noredact 2> /dev/null | tr -d '\015' | grep -E "android\.(title|text)=" | grep -v "^ *$" > "$SORTIE/attente-notifications-s21.txt" || true
grep -q "début\|démarrage\|harge programmée" "$SORTIE/attente-notifications-s21.txt" || echec "S21 : texte de la notification de résultat inattendu"
capturer "clair-14-notification-programmee"
# Réveil : la page, rouverte, montre le résultat relu (jamais de faux OK : le natif l'a vérifié), puis la notification est retirée.
e0_deverrouiller
L="$(attendre_essai page-programmer 60)"
verifier "S21 résultat montré au réveil" "$L" "l.ok === true && $FIN_PAGE"
sleep 3
notification_contient "harge programmée" && echec "S21 : la notification de résultat reste après que la page l'a montré"
e0_remettre
echo "OK  S21 attente écran verrouillé 330 s, câble retrouvé, notification au plus 2 min après"

# Variante avec coupure du Wi-Fi (relevé non bloquant : l'émulateur ne le reconnecte pas toujours écran éteint).
scn_s21_wifi() {
S21_DEFAUT=0 # exception API 36 retirée : la cause (Wi-Fi non reconnecté écran éteint) est traitée plus bas, sur toutes les versions
S21_ATTENDU_ECHEC="${S21_ATTENDU_ECHEC:-$S21_DEFAUT}"
etape "S21-Wi-Fi Variante (relevé non bloquant) : Wi-Fi coupé puis rétabli écran éteint : notification « Charge programmée » au plus 2 min après"
lancer_faux
# 330 s : au-delà de 5 min, la WebView d'une page cachée est gelée ; le pilote natif ne dépend pas d'elle.
adb shell locksettings set-pin "$PIN_E0" > /dev/null
poser_marque_pin
adb shell settings put secure lock_screen_lock_after_timeout 0 # verrouillé dès l'extinction de l'écran
adb shell dumpsys battery unplug
adb shell svc power stayon false
e0_deverrouiller
# Clé ressaisie code posé (clé du magasin recréée dans ces conditions).
oublier_donnees
demarrer_page
page_prete "S21"
accorder_notifications
attente_commencer "S21"
adb shell input keyevent KEYCODE_SLEEP
sleep 5
service_au_premier_plan "$SORTIE/attente-services-s21.txt" || echec "S21 : service d'attente absent ou pas au premier plan, écran éteint"
ECR_AVANT="$(ecritures_log)"
sleep 325
ligne_vue page-programmer && echec "S21 : envoi parti sans Wi-Fi"
[ "$(ecritures_log)" = "$ECR_AVANT" ] || echec "S21 : une écriture est arrivée au faux câble avant le retour du Wi-Fi"
ECRAN_S21="$(adb shell dumpsys power | tr -d '\015' | grep -m1 -o 'mWakefulness=[A-Za-z]*' || true)"
T0=$(date +%s)
adb shell svc wifi enable
DELAI_NOTIF="$(attendre_notification_diag "harge programmée" 180 "$SORTIE/s21-connectivite.txt" || true)"
diag_logcat_appli "$SORTIE/logcat-appli-s21.txt"
grep -c "ESSAI.*pilote" "$SORTIE/logcat-appli-s21.txt" > /dev/null || echo "S21 : aucune ligne du pilote dans le journal de l'appli (pilote non lancé ?)"
# Diagnostic du 22/11 (s21-connectivite.txt, API 35) : écran éteint, l'émulateur réactive le Wi-Fi mais reste « Wifi is not
# connected » pendant 180 s ; le pilote, lui, tourne (journal toutes les 10 s) et attend le réseau. Sans réseau, aucun envoi
# n'est possible : ce cas est une limite de l'émulateur, relevée sans bloquer. Wi-Fi CONNECTÉ et pas d'envoi = vrai échec.
WIFI_FIN_S21="$(adb shell cmd wifi status 2> /dev/null | tr -d '\015' | grep -m1 -o 'Wifi is [a-z ]*connected' || true)"
if [ -z "$DELAI_NOTIF" ] && [ "$WIFI_FIN_S21" = "Wifi is not connected" ]; then
  S21_ATTENDU_ECHEC=1
  releve "S21 : l'émulateur n'a pas reconnecté le Wi-Fi écran éteint en 180 s (limite de l'émulateur, pilote vivant : voir logcat-appli-s21.txt)"
fi
if [ -z "$DELAI_NOTIF" ] && [ "$S21_ATTENDU_ECHEC" = 1 ]; then
  echo "CONNU S21 : aucune notification 180 s après le retour du Wi-Fi" | tee -a "$ATTENTE_RESUME"
  adb shell input keyevent KEYCODE_SLEEP > /dev/null 2>&1 || true
  e0_remettre
  adb shell am force-stop "$PKG"
else
[ -n "$DELAI_NOTIF" ] || echec "S21 : notification « Charge programmée » absente 180 s après le retour du Wi-Fi"
T1=$(date +%s)
# L'écran doit être resté éteint jusqu'à l'envoi : c'est le pilote natif qui a envoyé, pas une page réveillée.
ECRAN_ENVOI="$(adb shell dumpsys power | tr -d '\015' | grep -m1 -o 'mWakefulness=[A-Za-z]*' || true)"
case "$ECRAN_ENVOI" in
  mWakefulness=Asleep|mWakefulness=Dozing) ;;
  *) echec "S21 : l'écran n'était plus éteint au moment de l'envoi ($ECRAN_ENVOI)" ;;
esac
[ $(( T1 - T0 )) -le 120 ] || echec "S21 : notification publiée $(( T1 - T0 )) s après le retour du Wi-Fi (critère : 2 min au plus)"
echo "S21 : notification $(( T1 - T0 )) s après le retour du Wi-Fi, écran éteint et verrouillé depuis 330 s ($ECRAN_S21)" | tee -a "$ATTENTE_RESUME"
adb shell dumpsys notification --noredact 2> /dev/null | tr -d '\015' | grep -E "android\.(title|text)=" | grep -v "^ *$" > "$SORTIE/attente-notifications-s21.txt" || true
grep -q "début\|démarrage\|harge programmée" "$SORTIE/attente-notifications-s21.txt" || echec "S21 : texte de la notification de résultat inattendu"
capturer "clair-14-notification-programmee"
# Réveil : la page, rouverte, montre le résultat relu (jamais de faux OK : le natif l'a vérifié), puis la notification est retirée.
e0_deverrouiller
L="$(attendre_essai page-programmer 60)"
verifier "S21 résultat montré au réveil" "$L" "l.ok === true && $FIN_PAGE"
sleep 3
notification_contient "harge programmée" && echec "S21 : la notification de résultat reste après que la page l'a montré"
e0_remettre
echo "OK  S21 attente écran verrouillé 330 s, notification au plus 2 min après le retour du Wi-Fi"
fi


}
releve_echec "S21-Wi-Fi" scn_s21_wifi neuf

etape "S13 Vraie page, nouvelle clé (données effacées, adresse inconnue) : « Câble à localiser », « Programmer » n'envoie rien"
mise_en_place_ou_echec "S13" neuf # la variante Wi-Fi de S21 tourne dans un sous-shell : thème, Wi-Fi, code de verrouillage remis à zéro
demarrer_page "$CLE_KO"
L="$(attendre_essai page-etat 60)"
verifier "S13 état sans adresse" "$L" 'l.etat === "sans_adresse"'
L="$(attendre_essai page-chercher 150)"
verifier "S13 recherche automatique (clé refusée partout)" "$L" 'l.auto === true && l.ok === false'
adb logcat -c
toucher_web "Ajouter 1 %"
toucher_web "Programmer la charge"
sleep 3
ligne_vue page-programmer && echec "S13 : envoi lancé alors que le câble est à localiser"
capturer "clair-7-page-a-localiser"
demarrer_page "$CLE_OK"
L="$(attendre_essai page-chercher 150)"
verifier "S13 recherche automatique après une nouvelle clé" "$L" 'l.auto === true && l.ok === true'

etape "S14 Vraie page, clé refusée à l'adresse retenue : pastille « clé », « Programmer » n'envoie rien"
barriere_lineaire "S14"
# Nouvelle clé saisie SANS effacer les données : l'adresse retenue est gardée.
adb logcat -c
adb shell am force-stop "$PKG"
adb shell am start -W -n "$ACT" --es action cle > /dev/null
saisir_cle "$CLE_KO"
enregistrer_cle "$CLE_KO"
sleep 2
demarrer_page "$CLE_KO"
L="$(attendre_essai page-etat 60)"
verifier "S14 état clé refusée" "$L" 'l.etat === "cle"'
adb logcat -c
toucher_web "Ajouter 1 %"
toucher_web "Programmer la charge"
sleep 3
ligne_vue page-programmer && echec "S14 : envoi lancé alors que la clé est refusée"
capturer "clair-8-page-cle-refusee"
demarrer_page "$CLE_OK"
L="$(attendre_essai page-chercher 150)"
verifier "S14 retour à la bonne clé" "$L" 'l.ok === true'

etape "S10d Oublier le câble : confirmation, puis écran de saisie et fichier vidé"
adb logcat -c
adb shell am force-stop "$PKG"
adb shell am start -W -n "$ACT" --es action cle > /dev/null
toucher_apres_defilement bouton_oublier
toucher button1
sleep 2
formulaire_affiche || echec "S10d : l'écran de saisie n'est pas affiché après « Oublier »"
printf '%s' "$(fichier_cable)" | grep -q 'name="bloc"' && echec "S10d : le bloc est encore présent après « Oublier »"
enregistrer_cle ""
echo "OK  S10d oublier"

# --- Captures, en clair puis en sombre : écran natif, accueil de la page, résultat ---
barriere_lineaire "S7"
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
  enregistrer_cle "$CLE_OK"
  sleep 3
  capturer "${THEME}-2-accueil"
  lire_essai 10.0.2.2
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
scn_s8() {
etape "S8 Aucune connexion restée ouverte"
# La mise en place arrête l'appli : on la rouvre et on attend la page prête (lecture du câble faite), pour mesurer de vraies connexions.
demarrer_page
page_prete "S8"
sleep 2
[ "$(connexions_etablies)" = "0" ] || echec "S8 : des connexions restent établies vers le faux câble après les actions"
adb shell input keyevent KEYCODE_BACK
sleep 2
[ "$(connexions_etablies)" = "0" ] || echec "S8 : des connexions restent établies après la sortie de l'activité"
OUV="$(connexions_ouvertes_log)"; FER="$(connexions_fermees_log)"
echo "connexions vues par le faux câble : ${OUV} ouvertes, ${FER} fermées (dont les sondes)"
[ "$OUV" = "$FER" ] || echec "S8 : ouvertures et fermetures du faux câble différentes"
[ "$OUV" -gt "$OUVERTES_AVANT_TOUT" ] || echec "S8 : le faux câble n'a vu aucune connexion"

}
essayer "S8" scn_s8

etape "S9 Ni clé, ni identifiant, ni trame dans logcat"
adb logcat -d > "$SORTIE/logcat-complet.txt"
if grep -F -e "$CLE_OK" -e "$CLE_KO" -e "$CLE_COURTE" -e "$IDENTIFIANT" -e "$IDENTIFIANT_KO" "$SORTIE/logcat-complet.txt" > /dev/null; then
  echec "S9 : la clé ou l'identifiant factice apparaît dans logcat"
fi
# Seul l'étiquette fixe porte des lignes de l'application ; toutes commencent par ESSAI.
if adb logcat -d -v raw -s "$TAG:*" | tr -d '\015' | grep -v '^ESSAI ' | grep -v '^-* beginning of' | grep -q .; then
  echec "S9 : une ligne de l'application sous l'étiquette $TAG ne commence pas par ESSAI"
fi
rm -f "$SORTIE/logcat-complet.txt" # volumineux et sans intérêt s'il est propre

conclure
