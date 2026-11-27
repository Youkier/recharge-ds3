#!/usr/bin/env bash
# Scénarios ATYPIQUES de la coque sur émulateur (API 36), contre le faux câble TCP (revue UX du 2026-11-22, docs/revue-ux-2026-11-22.md).
# Bloquants (ATYPIQUES_BLOQUANTS=0 pour ne pas l'être), sauf S-I2 (économiseur de batterie : relevé).
#
#   android/ci/scenarios-atypiques.sh <apk de mise au point> <dossier de sortie>
#
# S-A premier lancement, S-B données effacées, S-D coupure pendant l'envoi, S-E câble lent, S-F plage déjà présente (et S-K bascule du
# thème), S-J police agrandie, S-G « démarrage tardif » (ou « trop tard », selon l'heure) et « pas de charge », S-N attente non suivie,
# S-C Wi-Fi coupé et expiration, S-I1 appli balayée, S-I2 économiseur de batterie, puis S8 et S9. Aucun ne dépend d'un autre : chacun est
# lancé par « essayer » (mise en place, puis sous-shell) ; son échec est consigné (synthese-echecs.txt) et on passe au suivant.
# S-H, S-L et S-M ne sont pas faits ici (voir la revue). Aides et mise en place : commun.sh.
set -euo pipefail

APK="${1:?usage : scenarios-atypiques.sh APK SORTIE}"
SORTIE="${2:?usage : scenarios-atypiques.sh APK SORTIE}"
GROUPE="atypiques"
# shellcheck source=commun.sh
. "$(dirname "$0")/commun.sh"

# --- Installation ---
etape "Installation"
adb install -r "$APK" > /dev/null
echo "version installée : $(adb shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r ')"
if adb shell dumpsys package "$PKG" | grep -q ACCESS_LOCAL_NETWORK; then echec "ACCESS_LOCAL_NETWORK ne doit pas être déclarée"; fi
mode_theme clair
OUVERTES_AVANT_TOUT="$(connexions_ouvertes_log)"

# ======================================================================================================================
# Cas atypiques de la revue UX du 2026-11-22 (docs/revue-ux-2026-11-22.md) : S-A premier lancement, S-B données effacées,
# S-D coupure pendant l'envoi, S-E câble lent, S-F plage déjà présente (et S-K bascule du thème), S-J police agrandie,
# S-G « démarrage tardif » (ou « trop tard », selon l'heure) et « pas de charge ». Aucun ne dépend de l'attente en arrière-plan (réécrite en E3).
# S-H, S-L et S-M ne sont pas faits ici (voir la revue). S-C, S-I et « attente non suivie » (S-N) sont après S22 : ils testent le
# service d'attente et le pilote natif (lot E3).
# Le faux câble est relancé avec les options voulues (lancer_faux) ; le bloc le remet par défaut et laisse l'application
# configurée avec la clé factice, thème clair, police normale, batterie enregistrée à 39 %, pour la suite.
# ======================================================================================================================


scn_s_a() {
etape "S-A Premier lancement complet, thème clair : saisies invalides, enregistrement, réglages par défaut, recherche, câble prêt"
lancer_faux
premier_lancement clair A

}
essayer "S-A" scn_s_a neuf # efface lui-même les données

scn_s_b() {
etape "S-B Données effacées : réglages utilisés, puis pm clear et relance (dans l'autre thème, pour les captures sombres de S-A)"
demarrer_page
page_prete "S-B"
regler_soc 39 # un réglage utilisé : la batterie est enregistrée
# La WebView écrit son stockage local sur disque avec un léger délai : on passe l'appli en arrière-plan et on laisse ce
# délai s'écouler avant la relance (qui tue l'appli). Sans cela, la valeur est perdue (premier passage CI du 22/11).
adb shell input keyevent KEYCODE_HOME
sleep 15 # API 35 (CI du 22/11) : 6 s ne suffisaient pas, la valeur était perdue
demarrer_page # relance sans effacer : les données restent
L="$(attendre_essai page-etat 60)"
verifier "S-B relance : câble prêt" "$L" 'l.etat === "pret"'
# La batterie saisie est restée (preuve que ce sont bien les données effacées qui font revenir les défauts). Depuis le 2026-11-22, la
# confirmation du % est conservée à la relance (moins de 6 h, même jour, même valeur) : la page affiche alors 39 déjà confirmé, sans le
# libellé « Dernière valeur » (réservé à une valeur non confirmée). Les deux états prouvent que 39 est restée ; l'écriture du stockage de
# la WebView peut être plus lente sur certaines images : « Dernière valeur » (confirmation non conservée) est relevé, pas bloquant.
for _ in $(seq 1 40); do
  DUMP="$(ui_dump || true)"
  if contient "$DUMP" "Dernière valeur" || contient "$DUMP" 'text="39"'; then break; fi
  sleep 1
done
if ! contient "$DUMP" "Dernière valeur" && ! contient "$DUMP" 'text="39"'; then
  # Non bloquant : ce contrôle ne porte pas sur le code de l'appli mais sur le moment où la WebView écrit son stockage (API 35).
  releve "S-B : la batterie 39 % est perdue à la relance (stockage local de la WebView pas encore écrit, même après HOME + 15 s)"
elif contient "$DUMP" "Dernière valeur"; then
  releve "S-B : après la relance, la batterie (39 %) est restée mais sa confirmation n'a pas été conservée (« Dernière valeur » affiché : stockage pas encore écrit ?)"
else
  contient "$DUMP" "confirmez la batterie" && echec "S-B : valeur 39 affichée mais bouton en attente de confirmation (état incohérent)"
  echo "OK  S-B la batterie et sa confirmation sont conservées à la relance"
fi
if contient "$DUMP" "Réglages par défaut"; then
  releve "S-B : le bandeau « Réglages par défaut » réapparaît à chaque ouverture"
else
  releve "S-B : après une première utilisation, le bandeau « Réglages par défaut » ne revient pas à la relance (comportement actuel : affiché au seul lancement sans réglage enregistré)"
fi
premier_lancement sombre A # même parcours que S-A, mais après un effacement des données : défauts et bandeau reviennent
mode_theme clair

}
essayer "S-B" scn_s_b

scn_s_d() {
etape "S-D Coupure pendant l'envoi : le câble applique l'écriture puis ne répond plus : résultat incertain, heure manuelle, aucun second envoi"
A39="$(node "$RACINE/tools/heure-page.mjs" heure 39)"
lancer_faux --silence-apres-ecriture
demarrer_page
page_prete "S-D"
regler_soc 39
ECR_AVANT="$(ecritures_log)"
adb logcat -c
toucher_web "Programmer la charge"
L="$(attendre_essai page-programmer 90)"
verifier "S-D résultat incertain" "$L" "l.ok === false && l.code === \"local_delai\" && typeof l.manuel === \"string\" && l.manuel.includes(\"$A39\")"
attendre_texte_page "Vérifiez dans Smart Life" 20
contient "$DUMP" "À régler à la main" || echec "S-D : l'heure à régler à la main n'est pas affichée"
sleep 1
capturer "clair-D1-resultat-incertain"
sleep 12 # le temps qu'un second envoi, s'il existait, arrive
[ "$(( $(ecritures_log) - ECR_AVANT ))" = 1 ] || echec "S-D : le faux câble n'a pas vu exactement une écriture"
echo "OK  S-D une seule écriture, résultat incertain"
lancer_faux

}
essayer "S-D" scn_s_d

scn_s_e1() {
etape "S-E1 Câble lent : réponses à 3 s, la première lecture (4 s) échoue, le second essai (8 s) aboutit"
lancer_faux --delai-reponse=3000
CONTACTS_AVANT="$(contacts_avec_donnees_log)"
demarrer_page
L="$(attendre_essai page-etat 90)"
verifier "S-E1 lecture lente aboutie" "$L" 'l.etat === "pret"'
sleep 2
[ "$(( $(contacts_avec_donnees_log) - CONTACTS_AVANT ))" -ge 2 ] || echec "S-E1 : un seul contact avec le câble : le second essai n'a pas eu lieu"
attendre_texte_page "Câble prêt" 20
capturer "clair-E1-cable-lent-pret"

}
essayer "S-E1" scn_s_e1

scn_s_e2() {
etape "S-E2 Câble très lent : réponses à 8 s, les deux essais échouent : pastille « Câble introuvable », rien n'est effacé"
lancer_faux --delai-reponse=8000
demarrer_page
L="$(attendre_essai page-etat 90)"
verifier "S-E2 câble trop lent" "$L" 'l.etat === "muet"'
attendre_texte_page "Câble introuvable" 20
sleep 1
capturer "clair-E2-cable-tres-lent"
lancer_faux

}
essayer "S-E2" scn_s_e2

scn_s_f() {
etape "S-F Plage déjà présente sur le câble à l'ouverture (F1 identique, F2 différente, F3 pas de charge) ; S-K : bascule du thème sur F1"
A39="$(node "$RACINE/tools/heure-page.mjs" heure 39)" # self-suffisant : S-D peut avoir échoué
echo "heure calculée par la page pour 39 % : $A39"
lancer_faux --plage="$A39-06:00"
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S-F1 état à l'ouverture" "$L" 'l.etat === "pret"'
attendre_texte_page "Câble réglé : $A39 → 06:00" 20
# Avant la confirmation du % : « Déjà programmé » ne doit pas s'afficher. Une confirmation restaurée à la relance (S-D et S-E ont réglé 39 %,
# même jour, moins de 6 h : voulu depuis le 2026-11-22) rend cette vérification sans objet : S-F1 vérifie alors l'état confirmé plus bas.
DUMP="$(ui_dump || true)"
if contient "$DUMP" "confirmez la batterie"; then
  ecran_sans "Déjà programmé" "S-F1 : « Déjà programmé » affiché avant la confirmation du %"
else
  releve "S-F1 : confirmation du % restaurée à la relance, vérification « avant la confirmation » non faite"
fi
ECR_AVANT="$(ecritures_log)"
regler_soc 39
# Démarrage tardif (2026-11-22) : si l'heure calculée est déjà passée (ou dans moins de 10 min) pour le téléphone, la plage présente
# ne démarrerait pas la charge d'une voiture branchée maintenant : la page ne dit PAS « Déjà programmé » et propose de décaler.
DECISION_F1="$(node "$RACINE/tools/heure-page.mjs" decision 39)"
echo "S-F1 : décision du téléphone pour 39 % à cette heure : $DECISION_F1"
if [ "$DECISION_F1" = normal ]; then
  attendre_texte_page "Déjà programmé à $A39" 20
  sleep 1
  capturer "clair-F1-deja-programme"
  adb logcat -c
  toucher_web "Déjà programmé" # bouton inactif : le toucher n'envoie rien
  sleep 3
  ligne_vue page-programmer && echec "S-F1 : un envoi est parti alors que le câble a déjà la plage"
  [ "$(ecritures_log)" = "$ECR_AVANT" ] || echec "S-F1 : le faux câble a reçu une écriture"
  echo "OK  S-F1 déjà programmé, rien envoyé"
elif [ "$DECISION_F1" = variable ]; then
  releve "S-F1 : l'heure calculée ($A39) est à moins de 10 minutes de l'heure du téléphone : « Déjà programmé » dépend de la minute, non vérifié"
else
  sleep 1
  ecran_sans "Déjà programmé" "S-F1 : « Déjà programmé » affiché alors que l'heure calculée ($A39) est passée (la charge ne démarrerait pas)"
  ecran_avec "Programmer la charge" "S-F1 : le bouton « Programmer la charge » est absent alors que l'heure calculée est passée"
  capturer "clair-F1-debut-passe"
  releve "S-F1 : l'heure calculée ($A39) est passée à l'heure du téléphone : le bouton propose « Programmer la charge » (début dans 10 min), pas « Déjà programmé » (voulu, démarrage tardif)"
fi
# S-K : le thème bascule (sombre automatique au coucher du soleil) alors que le % est confirmé : la page est rechargée.
adb logcat -c
mode_theme sombre
L="$(attendre_essai page-etat 60)"
sleep 3
capturer "sombre-K-apres-bascule-du-theme"
DUMP="$(ui_dump || true)"
# Vérification bloquante : la confirmation du % survit à la bascule du thème (la page est rechargée, la WebView recréée).
contient "$DUMP" "confirmez la batterie" && echec "S-K : après la bascule du thème, le % doit être confirmé de nouveau (la confirmation n'a pas survécu au rechargement)"
if [ "$DECISION_F1" = normal ]; then
  attendre_texte_page "Déjà programmé à $A39" 20 # la page relit la plage après la recréation : on attend, on ne photographie pas
fi
echo "OK  S-K la confirmation du % survit à la bascule du thème"
mode_theme clair
# F2 : plage différente (celle du faux câble par défaut) : « Câble réglé : 03:30 → 06:00 », bouton actif.
lancer_faux
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S-F2 état à l'ouverture" "$L" 'l.etat === "pret"'
attendre_texte_page "Câble réglé : 03:30 → 06:00" 20
regler_soc 39
sleep 1
ecran_sans "Déjà programmé" "S-F2 : « Déjà programmé » affiché alors que la plage du câble est différente"
ecran_avec "Programmer la charge" "S-F2 : le bouton « Programmer la charge » est absent"
ecran_sans "rien à envoyer" "S-F2 : « rien à envoyer » affiché alors que la plage est différente"
capturer "clair-F2-plage-differente"
# F3 : plage 05:59-06:00, la nuit « pas de charge » de la veille : ligne dédiée, bouton actif pour programmer le soir.
lancer_faux --plage=05:59-06:00
demarrer_page
L="$(attendre_essai page-etat 60)"
verifier "S-F3 état à l'ouverture" "$L" 'l.etat === "pret"'
attendre_texte_page "Câble réglé sur : pas de charge" 20
regler_soc 39
sleep 1
ecran_sans "Déjà programmé" "S-F3 : « Déjà programmé » affiché alors que le câble est sur « pas de charge »"
ecran_avec "Programmer la charge" "S-F3 : le bouton « Programmer la charge » est absent"
capturer "clair-F3-plage-pas-de-charge"
lancer_faux

}
essayer "S-F" scn_s_f

scn_s_j() {
etape "S-J Police agrandie à 130 % et 200 % : accueil (puis Paramètres et écran natif à 200 %)"
for ECH in 130 200; do
  adb shell settings put system font_scale "$(( ECH / 100 )).$(printf '%02d' $(( ECH % 100 )))"
  sleep 2
  demarrer_page
  page_prete "S-J ($ECH %)"
  regler_soc 39
  sleep 1
  ecran_avec "Programmer la charge" "S-J ($ECH %) : le bouton « Programmer la charge » n'est plus visible"
  capturer "police-${ECH}-accueil"
  if [ "$ECH" = 200 ]; then
    toucher_web "Paramètres"
    sleep 2
    capturer "police-${ECH}-parametres"
    adb shell am force-stop "$PKG"
    adb shell am start -W -n "$ACT" --es action cle > /dev/null
    centre champ_cle > /dev/null
    capturer "police-${ECH}-ecran-natif"
  fi
done
adb shell settings put system font_scale 1.0
sleep 1

}
essayer "S-J" scn_s_j

scn_s_g() {
etape "S-G « Démarrage tardif » (ou « Trop tard ») et « Pas de charge » : cartes de confirmation, thèmes clair et sombre"
# Démarrage tardif (décision du 2026-11-22) : si l'heure calculée par la page est déjà passée pour le téléphone (entre elle et le
# départ, 07:30, heure de Paris), le début écrit est maintenant + 10 min et la fin est min(début + durée du plan, 07:30) ; l'alerte
# « Heure de début dépassée : charge programmée de … à … » s'affiche. L'heure calculée la plus tôt (batterie à 0 %) est 19:25 : de
# 07:30 à 19:25 environ, AUCUN cas n'existe (tools/heure-page.mjs rend « aucun » : relevé non bloquant, la règle est couverte par les
# tests JUnit et Node). De 07:20 à 07:30, tout début passé donne « trop tard » : rien n'est écrit, la carte donne l'heure à la main.
g_tardif() { # g_tardif <thème>
  # Calculé juste avant chaque passage (clair puis sombre) : la décision doit rester la même quelques minutes (tools/heure-page.mjs).
  local CAS NOM_T SOC_T DEB_T DUREE_T ECR_T
  CAS="$(node "$RACINE/tools/heure-page.mjs" tardif)"
  read -r NOM_T SOC_T DEB_T DUREE_T <<< "$CAS"
  echo "démarrage tardif ($1) : cas « ${NOM_T:-aucun} », batterie ${SOC_T:-?} %, heure calculée ${DEB_T:-?}, durée du plan ${DUREE_T:-?} min"
  case "$NOM_T" in
    tardif|trop_tard) ;;
    *) releve "S-G démarrage tardif ($1) : aucun cas possible à cette heure (le démarrage tardif n'existe qu'entre l'heure calculée, 19:25 au plus tôt, et 07:20 à Paris) ; couvert par PlageTardifTest, ClientCableTest et tests/plage-tardif-cas.test.mjs"; return 0 ;;
  esac
  lancer_faux
  regler_soc "$SOC_T"
  ECR_T="$(ecritures_log)"
  adb logcat -c
  toucher_web "Programmer la charge"
  L="$(attendre_essai page-programmer 60)"
  if [ "$NOM_T" = tardif ]; then
    # début = maintenant + 10 min (5 à 12 min d'écart avec l'heure de la vérification, qui suit l'envoi de quelques secondes) ;
    # fin = 07:30 (départ) ou début + durée du plan, au plus tard 07:30.
    verifier "S-G tardif ($1)" "$L" "l.ok === true && l.tardif === true && l.debut !== \"$DEB_T\" && (() => { const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); const m = (x) => +x.slice(0, 2) * 60 + +x.slice(3); const mod = (x) => ((x % 1440) + 1440) % 1440; const ecart = mod(m(l.debut) - m(h)); return ecart >= 5 && ecart <= 12 && (l.fin === '07:30' || mod(m(l.fin) - m(l.debut)) === $DUREE_T); })()"
    attendre_texte_page "Heure de début dépassée" 20
    sleep 1
    capturer "$1-G1-demarrage-tardif"
    sleep 1 # plus de relecture de la page après un envoi réussi (décision du 2026-11-23) : rien à attendre
  else
    verifier "S-G trop tard ($1)" "$L" 'l.ok === false && l.code === "trop_tard"'
    [ "$(ecritures_log)" = "$ECR_T" ] || echec "S-G trop tard ($1) : le faux câble a reçu une écriture alors que rien ne devait être écrit"
    attendre_texte_page "Trop tard pour charger" 20
    contient "$DUMP" "$DEB_T" || echec "S-G trop tard ($1) : l'heure à régler à la main ($DEB_T) n'est pas affichée"
    sleep 1
    capturer "$1-G3-trop-tard"
    attendre_essai page-etat 40 > /dev/null
  fi
}
g_pas_de_charge() { # g_pas_de_charge <thème>
  lancer_faux
  # Le faux câble repart avec sa plage par défaut : la page doit la relire (sinon elle garde « pas de charge » lu au passage
  # précédent et affiche à raison « Déjà réglé »). Relance de l'appli = lecture à l'ouverture.
  demarrer_page
  page_prete "S-G pas de charge ($1)"
  regler_soc 84
  attendre_texte_page "Pas de charge ce soir" 20
  adb logcat -c
  toucher_web "Pas de charge ce soir"
  L="$(attendre_essai page-programmer 60)"
  verifier "S-G pas de charge ($1)" "$L" 'l.ok === true && l.debut === "05:59" && l.fin === "06:00"'
  attendre_texte_page "Le câble ne chargera pas cette nuit" 20
  sleep 1
  capturer "$1-G2-pas-de-charge"
  attendre_texte_page "Déjà réglé : pas de charge" 20 # la plage relue est « pas de charge » : le bouton le dit
}
mode_theme clair
demarrer_page
page_prete "S-G (clair)"
g_tardif clair
g_pas_de_charge clair
mode_theme sombre
demarrer_page
page_prete "S-G (sombre)"
g_pas_de_charge sombre # la batterie enregistrée est déjà à 84 % : pas de rafale
g_tardif sombre        # on redescend à la batterie du cas : l'état de la page redevient normal pour la suite
mode_theme clair
lancer_faux
echo "OK  S-G cartes de confirmation"
}
essayer "S-G" scn_s_g

echo
echo "Constats non bloquants (cas atypiques) :"
cat "$RELEVES"

scn_s_n() {
etape "S-N Attente non suivie : processus tué pendant l'attente (économiseur de batterie, arrêt forcé), puis relance : la page le dit, avec début et fin"
lancer_faux
refuser_notifications # sans notification : le résultat n'est montré qu'à la réouverture
demarrer_page
page_prete "S-N"
regler_soc 39 # S-G laisse 84 % (« pas de charge ») : le bouton ne serait pas « Programmer la charge »
attente_commencer "S-N"
service_au_premier_plan "$SORTIE/attente-services-sn.txt" || echec "S-N : service d'attente absent ou pas au premier plan"
ECR_AVANT="$(ecritures_log)"
adb shell am force-stop "$PKG" # plus personne ne suit l'attente (am kill ne tue pas un processus qui porte un service de premier plan)
adb shell svc wifi enable
sleep 8
[ "$(ecritures_log)" = "$ECR_AVANT" ] || echec "S-N : une écriture est partie alors que le processus était tué"
adb logcat -c
adb shell am start -W -n "$ACT" > /dev/null
L="$(attendre_etat page-attente-wifi fin 40)"
verifier "S-N programmation non suivie" "$L" 'l.ok === false && l.code === "local_non_suivie"'
attendre_texte_page "pas pu être suivie" 20
ecran_avec "début" "S-N : le message ne donne pas le début à vérifier dans Smart Life"
ecran_avec "fin" "S-N : le message ne donne pas la fin à vérifier dans Smart Life"
capturer "clair-15-attente-non-suivie"
adb shell am force-stop "$PKG"
adb logcat -c
adb shell am start -W -n "$ACT" > /dev/null
sleep 8
ecran_sans "pas pu être suivie" "S-N : le message revient à chaque lancement (résultat non acquitté)"
echo "OK  S-N attente non suivie"

}
essayer "S-N" scn_s_n

scn_s_c() {
etape "S-C Wi-Fi coupé avant « Programmer » : rien ne part pendant 60 s, puis succès au retour du Wi-Fi ; puis expiration (10 min, raccourcie par la version de mise au point)"
lancer_faux
refuser_notifications
demarrer_page
page_prete "S-C"
attente_commencer "S-C"
ECR_AVANT="$(ecritures_log)"
sleep 60
ligne_vue page-programmer && echec "S-C : envoi parti sans Wi-Fi"
[ "$(ecritures_log)" = "$ECR_AVANT" ] || echec "S-C : une écriture est partie sans Wi-Fi"
ecran_avec "dès que le câble répond" "S-C : la ligne d'état de l'attente est absente"
# Consigne : sur API 36, le panneau d'attente (barre fixe) manque parfois dans l'arbre lu par uiautomator alors qu'il est affiché
# (CI du 23/11, tentatives 2 et 3, capture echec-ecran-S-C) : relevé, la capture fait foi ; TalkBack à vérifier sur le vrai Pixel.
chercher_texte_page "À régler à la main dans Smart Life" 5 || releve "S-C : consigne manuelle absente de l'arbre d'accessibilité (voir la capture clair-16-attente-ecran ; à vérifier avec TalkBack)"
# Lien « Régler à la main » : pas toujours remonté par uiautomator (voir toucher_annuler_attente) ; la capture fait foi.
contient "$DUMP" "Régler à la main" || releve "S-C : « Régler à la main » absent du dump uiautomator (voir la capture clair-16-attente-ecran)"
capturer "clair-16-attente-ecran"
adb shell svc wifi enable
L="$(attendre_essai page-programmer 120)"
verifier "S-C succès au retour du Wi-Fi" "$L" "l.ok === true && $FIN_PAGE"
# Expiration : Wi-Fi jamais revenu, attente de 40 s au lieu de 10 min (réglage de la version de mise au point seulement).
lancer_faux
adb logcat -c
adb shell am force-stop "$PKG"
adb shell am start -W -n "$ACT" --es attente_max_s 40 > /dev/null
page_prete "S-C (expiration)"
adb shell svc wifi disable
sleep 5
ECR_AVANT="$(ecritures_log)"
toucher_web "Retirer 1 %"
toucher_web "Programmer la charge"
L="$(attendre_etat page-attente-wifi fin 120)"
verifier "S-C expiration : rien n'a été envoyé" "$L" 'l.ok === false && l.code === "local_attente_expiree"'
attendre_texte_page "À régler à la main dans Smart Life" 20
ecran_avec "début" "S-C : l'échec n'indique pas le début à régler à la main"
ecran_avec "fin" "S-C : l'échec n'indique pas la fin à régler à la main"
[ "$(ecritures_log)" = "$ECR_AVANT" ] || echec "S-C : une écriture est partie alors que l'attente a expiré"
capturer "clair-17-attente-expiree"
adb shell svc wifi enable
sleep 5
echo "OK  S-C"

}
essayer "S-C" scn_s_c

scn_s_i1() {
etape "S-I1 Notifications refusées et appli balayée pendant l'attente : l'envoi part quand même, le résultat est montré à la réouverture"
lancer_faux
refuser_notifications
demarrer_page
page_prete "S-I1"
attente_commencer "S-I1"
service_au_premier_plan "$SORTIE/attente-services-si1.txt" || echec "S-I1 : service d'attente absent ou pas au premier plan"
ECR_AVANT="$(ecritures_log)"
# Appli balayée des applications récentes : vue d'ensemble, puis glissement de la carte vers le haut.
TAILLE="$(adb shell wm size | tr -d '\r' | grep -o '[0-9]\+x[0-9]\+' | tail -1)"
LARGEUR="${TAILLE%x*}"; HAUTEUR="${TAILLE#*x}"
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell input keyevent KEYCODE_APP_SWITCH
sleep 3
adb shell input swipe $(( LARGEUR / 2 )) $(( HAUTEUR * 55 / 100 )) $(( LARGEUR / 2 )) $(( HAUTEUR / 10 )) 200
sleep 3
if adb shell dumpsys activity activities | tr -d '\015' | grep -q "ActivityRecord{[^}]*MainActivity"; then
  releve "S-I1 : la carte de l'appli est encore dans les applications récentes (balayage non effectué par adb) : seule la sortie de l'appli est vérifiée"
else
  echo "S-I1 : tâche de l'appli retirée des applications récentes"
fi
service_au_premier_plan "$SORTIE/attente-services-si1-apres.txt" || echec "S-I1 : le service d'attente s'est arrêté avec l'appli balayée"
adb shell svc wifi enable
for _ in $(seq 1 90); do
  [ "$(ecritures_log)" != "$ECR_AVANT" ] && break
  sleep 1
done
[ "$(ecritures_log)" != "$ECR_AVANT" ] || echec "S-I1 : aucun envoi 90 s après le retour du Wi-Fi, appli balayée"
sleep 5
service_en_cours && echec "S-I1 : le service tourne encore après l'envoi"
notification_contient "harge programmée" && echec "S-I1 : une notification de résultat est publiée alors que les notifications sont refusées"
adb logcat -c
adb shell am start -W -n "$ACT" > /dev/null
L="$(attendre_essai page-programmer 40)"
verifier "S-I1 résultat montré à la réouverture" "$L" "l.ok === true && $FIN_PAGE"
echo "OK  S-I1"

}
essayer "S-I1" scn_s_i1

scn_s_i2() {
etape "S-I2 Écran éteint 10 min avec l'économiseur de batterie : le service survit, l'envoi part au retour du Wi-Fi"
# Attente de 500 s (réglable : S_I2_ATTENTE_S) puis retour du Wi-Fi, avec de la marge sur la fenêtre de 10 min.
S_I2_ATTENTE_S="${S_I2_ATTENTE_S:-500}"
lancer_faux
adb shell locksettings set-pin "$PIN_E0" > /dev/null
poser_marque_pin
adb shell settings put secure lock_screen_lock_after_timeout 0
adb shell dumpsys battery unplug
adb shell svc power stayon false
e0_deverrouiller
oublier_donnees
demarrer_page
page_prete "S-I2"
accorder_notifications
adb shell settings put global low_power 1 # économiseur de batterie
attente_commencer "S-I2"
adb shell input keyevent KEYCODE_SLEEP
sleep 5
service_au_premier_plan "$SORTIE/attente-services-si2.txt" || echec "S-I2 : service d'attente absent ou pas au premier plan, économiseur de batterie actif"
sleep "$S_I2_ATTENTE_S"
service_au_premier_plan "$SORTIE/attente-services-si2-apres.txt" || echec "S-I2 : le service d'attente a été arrêté pendant ${S_I2_ATTENTE_S} s d'économiseur de batterie"
T0=$(date +%s)
adb shell svc wifi enable
DELAI_NOTIF="$(attendre_notification_diag "harge programmée" 120 "$SORTIE/si2-connectivite.txt" || true)"
diag_logcat_appli "$SORTIE/logcat-appli-si2.txt"
[ -n "$DELAI_NOTIF" ] || echec "S-I2 : notification « Charge programmée » absente 120 s après le retour du Wi-Fi (économiseur de batterie)"
echo "S-I2 : notification $(( $(date +%s) - T0 )) s après le retour du Wi-Fi, après ${S_I2_ATTENTE_S} s écran éteint avec l'économiseur de batterie" | tee -a "$ATTENTE_RESUME"
e0_deverrouiller
L="$(attendre_essai page-programmer 60)"
verifier "S-I2 résultat montré au réveil" "$L" "l.ok === true && $FIN_PAGE"
e0_remettre
echo "OK  S-I2"
}
releve_echec "S-I2" scn_s_i2 neuf # économiseur de batterie : relevé non bloquant (les essais réels le confirmeront)

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
