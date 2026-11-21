#!/usr/bin/env python3
"""Script de SECOURS : obtenir la clé locale du câble SANS IoT Core (sans compte développeur Tuya).

Contexte : la clé locale (TUYA_LOCAL_KEY) change à chaque appairage ; la sonde la lit d'ordinaire par
IoT Core, dont l'essai gratuit expire. Ce script passe par le flux « QR code » du SDK officiel de
partage Tuya (celui de l'intégration Home Assistant). Décision de Mathieu du 2026-11-21,
voir docs/tuya-findings.md, section « Obtenir la clé locale sans IoT Core ». Jamais testé avant
le premier lancement : le câble apparaît-il dans ce flux, et la clé est-elle renvoyée ?

Exception à la règle 7 (comme tinytuya pour les scripts d'essai) : ces deux dépendances ne servent
qu'à ce script, rien n'est ajouté au reste du projet. Installation MANUELLE, une fois :
    py -m pip install "tuya-device-sharing-sdk>=0.2.15" "qrcode[pil]>=7.4"      (Windows)
    python3 -m pip install "tuya-device-sharing-sdk>=0.2.15" "qrcode[pil]>=7.4"

Usage :
    TUYA_CODE_UTILISATEUR=<code> python tools/cle-locale-qr.py [--enregistrer]
(PowerShell : $env:TUYA_CODE_UTILISATEUR = "<code>"  puis  py tools/cle-locale-qr.py)
Le code utilisateur n'est JAMAIS passé en argument (il resterait dans l'historique et la liste des
processus), ni affiché, ni écrit.

Déroulement : QR écrit dans dist/cle-qr/qr.png, scan avec Smart Life (compte dédié), liste des
appareils, recherche de TUYA_DEVICE_ID seulement (lu dans tools/.env), comparaison avec TUYA_LOCAL_KEY.
Affiche seulement IDENTIQUE ou DIFFÉRENTE (et la longueur). Jamais la clé, les jetons, l'identifiant du
câble, le code utilisateur ni les autres appareils (leur nombre seulement). Avec --enregistrer, une clé
différente remplace celle de tools/.env (sauvegarde tools/.env.bak, ignorée par git), sans affichage.
Session uniquement en mémoire ; jeton oublié et QR supprimé en fin, même en erreur.
"""
import os
import re
import sys
import time
import uuid

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
DOSSIER_QR = os.path.join(RACINE, "dist", "cle-qr")
CHEMIN_QR = os.path.join(DOSSIER_QR, "qr.png")
ATTENTE_MAX_S = 150
PAS_S = 3

# ATTENTION : identité de l'intégration Home Assistant, reprise ICI POUR UN USAGE PERSONNEL SEULEMENT
# (un script lancé par son propriétaire sur son propre compte dédié). Ne JAMAIS les reprendre dans une
# appli diffusée ou un service public : ce serait se faire passer pour Home Assistant.
# Source : dépôts https://github.com/tuya/tuya-device-sharing-sdk et intégration Tuya de Home Assistant
# (home-assistant/core, homeassistant/components/tuya/const.py), relevées dans docs/tuya-findings.md.
CLIENT_ID = "HA_3y9q4ak7g4ephrvke"
SCHEMA = "haauthorize"


def parse_env(texte):
    out = {}
    for brute in texte.splitlines():
        ligne = brute.strip()
        if not ligne or ligne.startswith("#") or "=" not in ligne:
            continue
        cle, val = ligne.split("=", 1)
        cle = re.sub(r"^export\s+", "", cle.strip())
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[cle] = val
    return out


def remplacer_valeur_env(texte, nom, valeur):
    """Remplace (ou ajoute) NOM=valeur, supprime les doublons, garde le séparateur de lignes."""
    if not isinstance(valeur, str) or not re.fullmatch(r"[\x21-\x7e]+", valeur):
        raise ValueError("Valeur refusée.")
    sep = "\r\n" if "\r\n" in texte else "\n"
    lignes = [l for l in texte.splitlines()
              if re.sub(r"^export\s+", "", l.split("=", 1)[0].strip()) != nom]
    lignes.append(f"{nom}={valeur}")
    return sep.join(lignes) + sep


def comparer_cles(obtenue, connue):
    """'IDENTIQUE' ou 'DIFFÉRENTE' ; une clé connue absente compte comme différente."""
    return "IDENTIQUE" if connue and obtenue == connue else "DIFFÉRENTE"


def chercher_cle(appareils, device_id):
    """Cherche UNIQUEMENT device_id. Renvoie la clé, ou lève ValueError (messages sans secret)."""
    cible = appareils.get(device_id) if hasattr(appareils, "get") else None
    if cible is None:
        raise ValueError("Appareil absent de ce compte : le câble est-il bien partagé avec le compte dédié ?")
    cle = getattr(cible, "local_key", None)
    if not isinstance(cle, str) or not cle:
        raise ValueError("Champ local_key absent de la réponse : Tuya ne renvoie pas la clé par cette voie.")
    return cle


def importer_dependances():
    try:
        import qrcode  # noqa: PLC0415
        from tuya_sharing import LoginControl, Manager  # noqa: PLC0415
    except ImportError:
        raise SystemExit('Dépendances manquantes :  py -m pip install "tuya-device-sharing-sdk>=0.2.15" "qrcode[pil]>=7.4"')
    return qrcode, LoginControl, Manager


def attendre_scan(login, token, user_code):
    debut = time.monotonic()
    while time.monotonic() - debut < ATTENTE_MAX_S:
        ok, info = login.login_result(token, CLIENT_ID, user_code)
        if ok:
            return info
        time.sleep(PAS_S)
    raise SystemExit("QR expiré ou non scanné en 150 s : relancer le script.")


def supprimer_qr():
    try:
        os.remove(CHEMIN_QR)
    except OSError:
        pass


def main(argv):
    enregistrer = "--enregistrer" in argv
    chemin_env = os.path.join(ICI, ".env")
    if not os.path.exists(chemin_env):
        raise SystemExit("Fichier tools/.env introuvable.")
    with open(chemin_env, encoding="utf-8") as f:
        env = parse_env(f.read())
    # Code utilisateur : variable d'environnement, sinon ligne TUYA_CODE_UTILISATEUR de tools/.env (saisie par Mathieu,
    # pour qu'il ne passe ni dans une commande ni dans une conversation).
    user_code = (os.environ.pop("TUYA_CODE_UTILISATEUR", "") or env.get("TUYA_CODE_UTILISATEUR", "")).strip()
    if not user_code:
        raise SystemExit("Code utilisateur absent : ajoutez TUYA_CODE_UTILISATEUR=<code> dans tools/.env (code utilisateur Smart Life du compte dédié).")
    device_id = env.get("TUYA_DEVICE_ID", "")
    if not device_id:
        raise SystemExit("Variable manquante dans tools/.env : TUYA_DEVICE_ID")
    connue = env.get("TUYA_LOCAL_KEY", "")

    qrcode, LoginControl, Manager = importer_dependances()
    manager = None
    try:
        login = LoginControl()
        rep = login.qr_code(CLIENT_ID, SCHEMA, user_code)
        token = (rep.get("result") or {}).get("qrcode") if isinstance(rep, dict) else None
        if not rep.get("success") or not token:
            raise SystemExit("QR refusé par Tuya : code utilisateur incorrect ? (Smart Life : Moi > Paramètres > Compte et sécurité > Code utilisateur).")
        os.makedirs(DOSSIER_QR, exist_ok=True)
        qrcode.make(f"smartlife--qrLogin?token={token}").save(CHEMIN_QR)
        print(f"QR écrit : {CHEMIN_QR}")
        print("Scannez avec Smart Life (compte dédié) : Moi > icône de scan.")

        info = attendre_scan(login, token, user_code)
        terminal_id = info.get("terminal_id") or uuid.uuid4().hex
        manager = Manager(CLIENT_ID, user_code, terminal_id, info.get("endpoint", ""), info)
        manager.update_device_cache()
        print(f"Appareils vus par ce compte : {len(manager.device_map)}")
        try:
            obtenue = chercher_cle(manager.device_map, device_id)
        except ValueError as e:
            raise SystemExit(str(e))

        verdict = comparer_cles(obtenue, connue)
        print(f"Clé locale : {verdict} (longueur {len(obtenue)}).")
        if verdict == "DIFFÉRENTE" and enregistrer:
            chemin_bak = os.path.join(ICI, ".env.bak")
            with open(chemin_env, encoding="utf-8") as f:
                ancien = f.read()
            fd = os.open(chemin_bak, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                f.write(ancien)
            nouveau = remplacer_valeur_env(ancien, "TUYA_LOCAL_KEY", obtenue)
            with open(chemin_env, "w", encoding="utf-8", newline="") as f:
                f.write(nouveau)
            try:
                os.chmod(chemin_env, 0o600)
            except OSError:
                pass
            print("tools/.env mis à jour (sauvegarde : tools/.env.bak).")
        elif verdict == "DIFFÉRENTE":
            print("Rien écrit. Relancer avec --enregistrer pour remplacer la clé de tools/.env.")
    except SystemExit:
        raise
    except Exception as e:  # le message d'une exception réseau peut contenir une URL ou un jeton : type seulement
        raise SystemExit(f"Échec ({type(e).__name__}) : voir la documentation du script ; aucun détail affiché par sécurité.")
    finally:
        if manager is not None:
            try:
                manager.unload()  # oublie le terminal côté Tuya ; rien n'a été écrit sur disque
            except Exception:
                pass
        supprimer_qr()
        del user_code


if __name__ == "__main__":
    main(sys.argv[1:])
