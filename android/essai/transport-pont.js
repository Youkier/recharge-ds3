// Client JavaScript du pont de la coque Android (lot C3). Module ES, aucune importation.
//
// Le pont natif (PontLocal.kt) est injecté par addWebMessageListener sous le nom window.PontLocal : on lui envoie une
// chaîne par postMessage et il répond par une chaîne dans onmessage. Les messages sont du JSON :
//   requête  { "n": <entier>, "op": "<opération>", ...paramètres }
//   réponse  { "n": <même entier>, "ok": true|false, ...résultat }  ou  { "n", "ok": false, "erreur": "<code>" }
//
// Opérations (contrat partagé avec PontLocal.kt ; octets en base64, 2 Ko au plus) :
//   demarrage                       -> { variante, auto }   ferme toute connexion restée ouverte (nouvelle page)
//   variante                        -> { variante: "debug" | "release" }
//   prefixeWifi                     -> { prefixe: "10.0.2" } | erreur pas_wifi
//   cable                           -> { configure, deviceId?, cle? }   lu au moment de l'appel, jamais gardé ici
//   saisirCle                       -> {}   ouvre l'écran natif de saisie
//   sonder { ip, delai }            -> { ouvert }   connexion puis fermeture, sans données
//   ouvrir { ip, port, delai }      -> { cx }       une seule connexion de données à la fois
//   envoyer { cx, d }               -> {}
//   recevoir { cx, delai }          -> { d }        erreur delai | ferme
//   fermer { cx }                   -> {}           idempotent
// Erreurs du pont : refuse (adresse, port ou taille hors filtre), pas_wifi, occupe, injoignable, delai, ferme,
// cx_inconnu, operation_inconnue, requete_invalide, origine.
//
// creerTransport() a la même interface que local/transport-node.mjs : ouvrir(ip, port, delaiMs) · envoyer(octets) ·
// recevoir(delaiMs) -> octets · fermer(). Les erreurs portent .code = "hors_ligne" | "delai" | "ferme", seuls codes que
// local/tuya-local.js comprend ; la cause précise (pas_wifi, refuse, occupe…) est gardée dans client.dernierMotif.

const MARGE_REPONSE_MS = 3000; // attente de réponse du pont au-delà du délai demandé

export function enBase64(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
  return btoa(s);
}
export function deBase64(texte) {
  const s = atob(texte);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function erreurTransport(code) { return Object.assign(new Error(code), { code }); }

export function creerClientPont(pont, { margeMs = MARGE_REPONSE_MS } = {}) {
  const attente = new Map();
  let n = 0;
  const client = { dernierMotif: null };

  pont.onmessage = (evt) => {
    let r;
    try { r = JSON.parse(evt.data); } catch { return; }
    if (!r || !Number.isInteger(r.n) || !attente.has(r.n)) return;
    const { resoudre, minuteur } = attente.get(r.n);
    attente.delete(r.n);
    clearTimeout(minuteur);
    resoudre(r);
  };

  // Ne rejette jamais : une réponse manquante devient { ok:false, erreur:"pont_muet" }.
  client.appeler = (op, params = {}, delaiMs = 5000) => new Promise((resoudre) => {
    const id = ++n;
    const minuteur = setTimeout(() => { attente.delete(id); resoudre({ n: id, ok: false, erreur: 'pont_muet' }); }, delaiMs + margeMs);
    attente.set(id, { resoudre, minuteur });
    try { pont.postMessage(JSON.stringify({ n: id, op, ...params })); } catch {
      attente.delete(id); clearTimeout(minuteur); resoudre({ n: id, ok: false, erreur: 'pont_muet' });
    }
  });

  client.demarrage = () => client.appeler('demarrage');
  client.variante = () => client.appeler('variante');
  client.prefixeWifi = () => client.appeler('prefixeWifi');
  client.cable = () => client.appeler('cable');
  client.saisirCle = () => client.appeler('saisirCle');

  // Sonde de port pour localiserCable({ sonder }) : true si le port 6668 accepte, jamais d'exception.
  client.sonder = async (ip, delaiMs) => {
    const r = await client.appeler('sonder', { ip, delai: delaiMs }, delaiMs);
    if (!r.ok) { client.dernierMotif = r.erreur; return false; }
    return r.ouvert === true;
  };

  // Transport pour lireEtat / programmer / localiserCable({ creerTransport }). Une instance = une connexion.
  client.creerTransport = () => {
    let cx = null;
    let ferme = false;
    return {
      async ouvrir(ip, port, delaiMs) {
        if (cx !== null || ferme) throw erreurTransport('hors_ligne'); // une seule connexion par transport
        const r = await client.appeler('ouvrir', { ip, port, delai: delaiMs }, delaiMs);
        if (!r.ok || !Number.isInteger(r.cx)) { client.dernierMotif = r.erreur ?? 'inconnu'; throw erreurTransport('hors_ligne'); }
        if (ferme) { // fermer() est passé pendant l'ouverture (échéance globale) : on referme aussitôt la connexion arrivée trop tard
          await client.appeler('fermer', { cx: r.cx }, 2000);
          throw erreurTransport('ferme');
        }
        cx = r.cx;
      },
      async envoyer(octets) {
        if (cx === null) throw erreurTransport('ferme');
        const r = await client.appeler('envoyer', { cx, d: enBase64(octets) });
        if (!r.ok) { client.dernierMotif = r.erreur ?? 'inconnu'; throw erreurTransport('ferme'); }
      },
      async recevoir(delaiMs) {
        if (cx === null) throw erreurTransport('ferme');
        const r = await client.appeler('recevoir', { cx, delai: delaiMs }, delaiMs);
        if (r.ok && typeof r.d === 'string') {
          const o = deBase64(r.d);
          if (o.length) return o;
          throw erreurTransport('ferme');
        }
        if (r.erreur === 'delai') throw erreurTransport('delai');
        client.dernierMotif = r.erreur ?? 'inconnu';
        throw erreurTransport('ferme');
      },
      async fermer() {
        ferme = true;
        if (cx === null) return;
        const id = cx;
        cx = null;
        await client.appeler('fermer', { cx: id }, 2000);
      },
    };
  };

  return client;
}
