#!/usr/bin/env python3
"""Produit tests/tuya-local-vecteurs.json : trames du protocole local Tuya 3.5 fabriquées par tinytuya.

Sert de référence à local/tuya-local.js : le module JavaScript doit produire exactement les mêmes octets
côté client et relire exactement les mêmes octets côté câble.

- Clé, identifiant et adresse sont FACTICES (visiblement). Ce script ne lit ni tools/.env ni aucun fichier
  de secrets, et n'ouvre aucune connexion réseau : tinytuya sert uniquement à construire et à lire des trames.
- Les aléas (nonce local, IV GCM) et l'heure (champ « t » de l'écriture) sont fixés, donc le résultat est
  reproductible. Les réponses du « câble » sont fabriquées ici avec les fonctions de tinytuya (pack_message)
  puis relues avec ses fonctions de lecture (unpack_message, _decode_payload) : c'est la preuve qu'il les accepte.

Usage :  python tools/gen-vecteurs-tuya-local.py
"""
import hashlib
import hmac
import json
import os
import sys
import time
from importlib.metadata import version as version_paquet

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "..", "tests", "tuya-local-vecteurs.json")

import tinytuya  # noqa: E402
from tinytuya.core import command_types as CT  # noqa: E402
from tinytuya.core import header as H  # noqa: E402
from tinytuya.core.message_helper import TuyaMessage, pack_message, unpack_message  # noqa: E402
from tinytuya.core.XenonDevice import XenonDevice  # noqa: E402

CLE = "CLE-FACTICE-0000"  # 16 caractères, factice
ID_APPAREIL = "factice_000000000000"
IP = "192.0.2.10"  # plage de documentation (RFC 5737), jamais routée
T_SECONDES = 1794868200  # 2026-11-16T22:30:00Z, soit 23:30 à Paris
MAINTENANT = "2026-11-16T22:30:00Z"
NONCE_CABLE = bytes((0x40 + i) for i in range(16))
IV_CABLE = [bytes([0xC0 + k] * 12) for k in range(10)]  # IV des trames du « câble » (explicites)


def alea(n, graine):
    return bytes(((i * 7 + graine * 31 + 5) % 256) for i in range(n))


ALEAS = [alea(16, 0)] + [alea(12, k) for k in range(1, 8)]  # nonce local puis un IV par trame envoyée


class Aleas:
    def __init__(self):
        self.i = 0
        self.sortis = []

    def urandom(self, n):
        v = ALEAS[self.i]
        assert len(v) == n, (n, len(v))
        self.i += 1
        self.sortis.append(v)
        return v


def hexa(b):
    return b.hex()


def trame_cable(cle, cmd, payload, iv, seq):
    """Trame envoyée par le « câble » : retcode 0 + payload, chiffrée comme le fait tinytuya."""
    msg = TuyaMessage(seq, cmd, 0, payload, 0, True, H.PREFIX_6699_VALUE, iv)
    return pack_message(msg, hmac_key=cle)


def dps_json(dps):
    return json.dumps({"dps": dps}, separators=(",", ":")).encode()


def plage(m, ss, se, dt=0):
    return json.dumps({"m": m, "dt": dt, "ss": ss, "se": se}, separators=(",", ":"))


def deroule(scenario):
    """Rejoue un échange complet côté client avec tinytuya ; renvoie la liste des échanges."""
    alea_os = Aleas()
    os.urandom = alea_os.urandom  # nonce local et IV GCM de tinytuya
    time.time = lambda: T_SECONDES
    dev = XenonDevice(ID_APPAREIL, address=IP, local_key=CLE, version=3.5)
    cle_reelle = CLE.encode("latin1")
    echanges = []
    iv_cable = iter(IV_CABLE)
    seq_cable = [100]

    def cable(cmd, payload, cle=None):
        seq_cable[0] += 1
        return trame_cable(cle or cle_reelle, cmd, payload, next(iv_cable), seq_cable[0])

    # 1. Négociation, étape 1 : client -> câble (cmd 3, nonce local)
    t1 = dev._encode_message(dev._negotiate_session_key_generate_step_1())
    nonce_local = dev.local_nonce
    # Étape 2 : câble -> client (cmd 4) : nonce du câble + HMAC(clé, nonce local)
    r2 = cable(CT.SESS_KEY_NEG_RESP, NONCE_CABLE + hmac.new(cle_reelle, nonce_local, hashlib.sha256).digest())
    msg2 = unpack_message(r2, hmac_key=cle_reelle, no_retcode=False)
    assert msg2.crc_good and msg2.cmd == CT.SESS_KEY_NEG_RESP
    echanges.append({"client": hexa(t1), "cable": [hexa(r2)]})
    # Étape 3 : client -> câble (cmd 5, HMAC(clé, nonce du câble)), sans réponse
    step3 = dev._negotiate_session_key_generate_step_3(msg2)
    assert step3, "tinytuya refuse la réponse de négociation fabriquée"
    t3 = dev._encode_message(step3)
    dev._negotiate_session_key_generate_finalize()
    echanges.append({"client": hexa(t3), "cable": []})
    session = dev.local_key
    # Contrôle croisé de la clé de session : XOR des nonces, AES-GCM(clé, IV = nonce_local[:12]), 16 premiers octets
    xor = bytes(a ^ b for a, b in zip(nonce_local, NONCE_CABLE))

    def lire_trame_client(trame):
        m = unpack_message(trame, hmac_key=session, no_retcode=None)
        assert m.crc_good, "le câble simulé ne relit pas la trame cliente"
        return m

    def reponse_lecture(dps):
        trame = cable(CT.DP_QUERY_NEW, dps_json(dps), cle=session)
        m = unpack_message(trame, hmac_key=session, no_retcode=False)
        assert m.crc_good
        lu = dev._decode_payload(m.payload)
        assert lu.get("dps") == dps, lu
        return trame

    # 2. Lecture (cmd 0x10, corps « {} »)
    lecture = dev._encode_message(dev.generate_payload(CT.DP_QUERY))
    m = lire_trame_client(lecture)
    assert m.cmd == CT.DP_QUERY_NEW and m.payload == b"{}", m
    echanges.append({"client": hexa(lecture), "cable": [hexa(reponse_lecture(scenario["dps_avant"]))]})
    if scenario.get("ecriture") is None:
        return echanges, session, alea_os, xor
    # 3. Écriture du dp 151 (cmd 0x0d, en-tête de version, corps JSON), puis accusé vide et annonce d'état (cmd 8)
    valeur = scenario["ecriture"]
    ecr = dev._encode_message(dev.generate_payload(CT.CONTROL, {"151": valeur}))
    m = lire_trame_client(ecr)
    assert m.cmd == CT.CONTROL_NEW, m
    accuse = cable(CT.CONTROL_NEW, b"", cle=session)
    annonce = cable(CT.STATUS, json.dumps({"protocol": 4, "t": T_SECONDES, "data": {"dps": {"151": valeur}}}, separators=(",", ":")).encode(), cle=session)
    echanges.append({"client": hexa(ecr), "cable": [hexa(accuse), hexa(annonce)]})
    # 4. Relecture
    lecture2 = dev._encode_message(dev.generate_payload(CT.DP_QUERY))
    lire_trame_client(lecture2)
    echanges.append({"client": hexa(lecture2), "cable": [hexa(reponse_lecture(scenario["dps_apres"]))]})
    return echanges, session, alea_os, xor


def main():
    avant = {
        "101": 202,
        "102": json.dumps({"L1": [2200, 0, 0], "t": 230, "p": 0, "d": 0, "e": 0}, separators=(",", ":")),
        "107": "[6,8,10,13,16]",
        "109": "WAIT",
        "150": 16,
        "151": plage(2, "03:30", "06:00"),
        "152": 16,
    }
    apres = dict(avant)
    apres["151"] = plage(2, "00:15", "06:00")
    apres["102"] = json.dumps({"L1": [2200, 0, 0], "t": 231, "p": 0, "d": 300, "e": 0}, separators=(",", ":"))  # point volatil
    lecture, session_l, al_l, _ = deroule({"dps_avant": avant})
    ecriture, session_e, al_e, xor = deroule({"dps_avant": avant, "dps_apres": apres, "ecriture": apres["151"]})
    assert session_l == session_e
    assert al_l.i == len(al_l.sortis) == 4 and al_e.i == 6, (al_l.i, al_e.i)

    sortie = {
        "_avertissement": "Fichier produit par tools/gen-vecteurs-tuya-local.py. Clé, identifiant et adresse FACTICES. Ne pas modifier à la main.",
        "tinytuya": version_paquet("tinytuya"),
        "protocole": "3.5",
        "cle": CLE,
        "deviceId": ID_APPAREIL,
        "ip": IP,
        "maintenant": MAINTENANT,
        "t": T_SECONDES,
        "aleas": [hexa(a) for a in ALEAS[:6]],
        "nonce_cable": hexa(NONCE_CABLE),
        "cle_session": hexa(session_e),
        "lecture": {"echanges": lecture, "dps": avant},
        "ecriture": {"echanges": ecriture, "dps_avant": avant, "dps_apres": apres, "demande": {"allumage": "00:15"}},
    }
    chemin = os.path.normpath(SORTIE)
    with open(chemin, "w", encoding="utf-8", newline="\n") as f:
        json.dump(sortie, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"Écrit : {chemin} (tinytuya {sortie['tinytuya']}, {len(lecture)} échanges de lecture, {len(ecriture)} d'écriture).")


if __name__ == "__main__":
    sys.exit(main())
