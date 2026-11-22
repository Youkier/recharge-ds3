// Faux câble Tuya 3.5 en TCP, pour les essais de la coque Android sur émulateur (lot C3.1 de la phase 3b).
//   node tools/faux-cable-tcp.mjs [--port=6668] [--plage=HH:MM-HH:MM] [--delai-reponse=MS] [--silence-apres-ecriture]
//
// Adaptateur du faux câble des tests (tests/tuya-local-faux-cable.mjs, réutilisé tel quel) : un transport simulé
// devient un serveur TCP. Aucun secret : la clé est factice (CLE_FACTICE) et les points de données sont inventés.
//
// - écoute 127.0.0.1 SEULEMENT (l'adresse n'est pas paramétrable) ; seul le port l'est, pour les tests.
//   Depuis l'émulateur Android, la machine hôte est joignable en 10.0.2.2 (developer.android.com, « Set up Android
//   Emulator networking » : 10.0.2.2 = alias de l'interface de rebouclage de l'hôte), donc 10.0.2.2:6668.
// - un fauxCable par connexion ; les points de données sont PARTAGÉS : une écriture réussie persiste pour les
//   connexions suivantes (programmer, puis relire sur une autre connexion).
// - une sonde (connexion puis fermeture sans aucune donnée) ne casse rien et n'écrit rien.
// - journal sur la sortie standard : une ligne par ouverture et par fermeture, sans adresse de client ni donnée,
//   et une ligne « écriture reçue (n) » par écriture (sans la valeur) : les scénarios comptent ainsi les envois.
// - options des scénarios de cas atypiques (revue UX du 2026-11-22) :
//     --plage=03:30-06:00        plage de charge initiale (début-fin ; activée). Défaut : 03:30-06:00.
//     --delai-reponse=3000       chaque réponse du câble est retardée de ce nombre de millisecondes (câble lent).
//     --silence-apres-ecriture   la première écriture est appliquée, puis le câble ne répond plus à rien (coupure
//                                pendant l'envoi : ni accusé, ni relecture, sur aucune connexion).

import net from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxCable } from "../tests/tuya-local-faux-cable.mjs";

export const CLE_FACTICE = "CLE-FACTICE-0000";
export const PORT_PAR_DEFAUT = 6668;
const ADRESSE = "127.0.0.1";

const plage = (m, ss, se) => JSON.stringify({ m, dt: 0, ss, se });
export const DPS_INITIAUX = Object.freeze({
  101: 202, 102: '{"p":0}', 107: "[6,8,10,13,16]", 109: "WAIT", 150: 16, 151: plage(2, "03:30", "06:00"), 152: 16,
});
const copie = (o) => JSON.parse(JSON.stringify(o));
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DELAI_REPONSE_MAX_MS = 30_000;

/** Lit les arguments de la ligne de commande. Rend { port, plage, delaiReponseMs, silenceApresEcriture } ou lève une Error. */
export function lireArguments(argv) {
  const o = { port: PORT_PAR_DEFAUT, plage: null, delaiReponseMs: 0, silenceApresEcriture: false };
  for (const a of argv) {
    let m;
    if ((m = /^--port=(\d+)$/.exec(a))) {
      o.port = Number(m[1]);
      if (o.port > 65535) throw new Error("port invalide");
    } else if ((m = /^--plage=(\d\d:\d\d)-(\d\d:\d\d)$/.exec(a))) {
      if (!HEURE.test(m[1]) || !HEURE.test(m[2])) throw new Error("plage invalide (HH:MM-HH:MM)");
      o.plage = { debut: m[1], fin: m[2] };
    } else if ((m = /^--delai-reponse=(\d+)$/.exec(a))) {
      o.delaiReponseMs = Number(m[1]);
      if (o.delaiReponseMs > DELAI_REPONSE_MAX_MS) throw new Error("délai de réponse trop long");
    } else if (a === "--silence-apres-ecriture") {
      o.silenceApresEcriture = true;
    } else throw new Error("argument inconnu : " + a.slice(0, 40));
  }
  return o;
}

/**
 * Démarre le serveur. Rend { port, adresse, stats, dps(), arreter() }.
 *   stats : { ouvertes, fermees, sondes, actives, ecritures }  (sondes = connexions fermées sans avoir reçu un octet)
 *   plage : { debut, fin } de la plage initiale (activée) ; delaiReponseMs : retard de chaque réponse ;
 *   silenceApresEcriture : après la première écriture (appliquée), plus aucune réponse, sur aucune connexion.
 */
export async function demarrerFauxCableTcp({
  port = PORT_PAR_DEFAUT, cle = CLE_FACTICE, dps = DPS_INITIAUX, journal = null,
  plage: plageInitiale = null, delaiReponseMs = 0, silenceApresEcriture = false,
} = {}) {
  const partage = { dps: copie(dps), muet: false };
  if (plageInitiale) {
    if (!HEURE.test(plageInitiale.debut) || !HEURE.test(plageInitiale.fin)) throw new Error("plage invalide");
    partage.dps[151] = plage(2, plageInitiale.debut, plageInitiale.fin);
  }
  const stats = { ouvertes: 0, fermees: 0, sondes: 0, actives: 0, ecritures: 0 };
  const sockets = new Set();
  const noter = (ligne) => { if (journal) journal(ligne); };

  const serveur = net.createServer((socket) => {
    stats.ouvertes++; stats.actives++;
    sockets.add(socket);
    noter(`connexion ouverte (actives : ${stats.actives})`);
    socket.setNoDelay(true);
    const f = fauxCable({ cle, dps: partage.dps });
    let donnees = false;
    let ferme = false;
    let chaine = f.transport.ouvrir(ADRESSE, PORT_PAR_DEFAUT);

    const vider = async () => {
      let retarde = false;
      for (;;) {
        let morceau;
        try { morceau = await f.transport.recevoir(0); } catch { break; }
        if (delaiReponseMs > 0 && !retarde) { retarde = true; await new Promise((r) => setTimeout(r, delaiReponseMs)); } // câble lent
        if (!socket.destroyed) socket.write(Buffer.from(morceau));
      }
      if (f.etat.ferme && !socket.destroyed) socket.end(); // clé fausse en mode « fermer »
    };

    socket.on("data", (d) => {
      donnees = true;
      if (partage.muet) return; // câble muet depuis l'écriture : il écoute, ne répond plus
      chaine = chaine.then(async () => {
        if (partage.muet) return;
        const avant = f.journal.ecritures.length;
        await f.transport.envoyer(new Uint8Array(d));
        partage.dps = copie(f.dps); // une écriture persiste pour les connexions suivantes
        if (f.journal.ecritures.length > avant) {
          stats.ecritures++;
          noter(`écriture reçue (${stats.ecritures})`);
          if (silenceApresEcriture) { partage.muet = true; return; } // ni accusé, ni annonce, ni relecture
        }
        await vider();
      }).catch(() => socket.destroy());
    });
    socket.on("error", () => {}); // ECONNRESET d'une sonde brutale : sans importance
    socket.on("close", () => {
      if (ferme) return;
      ferme = true;
      stats.fermees++; stats.actives--;
      if (!donnees) stats.sondes++;
      sockets.delete(socket);
      f.transport.fermer();
      noter(`connexion fermée (${donnees ? "avec données" : "sonde, sans données"} ; actives : ${stats.actives})`);
    });
  });

  await new Promise((ok, ko) => {
    serveur.once("error", ko);
    serveur.listen({ host: ADRESSE, port }, ok); // 127.0.0.1 seulement, jamais 0.0.0.0
  });

  return {
    port: serveur.address().port,
    adresse: serveur.address().address,
    stats,
    dps: () => copie(partage.dps),
    async arreter() {
      await new Promise((ok) => {
        for (const s of sockets) s.destroy();
        serveur.close(() => ok());
      });
      // Les compteurs sont tenus à jour par l'événement « close » de chaque socket, qui peut suivre la fermeture du serveur.
      for (let i = 0; i < 100 && stats.actives > 0; i++) await new Promise((r) => setTimeout(r, 5));
    },
  };
}

// --- Ligne de commande ---
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try { args = lireArguments(process.argv.slice(2)); } catch (e) { console.error("faux-cable-tcp : " + e.message); process.exit(1); }
  const horodatage = () => new Date().toISOString().slice(11, 23);
  const srv = await demarrerFauxCableTcp({ ...args, journal: (l) => console.log(`[faux-cable ${horodatage()}] ${l}`) });
  console.log(`[faux-cable] à l'écoute sur ${srv.adresse}:${srv.port} (clé factice, points de données partagés)`);
  const fin = async () => { await srv.arreter(); process.exit(0); };
  process.on("SIGINT", fin);
  process.on("SIGTERM", fin);
}
