// Transport TCP pour Node (node:net), à fournir à local/tuya-local.js.
// Interface : ouvrir(ip, port, delaiMs) · envoyer(octets) · recevoir(delaiMs) -> octets · fermer().
// Erreurs : Error avec .code = "hors_ligne" (connexion impossible), "delai" (rien reçu à temps), "ferme" (fermée par le câble).
// Une seule connexion à la fois ; aucun message d'erreur ne contient d'adresse ni de clé.

import net from 'node:net';

function erreur(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

export function creerTransportNode() {
  let socket = null;
  let recus = []; // morceaux reçus, pas encore rendus
  let fini = false; // connexion terminée (fermée ou en erreur)
  let reveil = null; // fonction appelée à l'arrivée de données ou à la fin

  const signaler = () => { if (reveil) { const r = reveil; reveil = null; r(); } };

  return {
    ouvrir(ip, port, delaiMs) {
      if (socket) return Promise.reject(erreur('hors_ligne')); // une seule connexion
      return new Promise((resolve, reject) => {
        const s = net.createConnection({ host: ip, port });
        socket = s;
        s.setNoDelay(true);
        const minuteur = setTimeout(() => { s.destroy(); reject(erreur('hors_ligne')); }, delaiMs);
        s.once('connect', () => { clearTimeout(minuteur); resolve(); });
        s.on('data', (d) => { recus.push(new Uint8Array(d)); signaler(); });
        s.on('close', () => { fini = true; signaler(); });
        s.on('error', () => { // le détail (adresse, code système) n'est pas relayé
          clearTimeout(minuteur);
          fini = true;
          reject(erreur('hors_ligne'));
          signaler();
        });
      });
    },

    envoyer(octets) {
      if (!socket || fini) return Promise.reject(erreur('ferme'));
      return new Promise((resolve, reject) => {
        socket.write(octets, (err) => (err ? reject(erreur('ferme')) : resolve()));
      });
    },

    async recevoir(delaiMs) {
      if (!recus.length && !fini) {
        await new Promise((resolve) => {
          const minuteur = setTimeout(() => { reveil = null; resolve(); }, delaiMs);
          reveil = () => { clearTimeout(minuteur); resolve(); };
        });
      }
      if (recus.length) {
        const morceaux = recus;
        recus = [];
        const out = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
        let i = 0;
        for (const m of morceaux) { out.set(m, i); i += m.length; }
        return out;
      }
      throw erreur(fini ? 'ferme' : 'delai');
    },

    fermer() {
      if (socket) { socket.destroy(); socket = null; }
      fini = true;
      recus = [];
      signaler();
    },
  };
}
