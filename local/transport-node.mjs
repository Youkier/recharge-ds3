// Transport TCP pour Node (node:net), à fournir à local/tuya-local.js.
// Interface : ouvrir(ip, port, delaiMs) · envoyer(octets) · recevoir(delaiMs) -> octets · fermer().
// Erreurs : Error avec .code = "hors_ligne" (connexion impossible), "delai" (rien reçu à temps), "ferme" (fermée par le câble).
// Une seule connexion à la fois ; aucun message d'erreur ne contient d'adresse ni de clé.

import net from 'node:net';

// Même filtre que le pont Android prévu : port 6668 et IPv4 privée seulement (10/8, 172.16/12, 192.168/16).
const PORT_CABLE = 6668;
export function adresseAutorisee(ip, port) {
  if (port !== PORT_CABLE || typeof ip !== 'string') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n, i) => n > 255 || String(n) !== m[i + 1])) return false; // pas de zéros de tête
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

function erreur(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// Sonde de port pour la recherche du câble : ouvre puis ferme aussitôt, sans rien envoyer. true si le port 6668 accepte.
// Même filtre d'adresses que ouvrir() ; ne rejette jamais.
export function sonderPort(ip, delaiMs) {
  if (!adresseAutorisee(ip, PORT_CABLE)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const s = net.createConnection({ host: ip, port: PORT_CABLE });
    let fini = false;
    const terminer = (ouvert) => { if (fini) return; fini = true; clearTimeout(minuteur); s.destroy(); resolve(ouvert); };
    const minuteur = setTimeout(() => terminer(false), delaiMs);
    s.once('connect', () => terminer(true));
    s.once('error', () => terminer(false));
  });
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
      if (!adresseAutorisee(ip, port)) return Promise.reject(erreur('hors_ligne')); // rien n'est ouvert
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
