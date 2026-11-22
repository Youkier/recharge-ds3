// Heure d'allumage calculée par la page (site/calc.js) pour une batterie donnée, avec les réglages par défaut.
// Sert aux scénarios d'émulateur (android/ci/scenarios.sh) : ils doivent connaître l'heure que la page va proposer
// pour régler le faux câble en conséquence. Aucun accès réseau, aucun fichier de secrets.
//
//   node tools/heure-page.mjs heure <soc>     -> « HH:MM » (début de charge pour <soc> % à l'arrivée)
//   node tools/heure-page.mjs immediat        -> « <soc> <début> <fin> » : batterie à saisir, heure calculée par la page,
//                                                fin de plage à donner au faux câble pour que cette heure soit déjà passée
//
// Les réglages par défaut recopient DEFAULTS de site/app.js ; tests/heure-page.test.mjs vérifie qu'ils restent identiques.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, fmt, hm, nuitChangementHeure, soirDe } from "../site/calc.js";

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

const MARGE_AVANT = 4; // minutes : l'horloge avance pendant que le scénario tourne
const moinsMinutes = (hhmm, n) => fmt(hm(hhmm) - n);

/**
 * Cas « démarrage immédiat » déterministe, quelle que soit l'heure (Paris) à laquelle tourne l'essai.
 * Le téléphone décide « immédiat » si l'heure actuelle est dans [début, fin de la plage du câble) : avec fin = début - 1 min,
 * c'est vrai pendant 1439 minutes sur 1440. On choisit la batterie dont le début n'est pas dans les quelques minutes
 * qui entourent l'heure actuelle, seul instant où la règle dirait le contraire.
 */
export function choisirImmediat(maintenantHHMM, nuit = null) {
  const n = hm(maintenantHHMM);
  for (let soc = SOC_DE_DEPART + 1; soc < REGLAGES_PAR_DEFAUT.target; soc++) {
    const debut = heurePage(soc, nuit);
    if (!debut) continue;
    const ecart = (((hm(debut) - n) % 1440) + 1440) % 1440; // minutes à attendre avant que <début> arrive
    if (ecart < MARGE_AVANT + 1 || ecart > 1440 - 1) continue; // l'heure actuelle est dans [début - 4 min ; début]
    return { soc, debut, fin: moinsMinutes(debut, 1) };
  }
  throw new Error("aucune batterie ne convient");
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
    } else if (action === "immediat") {
      const c = choisirImmediat(heureParis(), nuitCourante());
      console.log(`${c.soc} ${c.debut} ${c.fin}`);
    } else throw new Error("usage : heure-page.mjs heure <soc> | immediat");
  } catch (e) { console.error("heure-page : " + e.message); process.exit(1); }
}
