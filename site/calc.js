// Calcul de la recharge DS 3 (module ES, sans dépendance, sans accès au DOM).
// Code repris tel quel de site/index.html (version validée du 08/11/2026).
// Référence : tests/golden-cases.json. Voir la skill calcul-recharge.

export function hm(s) { var a = String(s || "0:0").split(":"); return (parseInt(a[0], 10) || 0) * 60 + (parseInt(a[1], 10) || 0); }
export function pad(n) { return (n < 10 ? "0" : "") + n; }
export function fmt(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
export function fdur(m) { m = Math.round(m); return Math.floor(m / 60) + " h " + pad(m % 60); }
export function fr(x, d) { return x.toFixed(d).replace(".", ","); }
export function eur(x) { return fr(x, 2) + " €"; }

export function plan(p) {
  var usable = p.cap * p.soh / 100;
  var P = p.amp * p.volt / 1000;
  var rate = P * p.eff / 100;
  var pctPerHour = rate / usable * 100;
  var preGain = p.deduct ? rate * 0.5 * (p.pre / 60) / usable * 100 : 0;
  var hcS = hm(p.hcStart), hcE = hm(p.hcEnd), dep = hm(p.dep), preS = dep - p.pre;
  var rel = function (x) { return ((x - hcS) % 1440 + 1440) % 1440; };
  var hcLen = rel(hcE) || 1440;
  var preRel = rel(preS), depRel = rel(dep);
  var limit = preRel < hcLen ? preRel : hcLen;
  var need = p.target - p.soc - preGain;
  var r = { usable: usable, P: P, pctPerHour: pctPerHour, preGain: preGain, hcLen: hcLen, preRel: preRel, depRel: depRel, hcS: hcS, preS: preS, dep: dep };
  if (!(usable > 0) || !(pctPerHour > 0)) { r.status = "err"; return r; }
  if (need <= 0) {
    r.status = "none"; r.startRel = r.endRel = 0; r.chargeMin = 0; r.offMin = 0;
  } else {
    var needMin = Math.ceil(need / pctPerHour * 60 / 5) * 5;
    r.needMin = needMin;
    if (needMin > limit) {
      r.status = "short";
      r.endRel = limit;
      r.startRel = Math.max(Math.floor((limit - needMin) / 5) * 5, depRel + 30 - 1440);
    } else {
      r.status = "ok";
      if (p.mode === "start") { r.startRel = 0; r.endRel = needMin; }
      else { r.endRel = limit; r.startRel = Math.floor((limit - needMin) / 5) * 5; }
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
  r.start = hcS + r.startRel; r.end = hcS + r.endRel;
  return r;
}
