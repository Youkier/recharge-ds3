// Calcul de la recharge DS 3 (module ES, sans dépendance, sans accès au DOM).
// Code repris tel quel de site/index.html (version validée du 08/11/2026).
// Référence : tests/golden-cases.json. Voir la skill calcul-recharge.

export function hm(s) { var a = String(s || "0:0").split(":"); return (parseInt(a[0], 10) || 0) * 60 + (parseInt(a[1], 10) || 0); }
export function pad(n) { return (n < 10 ? "0" : "") + n; }
export function fmt(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
export function fdur(m) { m = Math.round(m); return Math.floor(m / 60) + " h " + pad(m % 60); }
export function fr(x, d) { return x.toFixed(d).replace(".", ","); }
export function eur(x) { return fr(x, 2) + " €"; }

// Rendement proposé selon la puissance (courant × tension) : pertes = 3 % + 250 W fixes.
// Source : ADAC, mesure du 06/08/2026 (100 à 300 W pour l'électronique de charge ;
// 12,7 à 24,2 % de pertes à 2,3 kW). Donne 90 % à 16 A, valeur validée de la page.
export function effAuto(amp, volt) {
  var P = amp * volt / 1000;
  return P > 0 ? Math.max(1, Math.round(100 * (1 - 0.03 - 0.25 / P))) : NaN;
}

// ---------- Changement d'heure (Europe/Paris) ----------
// Décision de Mathieu du 2026-11-22 : la nuit du dernier dimanche de mars dure 7 h (02:00 -> 03:00), celle du dernier
// dimanche d'octobre 9 h (03:00 -> 02:00). Fonctions pures : la date du soir est un paramètre, jamais lue ici.

// Jour du mois du dernier dimanche (mois : 0 = janvier).
export function dernierDimanche(an, mois) {
  var d = new Date(Date.UTC(an, mois + 1, 0)); // dernier jour du mois
  return d.getUTCDate() - d.getUTCDay();
}

// soir : date du soir où la nuit commence, en objet Date (composantes locales) ou en texte AAAA-MM-JJ.
// Rend null (nuit ordinaire) ou { sens: "ete" | "hiver", decalage: -60 | 60, minute: 120 | 180 } :
// decalage = durée réelle de la nuit moins sa durée murale (minutes) ; minute = heure murale (depuis minuit) du saut.
export function nuitChangementHeure(soir) {
  var a, m, j;
  if (typeof soir === "string") {
    var t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(soir);
    if (!t) return null;
    a = Number(t[1]); m = Number(t[2]) - 1; j = Number(t[3]);
  } else if (soir instanceof Date && !isNaN(soir.getTime())) {
    a = soir.getFullYear(); m = soir.getMonth(); j = soir.getDate();
  } else return null;
  var d = new Date(Date.UTC(a, m, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m || d.getUTCDate() !== j) return null; // date impossible (30/02…)
  var l = new Date(Date.UTC(a, m, j + 1)); // le changement a lieu le dimanche matin : le soir est le samedi
  if (l.getUTCDay() !== 0) return null;
  var mo = l.getUTCMonth(), jo = l.getUTCDate(), an = l.getUTCFullYear();
  if (mo === 2 && jo === dernierDimanche(an, 2)) return { sens: "ete", decalage: -60, minute: 120 };
  if (mo === 9 && jo === dernierDimanche(an, 9)) return { sens: "hiver", decalage: 60, minute: 180 };
  return null;
}

// Date du soir (minuit local) de la nuit en cours ou à venir. Si les heures creuses traversent minuit et qu'il est
// plus tôt que leur fin (la nuit est déjà commencée), le soir est la veille.
export function soirDe(maintenant, hcStart, hcEnd) {
  var j = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  var minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  if (hm(hcStart) > hm(hcEnd) && minutes < hm(hcEnd)) j = new Date(j.getFullYear(), j.getMonth(), j.getDate() - 1);
  return j;
}

// Date de soir simulée par l'adresse (?soir=AAAA-MM-JJ), pour essayer les nuits de changement d'heure :
// seulement sur la machine locale (127.0.0.1, localhost), jamais sur le site en ligne ni dans l'appli.
export function soirSimule(recherche, hote) {
  if (hote !== "127.0.0.1" && hote !== "localhost") return null;
  var t = /(?:^|[?&])soir=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(String(recherche || ""));
  return t ? t[1] : null;
}

export function texteChangementHeure(nuit) {
  if (!nuit) return "";
  return nuit.sens === "ete"
    ? "Cette nuit, passage à l'heure d'été : la nuit dure 1 h de moins, l'heure d'allumage en tient compte."
    : "Cette nuit, retour à l'heure d'hiver : la nuit dure 1 h de plus, l'heure d'allumage en tient compte.";
}

export function plan(p) {
  var usable = p.cap * p.soh / 100;
  var P = p.amp * p.volt / 1000;
  var rate = P * p.eff / 100;
  var pctPerHour = rate / usable * 100;
  var preGain = p.deduct ? rate * 0.5 * (p.pre / 60) / usable * 100 : 0;
  var hcS = hm(p.hcStart), hcE = hm(p.hcEnd), dep = hm(p.dep), preS = dep - p.pre;
  var rel = function (x) { return ((x - hcS) % 1440 + 1440) % 1440; };
  // Nuit de changement d'heure (p.nuit, voir nuitChangementHeure) : tout le calcul se fait en minutes RÉELLES écoulées depuis
  // le début des heures creuses ; seules les heures affichées (et réglées sur le câble) sont des heures murales.
  // Sans p.nuit, les deux conversions ne changent rien : les cas de référence sont inchangés.
  var nuit = p.nuit && (p.nuit.decalage === -60 || p.nuit.decalage === 60) ? p.nuit : null;
  var c = nuit ? rel(nuit.minute) : 0; // saut, en minutes murales depuis le début des heures creuses
  var ete = !!nuit && nuit.decalage < 0;
  var vraie = function (w) { // minutes murales -> minutes réelles
    if (!nuit || w < c) return w;
    return ete ? (w < c + 60 ? c : w - 60) : w + 60;
  };
  var murale = function (x) { // minutes réelles -> minutes murales
    if (!nuit || x < c) return x;
    return ete ? x + 60 : x - 60;
  };
  var hcLen = vraie(rel(hcE) || 1440);
  var depRelMurale = rel(dep);
  var preRel = vraie(rel(preS)), depRel = vraie(depRelMurale);
  var limit = preRel < hcLen ? preRel : hcLen;
  var need = p.target - p.soc - preGain;
  var r = { usable: usable, P: P, pctPerHour: pctPerHour, preGain: preGain, hcLen: hcLen, preRel: preRel, depRel: depRel, hcS: hcS, preS: preS, dep: dep };
  r.versMurale = function (x) { return hcS + murale(x); }; // minutes réelles depuis le début des HC -> heure murale (minutes)
  // need non fini = cible, batterie ou préconditionnement vide : refusé plutôt que « ok » avec des heures NaN:NaN.
  if (!(usable > 0) || !(pctPerHour > 0) || !isFinite(need)) { r.status = "err"; return r; }
  if (need <= 0) {
    r.status = "none"; r.startRel = r.endRel = 0; r.chargeMin = 0; r.offMin = 0;
  } else {
    var needMin = Math.ceil(need / pctPerHour * 60 / 5) * 5;
    r.needMin = needMin;
    if (needMin > limit) {
      r.status = "short";
      r.endRel = limit;
      r.startRel = Math.max(Math.floor((limit - needMin) / 5) * 5, depRelMurale + 30 - 1440); // veille : pas de changement d'heure
    } else {
      r.status = "ok";
      if (p.mode === "start") { r.startRel = 0; r.endRel = needMin; }
      else { r.endRel = limit; r.startRel = Math.floor((limit - needMin) / 5) * 5; }
    }
    if (nuit && !ete) {
      // Octobre : l'heure c..c+60 existe deux fois et l'heure murale du câble désigne la première. Un début réel dans la
      // seconde est avancé au dernier créneau de la première (jamais de charge trop courte) ; une fin y est reportée à 03:00.
      if (r.startRel >= c && r.startRel < c + 60) r.startRel = Math.floor((c - 1) / 5) * 5;
      if (r.endRel >= c && r.endRel < c + 60) r.endRel = c + 60;
    }
    r.chargeMin = r.endRel - r.startRel;
    r.offMin = Math.max(0, -r.startRel) + Math.max(0, r.endRel - hcLen);
  }
  r.charged = r.chargeMin / 60 * pctPerHour;
  r.arrival = Math.min(100, p.soc + r.charged + preGain);
  r.kwh = r.chargeMin / 60 * P;
  r.kwhHP = r.offMin / 60 * P;
  r.kwhHC = r.kwh - r.kwhHP;
  r.cost = r.kwhHC * (p.pHC || 0) + r.kwhHP * (p.pHP || 0);
  r.start = hcS + murale(r.startRel); r.end = hcS + murale(r.endRel);
  return r;
}
