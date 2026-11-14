#!/usr/bin/env python3
"""Test du pilotage LOCAL du câble (sans cloud Tuya), par le réseau de la maison.

But : savoir si le câble accepte le protocole local Tuya (port TCP 6668). Si oui, la page
ou une appli peut régler la plage sans compte développeur, sans Worker et sans internet.

Dépendance : tinytuya (https://github.com/jasonacox/tinytuya), à installer une fois :
    py -m pip install tinytuya        (Windows)   |   python3 -m pip install tinytuya

Usage, PC sur le même Wi-Fi que le câble :
    python tools/tuya-local-test.py scan                      # étape L1 : aucune clé nécessaire
    python tools/tuya-local-test.py etat                      # étape L2 : lecture
    python tools/tuya-local-test.py ecrire-debut HH:MM        # simulation
    python tools/tuya-local-test.py ecrire-debut HH:MM --confirmer   # étapes L3 et L4

Lit tools/.env : TUYA_DEVICE_ID, TUYA_LOCAL_KEY (posée par `node tools/tuya-probe.mjs cle-locale`),
et en option TUYA_LOCAL_IP et TUYA_LOCAL_VERSION si le scan ne trouve pas le câble.
Ni la clé ni l'identifiant ne sont affichés. N'agit que sur TUYA_DEVICE_ID, et n'écrit
que le point de données 151 (x_charge_mode) : début de plage + plage active, comme la sonde.
"""
import json
import os
import re
import sys
import time

ICI = os.path.dirname(os.path.abspath(__file__))
DP_PLAGE = "151"  # x_charge_mode (docs/tuya-findings.md, test T2)
CLES_PLAGE = ["m", "dt", "ss", "se"]
MODES_CONNUS = (0, 2)  # 2 = plage active, 0 = charge immédiate
HEURE_VALIDE = re.compile(r"([01]\d|2[0-3]):[0-5]\d")  # toujours utilisée avec fullmatch (pas de \n final)
# Points qui bougent seuls : exclus du contrôle « rien d'autre n'a changé ».
# 101 état, 102 mesures, 105 historique, 109 état (texte) ; les autres volatils sont signalés.
DP_VOLATILS = {"101", "102", "105", "109"}


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


def charger_config(chemin=None):
    chemin = chemin or os.path.join(ICI, ".env")
    if not os.path.exists(chemin):
        raise SystemExit("Fichier tools/.env introuvable.")
    with open(chemin, encoding="utf-8") as f:
        env = parse_env(f.read())
    if not env.get("TUYA_DEVICE_ID"):
        raise SystemExit("Variable manquante dans tools/.env : TUYA_DEVICE_ID")
    return {
        "device": env["TUYA_DEVICE_ID"],
        "cle": env.get("TUYA_LOCAL_KEY", ""),
        "ip": env.get("TUYA_LOCAL_IP", ""),
        "version": env.get("TUYA_LOCAL_VERSION", ""),
    }


def formater_debut(hhmm, valeur_actuelle):
    """Même règle que formaterDebut() de tools/tuya-probe.mjs : ne change que ss, force m = 2."""
    if not HEURE_VALIDE.fullmatch(hhmm or ""):
        raise ValueError("Heure invalide : attendu HH:MM (00:00 à 23:59).")
    try:
        obj = json.loads(valeur_actuelle)
    except (TypeError, ValueError):
        raise ValueError("Valeur actuelle de la plage illisible (JSON attendu).")
    if not isinstance(obj, dict) or list(obj.keys()) != CLES_PLAGE:
        raise ValueError("Format de plage inattendu : rien n'est envoyé.")
    if not (isinstance(obj["ss"], str) and isinstance(obj["se"], str)
            and HEURE_VALIDE.fullmatch(obj["ss"]) and HEURE_VALIDE.fullmatch(obj["se"])):
        raise ValueError("Heures actuelles de la plage invalides : rien n'est envoyé.")
    if obj["m"] not in MODES_CONNUS or isinstance(obj["m"], bool):
        raise ValueError("Mode de charge inconnu : rien n'est envoyé.")
    obj["m"] = 2
    obj["ss"] = hhmm
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def importer_tinytuya():
    try:
        import tinytuya  # noqa: PLC0415
    except ImportError:
        raise SystemExit("tinytuya n'est pas installé :  py -m pip install tinytuya")
    return tinytuya


def trouver(cfg, tinytuya):
    """Adresse et version du câble : tools/.env d'abord, sinon écoute des annonces (≈ 20 s)."""
    if cfg["ip"] and cfg["version"]:
        return cfg["ip"], cfg["version"]
    print("Recherche du câble sur le réseau local (jusqu'à 20 s)…")
    r = tinytuya.find_device(dev_id=cfg["device"]) or {}
    ip, version = cfg["ip"] or r.get("ip"), cfg["version"] or r.get("version")
    if not ip or not version:
        raise SystemExit(
            "Câble introuvable sur le réseau local.\n"
            "- PC et câble sur le même Wi-Fi (pas le réseau invité) ; pare-feu : UDP 6666, 6667, 7000.\n"
            "- Sinon renseigner TUYA_LOCAL_IP (voir la box) et TUYA_LOCAL_VERSION (3.3, 3.4 ou 3.5).\n"
            "- Si rien ne répond sur le port TCP 6668 : le câble est sans doute « cloud seulement »."
        )
    return ip, str(version)


def ouvrir(cfg, tinytuya):
    if not cfg["cle"]:
        raise SystemExit("TUYA_LOCAL_KEY absente de tools/.env : lancer `node tools/tuya-probe.mjs cle-locale`.")
    ip, version = trouver(cfg, tinytuya)
    d = tinytuya.Device(cfg["device"], address=ip, local_key=cfg["cle"], version=float(version))
    d.set_socketTimeout(5)
    d.set_socketRetryLimit(2)
    return d, ip, version


def lire_dps(d):
    r = d.status()
    if not isinstance(r, dict) or "Error" in r or "dps" not in r:
        err = r.get("Error", "réponse inattendue") if isinstance(r, dict) else "aucune réponse"
        raise SystemExit(
            f"Lecture locale refusée : {err}\n"
            "Causes habituelles : clé locale périmée (elle change à chaque appairage), mauvaise version\n"
            "de protocole (essayer TUYA_LOCAL_VERSION=3.3, 3.4, 3.5), ou Smart Life ouverte sur le câble\n"
            "(une seule connexion locale à la fois : fermer l'appli)."
        )
    return {str(k): v for k, v in r["dps"].items()}


def action_scan(cfg):
    tinytuya = importer_tinytuya()
    ip, version = trouver(cfg, tinytuya)
    print(f"L1 RÉUSSI : le câble s'annonce sur le réseau local. Adresse {ip}, protocole {version}.")
    print("Pour éviter la recherche ensuite : TUYA_LOCAL_IP et TUYA_LOCAL_VERSION dans tools/.env.")


def action_etat(cfg):
    tinytuya = importer_tinytuya()
    d, ip, version = ouvrir(cfg, tinytuya)
    dps = lire_dps(d)
    print(f"L2 RÉUSSI : {len(dps)} point(s) de données lus en local ({ip}, protocole {version}).")
    print("Points présents :", ", ".join(sorted(dps, key=lambda k: int(k) if k.isdigit() else 0)))
    if DP_PLAGE in dps:
        print(f"Plage de charge (dp {DP_PLAGE}) : {dps[DP_PLAGE]}")
    else:
        print(f"ATTENTION : dp {DP_PLAGE} absent de la réponse locale. Noter la liste ci-dessus dans docs/tuya-findings.md.")


def action_ecrire_debut(cfg, hhmm, confirme):
    if not HEURE_VALIDE.fullmatch(hhmm or ""):
        raise SystemExit("Heure invalide : attendu HH:MM (00:00 à 23:59).")
    tinytuya = importer_tinytuya()
    d, _, _ = ouvrir(cfg, tinytuya)
    avant = lire_dps(d)
    if DP_PLAGE not in avant:
        raise SystemExit(f"dp {DP_PLAGE} absent de la lecture locale : rien n'est envoyé.")
    actuelle = avant[DP_PLAGE]
    try:
        nouvelle = formater_debut(hhmm, actuelle)
    except ValueError as e:
        raise SystemExit(str(e))
    print(f"Valeur actuelle : {actuelle}")
    print(f"Valeur à écrire : {nouvelle}")
    if actuelle == nouvelle:
        print("Déjà réglé : rien à envoyer.")
        return
    if not confirme:
        print(f"Simulation : écriture locale du dp {DP_PLAGE}. Ajouter --confirmer pour envoyer.")
        return
    retour = d.set_value(int(DP_PLAGE), nouvelle)
    if isinstance(retour, dict) and (retour.get("Error") or retour.get("Err")):
        # Message d'erreur de tinytuya (sans secret) ; la relecture ci-dessous dira si la valeur a changé.
        print(f"ERREUR renvoyée par l'écriture : {retour.get('Error')} (code {retour.get('Err')}).")
    print("Envoyé. Relecture dans 5 s…")
    time.sleep(5)
    apres = lire_dps(d)
    relue = apres.get(DP_PLAGE)
    print(f"Valeur relue    : {relue} -> {'CONFORME' if relue == nouvelle else 'DIFFÉRENTE (vérifier dans Smart Life)'}")
    autres = [f"dp {k} : {avant.get(k)!r} -> {apres.get(k)!r}"
              for k in sorted(set(avant) | set(apres))
              if k != DP_PLAGE and k not in DP_VOLATILS and avant.get(k) != apres.get(k)]
    print("ATTENTION, autres points modifiés (mesures ou réglages, à vérifier) :\n" + "\n".join(autres)
          if autres else "Aucun autre point modifié.")


AIDE = "Actions : scan | etat | ecrire-debut <HH:MM> [--confirmer]"


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if not args or args[0] == "aide":
        print(AIDE)
        return
    cfg = charger_config()
    if args[0] == "scan":
        action_scan(cfg)
    elif args[0] == "etat":
        action_etat(cfg)
    elif args[0] == "ecrire-debut":
        action_ecrire_debut(cfg, args[1] if len(args) > 1 else "", "--confirmer" in argv)
    else:
        print(AIDE)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
