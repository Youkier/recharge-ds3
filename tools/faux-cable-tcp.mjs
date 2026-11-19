// Faux câble Tuya 3.5 en TCP, pour les essais de la coque Android sur émulateur (lot C3.1 de la phase 3b).
//   node tools/faux-cable-tcp.mjs [--port=6668]
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
// - journal sur la sortie standard : une ligne par ouverture et par fermeture, sans adresse de client ni donnée.

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

/**
 * Démarre le serveur. Rend { port, adresse, stats, dps(), arreter() }.
 *   stats : { ouvertes, fermees, sondes, actives }  (sondes = connexions fermées sans avoir reçu un octet)
 */
export async function demarrerFauxCableTcp({ port = PORT_PAR_DEFAUT, cle = CLE_FACTICE, dps = DPS_INITIAUX, journal = null } = {}) {
  const partage = { dps: copie(dps) };
  const stats = { ouvertes: 0, fermees: 0, sondes: 0, actives: 0 };
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
      for (;;) {
        let morceau;
        try { morceau = await f.transport.recevoir(0); } catch { break; }
        if (!socket.destroyed) socket.write(Buffer.from(morceau));
      }
      if (f.etat.ferme && !socket.destroyed) socket.end(); // clé fausse en mode « fermer »
    };

    socket.on("data", (d) => {
      donnees = true;
      chaine = chaine.then(async () => {
        await f.transport.envoyer(new Uint8Array(d));
        partage.dps = copie(f.dps); // une écriture persiste pour les connexions suivantes
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
  const arg = process.argv.find((a) => a.startsWith("--port="));
  const port = arg ? Number(arg.slice(7)) : PORT_PAR_DEFAUT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("faux-cable-tcp : port invalide"); process.exit(1); }
  const horodatage = () => new Date().toISOString().slice(11, 23);
  const srv = await demarrerFauxCableTcp({ port, journal: (l) => console.log(`[faux-cable ${horodatage()}] ${l}`) });
  console.log(`[faux-cable] à l'écoute sur ${srv.adresse}:${srv.port} (clé factice, points de données partagés)`);
  const fin = async () => { await srv.arreter(); process.exit(0); };
  process.on("SIGINT", fin);
  process.on("SIGTERM", fin);
}
