// Heure d'allumage calculée par la page (site/calc.js) pour une batterie donnée, avec les réglages par défaut.
// Sert aux scénarios d'émulateur (android/ci/scenarios.sh) : ils doivent connaître l'heure que la page va proposer
// pour régler le faux câble en conséquence. Aucun accès réseau, aucun fichier de secrets.
//
//   node tools/heure-page.mjs heure <soc>     -> « HH:MM » (début de charge pour <soc> % à l'arrivée)
//   node tools/heure-page.mjs tardif          -> « tardif <soc> <début> <durée> » | « trop_tard <soc> <début> » | « aucun » :
//                                                batterie à saisir pour que, à l'heure actuelle (Paris), l'heure calculée par la
//                                                page soit déjà passée (démarrage tardif, décision du 2026-11-22) ; « durée » =
//                                                minutes de charge du plan ; « aucun » si aucun cas ne tient à cette heure
//   node tools/heure-page.mjs decision <soc>  -> « normal » | « tardif » | « trop_tard » | « variable » : ce que le téléphone
//                                                ferait maintenant (et dans les 6 prochaines minutes) pour le plan de <soc> %
//
// Les réglages par défaut recopient DEFAULTS de site/app.js ; tests/heure-page.test.mjs vérifie qu'ils restent identiques.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, fmt, hm, nuitChangementHeure, soirDe } from "../site/calc.js";
import { deciderPlage } from "../worker/src/service.js"; // la règle du démarrage tardif (même résultats que la coque, tests/plage-tardif-cas.json)

export const REGLAGES_PAR_DEFAUT = Object.freeze({
  cap: 46, soh: 95, target: 80, dep: "07:30", hcStart: "22:00", hcEnd: "06:00", amp: 16, volt: 230, eff: 90, mode: "end",
});
export const SOC_DE_DEPART = 38; // valeur par défaut de la batterie : « Ajouter 1 % » part de là quand le champ est vide

/** Nuit de changement d'heure du soir en cours (comme la page), ou null. */
export function nuitCourante(maintenant = new Date()) {
  return nuitChangementHeure(soirDe(maintenant, REGLAGES_PAR_DEFAUT.hcStart, REGLAGES_PAR_DEFAUT.hcEnd));
}

/** « HH:MM » de début de charge pour <soc> %, ou null si la page ne proposerait pas d'heure (pas de charge, erreur). */
export function heurePage(soc, nuit = null) {
  const r = plan({ ...REGLAGES_PAR_DEFAUT, soc, pre: 0, deduct: false, nuit });
  return r.status === "ok" || r.status === "short" ? fmt(r.start) : null;
}

/** Demande que la page enverrait pour <soc> % (contrat du 2026-11-22), ou null si le plan ne donne pas d'heure. */
export function demandePage(soc, nuit = null) {
  const r = plan({ ...REGLAGES_PAR_DEFAUT, soc, pre: 0, deduct: false, nuit });
  if (r.status !== "ok" && r.status !== "short") return null;
  return { allumage: fmt(r.start), fin: fmt(r.end), duree_min: r.chargeMin, depart: REGLAGES_PAR_DEFAUT.dep };
}

const DECALAGES_MIN = [0, 2, 4, 6]; // l'horloge avance pendant que le scénario tourne : la décision doit rester la même
const statuts = (demande, maintenant) => DECALAGES_MIN.map((k) => deciderPlage(demande, new Date(maintenant.getTime() + k * 60000)).statut);

/** Ce que le téléphone ferait pour <soc> % : « normal » | « tardif » | « trop_tard », ou « variable » si cela change dans les minutes qui viennent. */
export function decisionPage(soc, maintenant = new Date(), nuit = null) {
  const d = demandePage(soc, nuit);
  if (!d) return "aucun";
  const v = statuts(d, maintenant);
  return v.every((x) => x === v[0]) ? v[0] : "variable";
}

/**
 * Cas « démarrage tardif » ou « trop tard » déterministe à l'heure actuelle (Paris), pour les scénarios d'émulateur.
 * Le téléphone décale le début (maintenant + 10 min) si l'heure calculée est passée (entre elle et le départ, 07:30) ;
 * l'heure calculée la plus tôt (batterie à 0 %) est 19:25 : de 19:35 environ à 07:20, un cas existe ; de 07:20 à 07:30, tout
 * cas passé donne « trop tard » ; de 07:30 à 19:25, aucun (rendu : null). On choisit la batterie la plus haute qui convient (peu
 * de gestes pour la saisir). La décision doit rester la même pendant les 6 minutes qui suivent.
 * -> { cas: "tardif" | "trop_tard", soc, debut, dureeMin } ou null.
 */
export function choisirTardif(maintenant = new Date(), nuit = null) {
  for (let soc = REGLAGES_PAR_DEFAUT.target - 1; soc >= 0; soc--) {
    const d = demandePage(soc, nuit);
    if (!d) continue;
    const v = statuts(d, maintenant);
    if (v.every((x) => x === "tardif")) return { cas: "tardif", soc, debut: d.allumage, dureeMin: d.duree_min };
    if (v.every((x) => x === "trop_tard")) return { cas: "trop_tard", soc, debut: d.allumage, dureeMin: d.duree_min };
  }
  return null;
}

const formatParis = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function heureParis(date = new Date()) {
  const p = Object.fromEntries(formatParis.formatToParts(date).map((x) => [x.type, x.value]));
  return `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, arg] = process.argv.slice(2);
  try {
    if (action === "heure" && /^\d{1,3}$/.test(arg || "")) {
      const h = heurePage(Number(arg), nuitCourante());
      if (!h) throw new Error("pas d'heure proposée pour cette batterie");
      console.log(h);
    } else if (action === "tardif") {
      const c = choisirTardif(new Date(), nuitCourante());
      console.log(c ? (c.cas === "tardif" ? `tardif ${c.soc} ${c.debut} ${c.dureeMin}` : `trop_tard ${c.soc} ${c.debut}`) : "aucun");
    } else if (action === "decision" && /^\d{1,3}$/.test(arg || "")) {
      console.log(decisionPage(Number(arg), new Date(), nuitCourante()));
    } else throw new Error("usage : heure-page.mjs heure <soc> | tardif | decision <soc>");
  } catch (e) { console.error("heure-page : " + e.message); process.exit(1); }
}
