// Interface du site public : lecture des réglages, calcul (calc.js partagé), présentation du résultat.
// Les fonctions du haut sont pures (sans DOM) et testées ; la partie DOM démarre seulement dans un navigateur.
import { plan, hm, fmt, fdur, fr, eur } from "../calc.js";
import { lignesValides, marques, modeles, versions, trouver } from "../vehicules.js";

export const CLE = "recharge-public-v1"; // différente de la clé de la page personnelle
export const AUTRE = "__autre";
export const DEFAUTS = { marque: "", modele: "", version: "", cap: "", courant: "16", amp: "16", volt: "230", eff: "", hcStart: "22:00", hcEnd: "06:00", dep: "07:30", target: "80", soh: "100", pHC: "", pHP: "", nuits: "100", mode: "end" };
export const LIBELLES = { cap: "Capacité utile", amp: "Courant de charge", volt: "Tension", eff: "Rendement de charge", hcStart: "Début des heures creuses", hcEnd: "Fin des heures creuses", dep: "Heure de départ", target: "Batterie visée", soh: "État de santé de la batterie", pHC: "Prix en heures creuses", pHP: "Prix en heures pleines", nuits: "Recharges par an", soc: "Batterie à l'arrivée" };

// Rendement proposé selon la puissance : pertes = 3 % + 250 W fixes (même règle que la page personnelle).
export function effAuto(amp, volt) {
  var P = amp * volt / 1000;
  return P > 0 ? Math.max(1, Math.round(100 * (1 - 0.03 - 0.25 / P))) : NaN;
}

function vide(s) { return s === undefined || s === null || String(s).trim() === ""; }
// Décimal simple seulement : « 1e1 », « 0x1A » ou « 0b11 » sont refusés.
function nombre(s) {
  var t = vide(s) ? "" : String(s).trim();
  return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : NaN;
}
function heureOk(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

// brut : toutes les valeurs en texte, telles que saisies. Rend { p, erreurs, prix }.
export function lireReglages(brut, soc) {
  var b = Object.assign({}, DEFAUTS, brut || {});
  var erreurs = [];
  var p = { pre: 0, deduct: false, mode: b.mode === "start" ? "start" : "end" };
  function err(id, texte) { erreurs.push({ id: id, champ: LIBELLES[id], message: texte }); }
  function num(id, borneMax, minExclu) {
    var v = nombre(b[id]);
    if (!isFinite(v) || v <= 0 || v > borneMax) { err(id, LIBELLES[id] + " : saisissez un nombre entre 0 et " + borneMax + "."); return NaN; }
    return v;
  }
  var cap = nombre(b.cap);
  if (!isFinite(cap) || cap <= 0 || cap > 250) err("cap", "Capacité utile : choisissez votre voiture ou saisissez la capacité utile de la batterie en kWh.");
  p.cap = cap;
  p.amp = num("amp", 80);
  p.volt = num("volt", 260);
  p.soh = num("soh", 100);
  p.target = num("target", 100);
  ["hcStart", "hcEnd", "dep"].forEach(function (id) {
    if (!heureOk(b[id])) err(id, LIBELLES[id] + " : saisissez une heure, par exemple 22:00.");
    p[id] = String(b[id]).trim();
  });
  if (vide(b.eff)) p.eff = effAuto(p.amp, p.volt);
  else p.eff = num("eff", 100);
  var n = vide(b.nuits) ? 100 : nombre(b.nuits);
  if (!isFinite(n) || n < 1 || n > 366 || Math.floor(n) !== n) err("nuits", LIBELLES.nuits + " : saisissez un nombre entier entre 1 et 366.");
  p.nuits = n;
  var h = nombre(b.pHC), q = nombre(b.pHP), prix = false;
  if (vide(b.pHC) && vide(b.pHP)) { p.pHC = 0; p.pHP = 0; }
  else {
    var okH = isFinite(h) && h > 0 && h < 10, okQ = isFinite(q) && q > 0 && q < 10;
    if (!okH) err("pHC", LIBELLES.pHC + " : saisissez un prix en €/kWh, par exemple 0,15, ou laissez les deux prix vides.");
    if (!okQ) err("pHP", LIBELLES.pHP + " : saisissez un prix en €/kWh, par exemple 0,20, ou laissez les deux prix vides.");
    p.pHC = h; p.pHP = q; prix = okH && okQ;
  }
  if (soc !== undefined) {
    var s = nombre(soc);
    if (!isFinite(s) || s < 0 || s > 100) err("soc", LIBELLES.soc + " : saisissez un pourcentage entre 0 et 100.");
    p.soc = s;
  }
  return { p: p, erreurs: erreurs, prix: prix };
}

// Rend le modèle de vue : { statut, titre, message, lignes:[[libellé, valeur]], champ, prixManquants, chiffres }.
export function resultat(brut, soc) {
  var lu = lireReglages(brut, soc);
  var vue = { statut: "", titre: "", message: "", lignes: [], champ: null, prixManquants: false, chiffres: null };
  if (lu.erreurs.length) {
    vue.statut = "err";
    vue.titre = "Une saisie est à corriger";
    vue.message = lu.erreurs[0].message;
    vue.champ = lu.erreurs[0].id;
    return vue;
  }
  var p = lu.p, prix = lu.prix;
  var r = plan(p);
  vue.statut = r.status;
  vue.prixManquants = !prix;
  if (r.status === "err") {
    vue.titre = "Calcul impossible";
    vue.message = "Vérifiez la capacité utile, l'état de santé, le courant, la tension et le rendement : ils doivent être supérieurs à zéro.";
    vue.champ = "cap";
    return vue;
  }
  if (r.status === "none") {
    vue.titre = "Pas de charge nécessaire ce soir";
    vue.message = "La batterie est déjà à " + fr(p.soc, 0) + " %, la cible est " + fr(p.target, 0) + " %.";
    return vue;
  }
  var arrondi = Math.round(r.arrival);
  vue.titre = "Démarrer la charge à " + fmt(r.start);
  if (r.status === "ok") {
    vue.message = "Fin à " + fmt(r.end) + ". La batterie sera vers " + arrondi + " %.";
  } else {
    var manque = Math.ceil(p.target - r.arrival - 1e-9);
    var hp = Math.round(r.offMin);
    if (manque > 0) vue.message = "La cible de " + fr(p.target, 0) + " % ne sera pas atteinte dans vos heures creuses : il manquera environ " + manque + " %. Fin à " + fmt(r.end) + ", batterie vers " + arrondi + " %.";
    else vue.message = "La cible est atteinte, mais il faut commencer avant vos heures creuses. Fin à " + fmt(r.end) + ", batterie vers " + arrondi + " %.";
    if (hp > 0) vue.lignes.push(["Dont hors heures creuses", fdur(hp)]);
    if (prix && r.kwhHP > 0 && p.pHP > p.pHC) vue.lignes.push(["Surcoût du dépassement", eur(r.kwhHP * (p.pHP - p.pHC))]);
  }
  vue.lignes.unshift(["Fin de la charge", fmt(r.end)], ["Durée", fdur(r.chargeMin)], ["Énergie", fr(r.kwh, 1) + " kWh"]);
  if (prix) vue.lignes.push(["Coût de la nuit", eur(r.cost)]);
  // Les deux chiffres à partager : l'économie n'existe que si les prix sont saisis (jamais un 0 € trompeur).
  var econ = null, nuits100 = null;
  if (prix && r.kwhHC > 0 && p.pHP > p.pHC) econ = Math.round(r.kwhHC * (p.pHP - p.pHC) * p.nuits);
  if (p.target < 100) nuits100 = p.nuits;
  vue.chiffres = { economie: econ, nuits: nuits100, recharges: p.nuits };
  return vue;
}

// Texte des chiffres à partager et de leur mode de calcul.
export function texteChiffres(c) {
  var lignes = [];
  if (c.economie !== null) lignes.push("Économie estimée : " + fr(c.economie, 0) + " € par an par rapport aux heures pleines");
  if (c.nuits !== null) lignes.push(c.nuits + " nuits à 100 % évitées par an");
  return lignes;
}
export function modeCalcul(c) {
  return "Hypothèse : " + c.recharges + " recharges par an. Économie = énergie rechargée en heures creuses × (prix heures pleines − prix heures creuses) × recharges par an. Nuits à 100 % évitées = recharges par an, si la batterie visée est inférieure à 100 %.";
}

// ---------------------------------------------------------------- DOM
function demarrer() {
  var $ = function (id) { return document.getElementById(id); };
  var form = $("calcul");
  var lignes = [];
  var champsTexte = ["cap", "amp", "volt", "eff", "hcStart", "hcEnd", "dep", "target", "soh", "pHC", "pHP", "nuits"];

  function option(select, valeur, texte) {
    var o = document.createElement("option"); o.value = valeur; o.textContent = texte; select.appendChild(o);
  }
  function remplir(select, valeurs, invite) {
    select.textContent = "";
    if (invite) option(select, "", invite);
    valeurs.forEach(function (v) { option(select, v, v); });
  }

  function lireBrut() {
    var b = {};
    champsTexte.forEach(function (k) { b[k] = $(k).value; });
    var c = form.querySelector('input[name="courant"]:checked');
    b.courant = c ? c.value : "16";
    b.amp = b.courant === "autre" ? $("amp").value : b.courant;
    var m = form.querySelector('input[name="mode"]:checked');
    b.mode = m ? m.value : "end";
    b.marque = $("marque").value; b.modele = $("modele").value; b.version = $("version").value;
    if (b.marque !== AUTRE) {
      var t = trouver(lignes, { marque: b.marque, modele: b.modele, version: b.version });
      b.cap = t ? String(t.cap) : "";
    }
    return b;
  }

  function enregistrer(b) { try { localStorage.setItem(CLE, JSON.stringify(b)); } catch (e) { /* stockage indisponible : on continue sans */ } }
  function charger() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(CLE) || "null"); } catch (e) { s = null; }
    return s && typeof s === "object" ? s : null;
  }

  function zones(b) {
    var autre = b.marque === AUTRE;
    $("zone-modele").hidden = !b.marque || autre;
    $("zone-version").hidden = !b.modele || autre;
    $("zone-cap").hidden = !autre;
    $("zone-amp").hidden = b.courant !== "autre";
    var info = $("info-cap");
    var t = !autre && b.marque ? trouver(lignes, { marque: b.marque, modele: b.modele, version: b.version }) : null;
    info.hidden = !t;
    info.textContent = t ? "Capacité utile retenue : " + fr(t.cap, 1) + " kWh." : "";
  }

  function choixVoiture(marque, modele, version) {
    var selM = $("marque");
    selM.value = marque || "";
    var autre = marque === AUTRE;
    if (marque && !autre) {
      remplir($("modele"), modeles(lignes, marque), "Choisir un modèle");
      $("modele").value = modele || "";
      if ($("modele").value) {
        var vs = versions(lignes, marque, $("modele").value);
        remplir($("version"), vs.map(function (v) { return v.libelle; }), "Choisir une version");
        $("version").value = version || "";
        if (!$("version").value && vs.length === 1) $("version").value = vs[0].libelle;
      }
    }
  }

  function afficher(vue) {
    var res = $("resultat");
    res.textContent = "";
    res.dataset.statut = vue.statut || "attente";
    function el(tag, texte, classe) { var e = document.createElement(tag); if (texte) e.textContent = texte; if (classe) e.className = classe; return e; }
    res.appendChild(el("p", vue.titre, "grand"));
    if (vue.message) res.appendChild(el("p", vue.message));
    if (vue.lignes.length) {
      var dl = el("dl", "", "details");
      vue.lignes.forEach(function (l) { dl.appendChild(el("dt", l[0])); dl.appendChild(el("dd", l[1])); });
      res.appendChild(dl);
    }
    if (vue.champ) {
      var bt = el("button", "Aller au champ à corriger"); bt.type = "button";
      bt.addEventListener("click", function () {
        var c = $(vue.champ === "cap" && $("zone-cap").hidden ? "marque" : vue.champ);
        if (!c) return;
        for (var d = c.parentElement; d; d = d.parentElement) if (d.tagName === "DETAILS") d.open = true;
        c.focus();
      });
      res.appendChild(bt);
    }
    if (vue.prixManquants && (vue.statut === "ok" || vue.statut === "short")) {
      res.appendChild(el("p", "Saisissez vos prix de l'électricité (ils figurent sur votre facture) pour voir le coût de la nuit et l'économie.", "aide"));
      var bp = el("button", "Saisir mes prix"); bp.type = "button";
      bp.addEventListener("click", function () { $("reglages").open = true; $("avance").open = true; $("pHC").focus(); });
      res.appendChild(bp);
    }
    var part = $("partage"), ul = $("chiffres");
    ul.textContent = "";
    var tc = vue.chiffres ? texteChiffres(vue.chiffres) : [];
    tc.forEach(function (t) { ul.appendChild(el("li", t)); });
    part.hidden = !tc.length;
    $("mode-calcul").textContent = vue.chiffres ? modeCalcul(vue.chiffres) : "";
  }

  function recalculer() {
    var b = lireBrut();
    zones(b);
    var auto = effAuto(nombre(b.amp), nombre(b.volt));
    $("info-eff").textContent = isFinite(auto) ? "Automatique : " + auto + " % selon le courant." : "";
    enregistrer(b);
    var soc = $("soc").value;
    if (vide(soc)) { afficher({ statut: "attente", titre: "Saisissez la batterie à l'arrivée", message: "L'heure de début de charge s'affichera ici.", lignes: [], champ: null, prixManquants: false, chiffres: null }); return; }
    afficher(resultat(b, soc));
  }

  function restaurer(s, defautsPrix) {
    var b = Object.assign({}, DEFAUTS, defautsPrix);
    if (s) Object.keys(DEFAUTS).forEach(function (k) { if (typeof s[k] === "string") b[k] = s[k]; });
    champsTexte.forEach(function (k) { $(k).value = b[k]; });
    var rc = form.querySelector('input[name="courant"][value="' + (["10", "16", "32", "autre"].indexOf(b.courant) >= 0 ? b.courant : "16") + '"]');
    if (rc) rc.checked = true;
    var rm = form.querySelector('input[name="mode"][value="' + (b.mode === "start" ? "start" : "end") + '"]');
    if (rm) rm.checked = true;
    choixVoiture(b.marque, b.modele, b.version);
  }

  // Liste des véhicules : si elle ne charge pas, la saisie de la capacité reste possible.
  function listeChargee(doc) {
    lignes = lignesValides(doc);
    var sel = $("marque");
    sel.textContent = "";
    option(sel, "", "Choisir une marque");
    marques(lignes).forEach(function (m) { option(sel, m, m); });
    option(sel, AUTRE, "Elle n'est pas dans la liste");
  }
  function listeAbsente() {
    var sel = $("marque");
    sel.textContent = "";
    option(sel, AUTRE, "Saisir la capacité utile à la main");
  }

  var defautsPrix = { pHC: form.dataset.phc || "", pHP: form.dataset.php || "" };
  var sauve = charger();
  // Rien n'est recalculé ni enregistré avant init : une saisie faite pendant le chargement de
  // la liste ne doit pas écraser les réglages sauvegardés.
  var pret = false;

  function init(doc) {
    pret = true;
    if (doc) listeChargee(doc); else listeAbsente();
    restaurer(sauve, defautsPrix);
    if (!doc) $("marque").value = AUTRE;
    // Réglages déjà complets : le bloc des questions est replié, il reste modifiable.
    var lu = lireReglages(lireBrut());
    if (sauve && !lu.erreurs.length) { $("reglages").open = false; $("resume-reglages").textContent = "Mes réglages (modifier)"; }
    recalculer();
  }

  fetch("vehicules.json").then(function (r) { if (!r.ok) throw new Error("liste"); return r.json(); })
    .then(init, function () { init(null); });

  form.addEventListener("input", function () { if (pret) recalculer(); });
  form.addEventListener("change", function (e) {
    if (!pret) return;
    if (e.target.id === "marque") { choixVoiture(e.target.value, "", ""); }
    else if (e.target.id === "modele") { choixVoiture($("marque").value, e.target.value, ""); }
    recalculer();
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  $("valider").addEventListener("click", function () {
    if (!pret) return;
    var lu = lireReglages(lireBrut());
    if (lu.erreurs.length) {
      afficher({ statut: "err", titre: "Une saisie est à corriger", message: lu.erreurs[0].message, lignes: [], champ: lu.erreurs[0].id, prixManquants: false, chiffres: null });
      return;
    }
    $("reglages").open = false;
    $("resume-reglages").textContent = "Mes réglages (modifier)";
    $("soc").focus();
    recalculer();
  });
}

if (typeof document !== "undefined") demarrer();
