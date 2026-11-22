import { plan, hm, fmt, fdur, fr, eur, effAuto, nuitChangementHeure, soirDe, soirSimule, texteChangementHeure } from "./calc.js";
import { lignesValides, marques, modeles, versions, trouver } from "./vehicules.js";
import { validerAdresse, validerJeton, choisirDemande, libelleBouton, envoyer, resultatKo, lireEtatService, RAPPEL_REPROGRAMMER } from "./service.js";
import { confirmationValable, blocageCable, plageRelue, plageDuCable, ligneCable, dejaProgramme, libelleDejaProgramme, contexteHoraire, LIBELLES_SOC, mentionProvisoire, sousLigneBouton, socValide, moyenEnvoi, boutonActif, programmerSelonMoyen, pastille, secondesRestantes, rechercheAutomatique, decisionEnvoi, attenteExpiree, suiviWifiActif, etapeAttente, lectureDue, quitterSiCache, confValable, plafondDepasse, PREPARATION_MAX_MS, ENVOI_PLAFOND_MS, resultatNotification, heureNotification, suiteLecture, codeEcheance, LIBELLES_ATTENTE, ATTENTE_SONDE_MS, SUIVI_PASTILLE_MS } from "./accueil.js";

(function () {
  var DEFAULTS = { cap: 46, soh: 95, target: 80, dep: "07:30", hcStart: "22:00", hcEnd: "06:00", amp: 16, volt: 230, eff: 90, pHC: 0.146688, pHP: 0.196476, mode: "end", soc: 38 };
  var AMPS = [6, 8, 10, 13, 16, 32]; // câble : 6 à 16 A (x_adjust_current, docs/tuya-findings.md) ; 32 A = borne 7,4 kW
  var KEY = "recharge-ds3-v1"; // clé identique depuis la phase 1 : aucun paramètre perdu
  var ids = ["cap", "soh", "target", "dep", "hcStart", "hcEnd", "amp", "volt", "eff", "pHC", "pHP", "mode"];
  var NUMS = ["cap", "soh", "target", "amp", "volt", "eff", "pHC", "pHP"];
  var CAR = ["cap", "soh"], CABLE = ["amp", "volt", "eff"];
  var $ = function (id) { return document.getElementById(id); };
  var radios = function () { return document.querySelectorAll('input[name="mode"]'); };

  // « mode » est un groupe de boutons radio ; les autres clés sont des champs portant leur id.
  function getVal(k) {
    if (k !== "mode") return $(k).value;
    var c = document.querySelector('input[name="mode"]:checked');
    return c ? c.value : "end";
  }
  function setVal(k, v) {
    if (k !== "mode") { $(k).value = v; return; }
    Array.prototype.forEach.call(radios(), function (r) { r.checked = r.value === v; });
  }

  // Dernières valeurs valides de chaque champ : sert à l'enregistrement et à l'aide.
  var cur = Object.assign({}, DEFAULTS);
  // Premier lancement ou données effacées : aucun réglage enregistré (réglages par défaut), ou aucune dernière batterie.
  var KEY_DEFAUTS = "recharge-ds3-defauts-vus";
  var reglagesParDefaut = false, socEnregistre = false;

  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    reglagesParDefaut = !(s && typeof s === "object");
    socEnregistre = !!(s && typeof s === "object" && socValide(s.soc) !== null);
    var p = Object.assign({}, DEFAULTS);
    if (s && typeof s === "object") Object.keys(DEFAULTS).forEach(function (k) { if (s[k] !== null && s[k] !== undefined) p[k] = s[k]; });
    if (AMPS.indexOf(Number(p.amp)) < 0) { // ancienne valeur saisie à la main, absente de la liste
      p.amp = DEFAULTS.amp;
      var e = effAuto(p.amp, Number(p.volt)); // le rendement suit le courant ramené à 16 A
      if (isFinite(e)) p.eff = e;
    }
    ids.forEach(function (k) { setVal(k, p[k]); });
    $("soc").value = socEnregistre ? p.soc : ""; // sans dernière valeur : le champ reste vide (« Entrez votre batterie »)
  }
  // La batterie par défaut n'est jamais enregistrée comme si elle avait été saisie.
  function save(p) {
    var c = Object.assign({}, p);
    if (!socEnregistre) delete c.soc;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
  }

  var LABELS = { cap: "Capacité utile", soh: "SOH", target: "Batterie visée", dep: "Heure de départ", hcStart: "Début heures creuses", hcEnd: "Fin heures creuses", amp: "Courant de charge", volt: "Tension", eff: "Rendement de charge", pHC: "Prix heures creuses", pHP: "Prix heures pleines", soc: "Batterie à l'arrivée" };
  var TIME_RE = /^\d{1,2}:\d{2}$/;
  function okNum(k, v) {
    if (!isFinite(v)) return false;
    if (k === "soc" || k === "target") return v >= 0 && v <= 100;
    if (k === "soh" || k === "eff") return v > 0 && v <= 100;
    return v > 0; // cap, amp, volt, pHC, pHP : vide ou 0 = invalide, jamais traité comme 0
  }

  // Lit les champs. Un champ vide ou hors limites est signalé et n'entre pas dans le plan.
  function read() {
    var p = {}, bad = [];
    ids.forEach(function (k) { p[k] = getVal(k); });
    var sansPrix = []; // prix laissés vides : le plan est calculé, seul le coût est masqué
    NUMS.forEach(function (k) {
      var raw = String($(k).value).trim();
      var v = raw === "" ? NaN : Number(raw);
      p[k] = v;
      if (raw === "" && (k === "pHC" || k === "pHP")) sansPrix.push(k);
      else if (!okNum(k, v)) bad.push(k);
    });
    ["dep", "hcStart", "hcEnd"].forEach(function (k) {
      if (!TIME_RE.test(p[k])) bad.push(k);
    });
    if (p.mode !== "start" && p.mode !== "end") p.mode = "end";
    // Préconditionnement supprimé : la voiture le fait sur sa batterie, la charge finit avec les heures creuses.
    p.pre = 0; p.deduct = false;
    var rawSoc = String($("soc").value).trim();
    p.soc = rawSoc === "" ? NaN : Number(rawSoc);
    if (!okNum("soc", p.soc)) bad.push("soc");
    return { p: p, bad: bad, sansPrix: sansPrix };
  }

  function mark(bad) {
    NUMS.concat(["dep", "hcStart", "hcEnd", "soc"]).forEach(function (k) {
      $(k).setAttribute("aria-invalid", bad.indexOf(k) >= 0 ? "true" : "false");
    });
  }

  // ---------- Affichage ----------
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function num(x) { return String(x).replace(".", ","); }

  // Heure qui change chaque soir : l'allumage en mode « finir à », ou quand la charge
  // doit commencer avant les heures creuses ; sinon l'arrêt.
  function startVaries(p, r) { return p.mode === "end" || r.status === "short"; }

  function setHero(kind, title, parts) {
    var h = $("hero");
    h.className = "card hero" + (kind === "plan" ? "" : " alt " + kind);
    $("heroPlan").hidden = kind !== "plan";
    $("heroAlt").hidden = kind === "plan";
    if (kind !== "plan") $("heroNote").hidden = true;
    $("altTitle").textContent = title || "";
    var body = $("altBody"); body.textContent = "";
    (parts || []).forEach(function (n) { body.appendChild(n); });
  }

  var liveTimer = null;
  function announce(text) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { $("live").textContent = text; }, 700);
  }

  function clearResults() {
    ["fArr", "fDur", "fCost"].forEach(function (i) { $(i).textContent = "–"; });
    ["fArrS", "fKwh", "fCostS"].forEach(function (i) { $(i).textContent = ""; $(i).className = "ts"; });
    $("fCostTile").className = "tile";
    $("timeline").textContent = ""; $("ticks").textContent = "";
    $("timeline").setAttribute("aria-label", "Frise de la nuit : aucun plan calculé");
    $("ampWarn").hidden = true;
  }

  function updateStatic() {
    $("chipText").textContent = fmt(hm(cur.dep)) + " · " + cur.target + " %";
    $("chip").setAttribute("aria-label", "Départ " + fmt(hm(cur.dep)) + ", batterie visée " + cur.target + " %. Modifier dans les paramètres");
    var nomVeh = veh.choix && veh.choix.version ? veh.choix.marque + " " + veh.choix.modele + " · " : "";
    $("carSum").textContent = nomVeh + num(cur.cap) + " kWh · SOH " + num(cur.soh) + " %";
    $("cableSum").textContent = num(cur.amp) + " A · " + num(cur.volt) + " V · rendement " + num(cur.eff) + " %";
    var dep = hm(cur.dep);
    var fills = { dep: fmt(dep), hcStart: fmt(hm(cur.hcStart)), hcEnd: fmt(hm(cur.hcEnd)), hcEndMoins: fmt(hm(cur.hcEnd) - 1) };
    Array.prototype.forEach.call(document.querySelectorAll("[data-fill]"), function (e) { e.textContent = fills[e.getAttribute("data-fill")]; });
    $("lblHc").textContent = fills.hcStart + " – " + fills.hcEnd;
    $("lblDep").textContent = fills.dep;
  }

  // Nuit de changement d'heure (dernier dimanche de mars ou d'octobre) : null ou { sens, decalage, minute }, voir calc.js.
  // L'adresse ?soir=AAAA-MM-JJ simule le soir, seulement sur la machine locale (essais).
  function soirCourant() { return soirSimule(location.search, location.hostname) || soirDe(new Date(), cur.hcStart, cur.hcEnd); }
  function cleSoir() { var d = soirCourant(); return typeof d === "string" ? d : d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  var soirAffiche = null, dernierPlan = null, dernierNuit = null;

  function render() {
    var rd = read(), p = rd.p, bad = rd.bad, sansPrix = rd.sansPrix;
    mark(bad.filter(function (k) { return k !== "soc" || String($("soc").value).trim() !== ""; })); // batterie vide : attendue, pas en erreur
    // Enregistre uniquement les champs valides : les autres gardent leur dernière valeur valide.
    ids.forEach(function (k) { if (bad.indexOf(k) < 0 && sansPrix.indexOf(k) < 0) cur[k] = p[k]; });
    if (bad.indexOf("soc") < 0) { cur.soc = p.soc; socEnregistre = true; }
    save(cur);
    var nuit = nuitChangementHeure(soirCourant());
    soirAffiche = cleSoir(); dernierNuit = nuit; dernierPlan = null;
    $("dstBanner").textContent = texteChangementHeure(nuit);
    $("dstBanner").hidden = !nuit;
    updateStatic();
    syncStepper();

    var pe = $("paramErr");
    pe.hidden = true;

    if (bad.length === 1 && bad[0] === "soc" && String($("soc").value).trim() === "") {
      // Batterie pas encore saisie : on l'attend, ce n'est pas une erreur.
      clearResults();
      setHero("attente", "Heure d'allumage", [el("p", "alt-text", "Elle s'affichera dès que la batterie est saisie.")]);
      announce("Entrez votre batterie");
      drawAide(null, null);
      setDemande(null);
      majProvisoire();
      return;
    }
    if (bad.length) {
      clearResults();
      var pbad = bad.filter(function (k) { return k !== "soc"; });
      var t = el("p", "alt-text", "Aucun plan calculé. À corriger : " + bad.map(function (k) { return LABELS[k]; }).join(", ") + ". ");
      if (pbad.length) {
        var a = el("a", null, "Ouvrir les paramètres"); a.href = "#parametres"; a.setAttribute("data-nav", "parametres");
        t.appendChild(a);
        pe.hidden = false;
        pe.textContent = "Valeur manquante ou impossible : " + pbad.map(function (k) { return LABELS[k]; }).join(", ") + ". Le calcul reste en attente tant qu'elle n'est pas corrigée.";
        if (pbad.some(function (k) { return k !== "target" && k !== "dep"; })) $("avance").open = true;
        if (pbad.some(function (k) { return CAR.indexOf(k) >= 0; })) $("carBox").open = true;
        if (pbad.some(function (k) { return CABLE.indexOf(k) >= 0; })) $("cableBox").open = true;
      }
      setHero("bad", "Saisie à corriger", [t]);
      announce("Saisie à corriger");
      drawAide(null, null);
      setDemande(null);
      return;
    }

    var r = plan(Object.assign({}, p, { nuit: nuit }));
    dernierPlan = r;
    if (r.status === "err") {
      clearResults();
      setHero("bad", "Paramètres incomplets", [el("p", "alt-text", "Vérifiez la capacité, le SOH, le courant, la tension et le rendement : ils doivent être supérieurs à zéro.")]);
      announce("Paramètres incomplets");
      drawAide(null, null);
      setDemande(null);
      return;
    }

    var reached = !(r.status !== "none" && r.arrival < p.target - 0.05);
    var sv = startVaries(p, r);

    if (r.status === "none") {
      setHero("none", "Pas de charge nécessaire", [el("p", "alt-text", "Réglez le début de la plage à une minute avant la fin des heures creuses (" + fmt(hm(cur.hcEnd) - 1) + ") dans Smart Life, ou ne branchez pas la voiture."), el("p", "alt-text", RAPPEL_REPROGRAMMER)]);
      announce("Pas de charge nécessaire");
    } else if (!reached) {
      var t1 = el("p", "alt-text", "Environ " + Math.round(r.arrival) + " % au départ au lieu de " + p.target + " %, même en démarrant au plus tôt.");
      var t2 = el("p", "alt-text");
      t2.append("Plage à régler quand même : allumer à ", el("b", null, fmt(r.start)), ", éteindre à ", el("b", null, fmt(r.end)), r.offMin > 0 ? " (dont " + fdur(r.offMin) + " en heures pleines)." : ".");
      setHero("warn", "Objectif inatteignable", [t1, t2]);
      announce("Objectif inatteignable. Allumer à " + fmt(r.start) + ", éteindre à " + fmt(r.end));
    } else {
      setHero("plan");
      $("kBig").textContent = sv ? "Allumer la prise à" : "Éteindre à";
      $("tBig").textContent = fmt(sv ? r.start : r.end);
      $("kSmall").textContent = sv ? "Éteindre à" : "Allumer à";
      $("tSmall").textContent = fmt(sv ? r.end : r.start);
      // En mode « commencer à », une charge qui doit débuter avant les heures creuses change aussi l'arrêt.
      $("tagSmall").textContent = (p.mode === "start" && sv) ? "à régler aussi" : "déjà réglé";
      var note = $("heroNote");
      if (r.status === "short") {
        note.hidden = false;
        note.textContent = "Démarre avant les heures creuses : " + fdur(r.offMin) + " au tarif plein (environ " + fr(r.offMin / 60 * r.P, 1) + " kWh).";
      } else note.hidden = true;
      announce((sv ? "Allumer la prise à " : "Éteindre à ") + fmt(sv ? r.start : r.end));
    }
    majProvisoire();

    // Tuiles
    $("fArr").textContent = Math.round(r.arrival) + " %";
    var as = $("fArrS");
    if (reached) { as.textContent = "objectif atteint"; as.className = "ts"; }
    else { as.textContent = Math.round(p.target - r.arrival) + " % sous l'objectif"; as.className = "ts miss"; }
    $("fDur").textContent = r.status === "none" ? "0 h 00" : fdur(r.chargeMin);
    $("fKwh").textContent = fr(r.kwh, 1) + " kWh";
    var cs = $("fCostS");
    $("fCostTile").className = sansPrix.length ? "tile off" : "tile";
    if (sansPrix.length) {
      // Jamais « 0 € » quand un prix manque : le coût serait faux.
      $("fCost").textContent = "Prix à renseigner";
      cs.textContent = ""; cs.className = "ts";
    } else {
      $("fCost").textContent = eur(r.cost);
      if (r.kwhHP > 0) { cs.textContent = "dont " + eur(r.kwhHP * p.pHP) + " hors creuses"; cs.className = "ts hp"; }
      else { cs.textContent = r.kwh > 0 ? "100 % creuses" : "aucune charge"; cs.className = "ts"; }
    }

    var aw = $("ampWarn");
    if (p.amp > 16) {
      aw.hidden = false;
      aw.textContent = "Au-delà de 16 A (3,7 kW), ni le câble ni une prise Green'up ne suffisent : il faut une borne de recharge. Le bouton « Programmer la charge » ne règle pas le courant.";
    } else aw.hidden = true;

    drawTimeline(r);
    drawAide(p, r);
    setDemande(choisirDemande(r.status, r.status === "none" ? null : fmt(r.start)));
  }

  // Frise : du début des heures creuses (plus tôt si la charge commence avant)
  // jusqu'à 30 min après le départ, graduée toutes les 2 h.
  function drawTimeline(r) {
    var o = r.chargeMin > 0 && r.startRel < 0 ? Math.floor((r.startRel - 15) / 60) * 60 : 0;
    var endX = Math.max(r.hcLen, r.depRel) + 30;
    var total = endX - o;
    var tl = $("timeline"), tk = $("ticks");
    var pc = function (x) { return ((x - o) / total * 100).toFixed(2) + "%"; };
    var wd = function (x) { return (x / total * 100).toFixed(2) + "%"; };
    tl.textContent = "";
    var seg = function (cls, left, width) { var d = el("div", "seg " + cls); d.style.left = pc(left); d.style.width = wd(width); tl.appendChild(d); return d; };
    seg("hc", 0, r.hcLen);
    var label = "Départ " + fmt(r.dep);
    if (r.chargeMin > 0) {
      seg("charge", r.startRel, r.chargeMin);
      var txt = "Charge " + fmt(r.start) + " → " + fmt(r.end);
      tl.appendChild(el("span", "clabel in", txt));
      label = txt.replace("→", "à") + ". " + label;
    } else label = "Pas de charge. " + label;
    seg("dep", r.depRel, 0);
    tl.setAttribute("aria-label", "Frise de la nuit. Heures creuses " + $("lblHc").textContent + ". " + label);

    tk.textContent = "";
    var step = total > 14 * 60 ? 240 : 120; // nuit très longue (charge bien avant les HC) : toutes les 4 h, sinon illisible
    // Graduations en heures murales (xw, depuis le début des HC) ; la position suit les minutes réelles (x). Nuit ordinaire : xw = x.
    var first = Math.ceil((r.hcS + o) / step) * step - r.hcS;
    for (var xw = first; r.vraie(xw) <= endX; xw += step) {
      var x = r.vraie(xw);
      var s = el("span", null, fmt(r.hcS + xw).slice(0, 2) + " h");
      s.style.left = pc(x);
      if (x - o < 20) s.className = "first";
      else if (endX - x < 20) s.className = "last";
      else if (x - o < 50 || endX - x < 50) continue; // trop près d'un bord : chevauchement
      tk.appendChild(s);
    }
    fitChargeLabel();
  }

  // Le texte de charge s'écrit dans le bloc bleu ; s'il n'y tient pas, à côté, du côté le plus libre.
  function fitChargeLabel() {
    var tl = $("timeline"), blk = tl.querySelector(".seg.charge"), lbl = tl.querySelector(".clabel");
    if (!blk || !lbl) return;
    var W = tl.clientWidth; if (!W) return; // vue masquée : refait à l'affichage
    var bl = blk.offsetLeft, bw = blk.offsetWidth, lw = lbl.offsetWidth;
    lbl.hidden = false;
    if (lw + 12 <= bw) { lbl.className = "clabel in"; lbl.style.left = Math.round(bl + (bw - lw) / 2) + "px"; return; }
    lbl.className = "clabel out";
    var leftSpace = bl, rightSpace = W - bl - bw;
    if (Math.max(leftSpace, rightSpace) < lw + 10) { lbl.hidden = true; return; }
    lbl.style.left = (leftSpace >= rightSpace ? Math.round(bl - lw - 6) : Math.round(bl + bw + 6)) + "px";
  }
  window.addEventListener("resize", fitChargeLabel);

  // Aide : plage du soir (heure qui change en bleu, l'autre fixe).
  function drawAide(p, r) {
    var mode = p ? p.mode : cur.mode;
    var charging = r && r.status !== "none" && r.chargeMin > 0;
    var sv = charging ? startVaries(p, r) : mode === "end";
    var deb = charging ? fmt(r.start) : (sv ? "—" : fmt(hm(cur.hcStart)));
    var fin = charging ? fmt(r.end) : (sv ? fmt(hm(cur.hcEnd)) : "—");
    var varSub = charging ? "change chaque soir" : (r && r.status === "none" ? "pas de charge ce soir" : "voir Ce soir");
    $("aDeb").textContent = deb; $("aFin").textContent = fin;
    $("aDeb").className = "pv" + (sv ? " var" : "");
    $("aFin").className = "pv" + (sv ? "" : " var");
    $("aDebS").textContent = sv ? varSub : "fixe";
    $("aFinS").textContent = sv ? "fixe" : varSub;
    if (charging && sv && p.mode === "start") $("aFinS").textContent = "à régler aussi";
  }

  // ---------- Saisie de la batterie ----------
  // La valeur affichée au départ est celle d'hier : tant qu'aucun geste ne l'a confirmée (saisie, − / +, curseur,
  // « Garder »), le bouton « Programmer » reste inactif. Impossible de programmer sur le % d'hier sans s'en rendre compte.
  // (Les propositions des dernières valeurs ont été retirées le 2026-11-21, à la demande de Mathieu : inutiles.)
  var confirme = false, confirmeLe = null;
  try { localStorage.removeItem("recharge-ds3-soc-recents"); } catch (e) {} // ancienne liste, plus utilisée
  function setConfirme(oui) {
    confirme = oui;
    confirmeLe = oui ? Date.now() : null;
    $("socCard").className = "card soc-card" + (oui ? "" : " unconfirmed");
    $("socHint").hidden = oui;
    majProvisoire();
    updateSend();
  }
  // Tant que la batterie n'est pas confirmée, l'heure vient de la dernière valeur : bloc atténué, « d'après 38 % ».
  function majProvisoire() {
    var on = !confirme && !$("heroPlan").hidden;
    $("hero").classList.toggle("provisoire", on);
    var f = $("heroFrom");
    f.hidden = !on;
    f.textContent = on ? mentionProvisoire(socValide($("soc").value)) : "";
  }
  function syncStepper() {
    var v = Number($("soc").value), empty = String($("soc").value).trim() === "";
    $("socMinus").disabled = !empty && v <= 0;
    $("socPlus").disabled = !empty && v >= 100;
    var n = socValide($("soc").value);
    $("socRange").value = $("soc").value.trim() === "" || !isFinite(v) ? cur.soc : Math.min(100, Math.max(0, v));
    $("keepBtn").textContent = "Garder " + (n === null ? cur.soc : n) + " %";
    // Aucune dernière valeur (premier lancement, champ vide) : rien à garder, on invite à saisir.
    $("socHintText").textContent = empty ? LIBELLES_SOC.aucune : LIBELLES_SOC.derniere;
    $("keepBtn").hidden = empty;
  }
  function bump(d) {
    var raw = String($("soc").value).trim(), v = Number(raw);
    if (raw === "" || !isFinite(v)) v = cur.soc;
    v = Math.min(100, Math.max(0, Math.round(v) + d));
    $("soc").value = v;
    setConfirme(true); render();
  }
  $("socMinus").addEventListener("click", function () { bump(-1); });
  $("socPlus").addEventListener("click", function () { bump(1); });
  $("socRange").addEventListener("input", function () {
    $("soc").value = this.value;
    setConfirme(true); render();
  });
  $("soc").addEventListener("input", function () { setConfirme(String($("soc").value).trim() !== ""); render(); });
  $("soc").addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });
  $("soc").addEventListener("focus", function () { if (!confirme) this.select(); }); // une frappe remplace la valeur d'hier
  $("keepBtn").addEventListener("click", function () { setConfirme(true); });

  // Changer le courant ou la tension recalcule le rendement ; une saisie manuelle reste jusqu'au prochain changement.
  ["amp", "volt"].forEach(function (k) {
    $(k).addEventListener("input", function () {
      var e = effAuto(Number($("amp").value), Number($("volt").value));
      if (isFinite(e)) $("eff").value = e;
    });
  });
  ids.filter(function (k) { return k !== "mode"; }).forEach(function (k) { $(k).addEventListener("input", render); $(k).addEventListener("change", render); });
  Array.prototype.forEach.call(radios(), function (r) { r.addEventListener("change", render); });
  $("resetBtn").addEventListener("click", function () {
    if (!window.confirm("Revenir aux valeurs de départ ? Tous vos réglages seront remplacés.")) return;
    try { localStorage.removeItem(KEY); localStorage.removeItem(KEY_VEH); } catch (e) {}
    cur = Object.assign({}, DEFAULTS);
    veh.choix = null; remplirVehicules();
    load(); render();
  });

  // ---------- Véhicule : marque → modèle → version remplit la capacité utile ----------
  var KEY_VEH = "recharge-ds3-vehicule";
  var veh = { lignes: [], choix: null };
  function options(sel, liste, vide, choisi) {
    sel.textContent = "";
    sel.appendChild(new Option(vide, ""));
    liste.forEach(function (x) { sel.appendChild(new Option(x, x, false, x === choisi)); });
    sel.disabled = liste.length === 0;
  }
  function enregistrerVehicule() { try { localStorage.setItem(KEY_VEH, JSON.stringify(veh.choix)); } catch (e) {} }
  function remplirVehicules() {
    var c = veh.choix || {}, L = veh.lignes;
    options($("vMarque"), marques(L), "Choisir la marque", c.marque);
    options($("vModele"), c.marque ? modeles(L, c.marque) : [], c.marque ? "Choisir le modèle" : "Choisir d'abord la marque", c.modele);
    options($("vVersion"), c.modele ? versions(L, c.marque, c.modele).map(function (v) { return v.libelle; }) : [], c.modele ? "Choisir la version" : "Choisir d'abord le modèle", c.version);
    setMsg("vMsg", "", false);
  }
  function chargerVehicules() {
    try { veh.choix = JSON.parse(localStorage.getItem(KEY_VEH) || "null"); } catch (e) { veh.choix = null; }
    if (!veh.choix || typeof veh.choix !== "object") veh.choix = null;
    fetch("vehicules.json").then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (doc) {
        veh.lignes = lignesValides(doc);
        if (!veh.lignes.length) throw new Error("liste vide");
        // Choix enregistré absent de la nouvelle liste : on garde la capacité, on oublie la version.
        if (veh.choix && veh.choix.version && !trouver(veh.lignes, veh.choix)) veh.choix.version = null;
        remplirVehicules(); updateStatic();
      })
      .catch(function () {
        options($("vMarque"), [], "Liste indisponible", null);
        setMsg("vMsg", "Liste des véhicules indisponible : saisissez la capacité utile à la main.", true);
      });
  }
  $("vMarque").addEventListener("change", function () {
    veh.choix = this.value ? { marque: this.value } : null;
    enregistrerVehicule(); remplirVehicules(); updateStatic();
  });
  $("vModele").addEventListener("change", function () {
    veh.choix = { marque: veh.choix.marque, modele: this.value || null };
    enregistrerVehicule(); remplirVehicules(); updateStatic();
  });
  $("vVersion").addEventListener("change", function () {
    veh.choix.version = this.value || null;
    var t = trouver(veh.lignes, veh.choix);
    enregistrerVehicule();
    if (t) { $("cap").value = t.cap; setMsg("vMsg", "Capacité utile remplie : " + num(t.cap) + " kWh.", false); render(); }
    else updateStatic();
  });
  // Capacité changée à la main : la version choisie ne correspond plus.
  $("cap").addEventListener("input", function () {
    var t = trouver(veh.lignes, veh.choix);
    if (t && Number(this.value) !== t.cap) {
      veh.choix.version = null; enregistrerVehicule();
      $("vVersion").value = "";
      setMsg("vMsg", "Capacité modifiée à la main : version désélectionnée.", false);
      updateStatic();
    }
  });

  // Navigation : trois vues, ancres #accueil (ou aucune), #parametres, #aide.
  var VIEWS = ["calcul", "parametres", "aide"];
  var HEADINGS = { calcul: "t-soir", parametres: "t-param", aide: "t-aide" };
  function viewFromHash() {
    var h = location.hash;
    return h === "#parametres" ? "parametres" : h === "#aide" ? "aide" : "calcul";
  }
  var shown = null;
  function route(focus) {
    var v = viewFromHash();
    if (v === shown) return;
    shown = v;
    VIEWS.forEach(function (n) { $("v-" + n).hidden = n !== v; });
    document.body.setAttribute("data-vue", v);
    window.scrollTo(0, 0);
    if (v === "calcul") fitChargeLabel();
    if (focus) $(HEADINGS[v]).focus({ preventScroll: true });
  }
  var goingBack = false; // évite un second history.back() avant le popstate (double appui)
  function go(target) {
    if (goingBack) return;
    var here = viewFromHash();
    if (target === here) return;
    var hash = target === "calcul" ? "#accueil" : "#" + target;
    if (here === "calcul") {
      // Depuis l'accueil : nouvelle entrée d'historique, le retour d'Android revient ici.
      history.pushState({ pushed: true }, "", hash);
    } else if (target === "calcul" && history.state && history.state.pushed) {
      goingBack = true;
      history.back(); // popstate / hashchange affichent l'accueil
      return;
    } else {
      // Entre deux vues secondaires : on remplace en gardant l'état existant. Seul un
      // pushState fait depuis l'accueil pose « pushed » (ouverture directe sur #aide :
      // aucune entrée accueil derrière, donc pas de history.back()).
      history.replaceState(history.state, "", hash);
    }
    route(true);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[data-nav]") : null;
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(a.getAttribute("data-nav"));
  });
  window.addEventListener("hashchange", function () { goingBack = false; route(true); });
  window.addEventListener("popstate", function () { goingBack = false; route(true); });


  // ---------- Service de programmation (phase 2c) ----------
  // Clés nouvelles ; la clé des paramètres de calcul (KEY) n'est pas touchée.
  var KEY_URL = "recharge-ds3-service-url";
  var KEY_TOK = "recharge-ds3-service-jeton";
  var svc = { adresse: null, jeton: null };
  // Une seule opération sur le câble à la fois (lecture, recherche, envoi), au niveau du module : le drapeau n'est
  // relâché qu'à la fin réelle de la promesse, jamais par une sortie d'attente ni un plafond de temps.
  var opCable = false, opFin = Promise.resolve(), clicEnAttente = false;
  function opCableLancer(fn) {
    opCable = true;
    var reel = Promise.resolve().then(fn);
    var rel = function () { opCable = false; };
    opFin = reel.then(rel, rel);
    return reel;
  }
  // Borne d'attente pour l'appelant seulement : l'opération réelle continue, et garde son drapeau.
  function borne(p, ms, repli) {
    var t = null;
    return Promise.race([p, new Promise(function (ok) { t = setTimeout(function () { ok(repli); }, ms); })]).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  var att = null, controle = false; // att : attente du Wi-Fi en cours ; controle : contrôle du réseau au toucher
  var demande = null, busy = false, alertKey = null, moyen = null, reussi = null, etatCable = null, debugPont = false;
  var plageCable = null; // plage lue sur le câble { debut, fin, active } ; null = inconnue (la ligne « Câble réglé » est alors masquée)
  var pontOk = !!(globalThis.PontLocal && typeof globalThis.PontLocal.postMessage === "function");

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function loadService() {
    var u = validerAdresse(lsGet(KEY_URL)), t = validerJeton(lsGet(KEY_TOK));
    svc.adresse = u.ok ? u.adresse : null;
    svc.jeton = t.ok ? t.jeton : null;
    $("svcUrl").value = svc.adresse || "";
    $("svcTok").value = ""; // le jeton n'est jamais réaffiché
    tokenMsg();
    $("svcBox").open = !(svc.adresse && svc.jeton); // replié une fois configuré
    svcSummary();
  }
  // Résumé du bloc replié. Ne le referme jamais pendant une saisie ; le rouvre s'il n'est plus configuré.
  function svcSummary() {
    var ok = !!(svc.adresse && svc.jeton);
    $("svcSum").textContent = ok ? "Configuré · " + new URL(svc.adresse).hostname : (svc.adresse ? "Jeton manquant : bouton inactif" : "Non configuré : bouton inactif");
    if (!ok) $("svcBox").open = true;
  }
  function setMsg(id, text, bad) { var m = $(id); m.textContent = text; m.className = "fmsg" + (bad ? " bad" : ""); }
  function tokenMsg() { setMsg("svcTokMsg", svc.jeton ? "Un jeton est enregistré (non affiché)." : "Aucun jeton enregistré.", false); }

  $("svcUrl").addEventListener("input", function () {
    var raw = this.value, v = validerAdresse(raw);
    if (raw.trim() === "") {
      svc.adresse = null; lsDel(KEY_URL); this.setAttribute("aria-invalid", "false"); setMsg("svcUrlMsg", "", false);
    } else if (v.ok) {
      svc.adresse = v.adresse; this.setAttribute("aria-invalid", "false");
      setMsg("svcUrlMsg", lsSet(KEY_URL, v.adresse) ? "Adresse enregistrée." : "Enregistrement impossible dans ce navigateur : l'adresse sera perdue à la fermeture.", false);
    } else {
      svc.adresse = null; lsDel(KEY_URL); this.setAttribute("aria-invalid", "true");
      setMsg("svcUrlMsg", "Adresse refusée : il faut l'adresse exacte du Worker, https://<nom>.<sous-domaine>.workers.dev, sans chemin ni port.", true);
    }
    updateSend();
  });
  // Le jeton n'est enregistré qu'à la fin de la saisie (événement change), jamais à chaque frappe,
  // et seulement s'il est valide en entier. Le message dit toujours ce qui est réellement stocké.
  $("svcTok").addEventListener("input", function () {
    this.setAttribute("aria-invalid", "false");
    if (this.value.trim() === "") { tokenMsg(); return; }
    setMsg("svcTokMsg", (svc.jeton ? "Un ancien jeton reste enregistré. " : "") + "Saisie en cours : le nouveau jeton n'est pas encore enregistré (il le sera en quittant le champ).", false);
  });
  $("svcTok").addEventListener("change", function () {
    var raw = this.value;
    if (raw.trim() === "") { this.setAttribute("aria-invalid", "false"); tokenMsg(); return; }
    var v = validerJeton(raw);
    if (v.ok) {
      svc.jeton = v.jeton; this.setAttribute("aria-invalid", "false");
      setMsg("svcTokMsg", lsSet(KEY_TOK, v.jeton) ? "Jeton enregistré (non affiché)." : "Enregistrement impossible dans ce navigateur : le jeton sera perdu à la fermeture.", false);
      this.value = "";
    } else {
      this.setAttribute("aria-invalid", "true");
      setMsg("svcTokMsg", "Jeton non enregistré : caractères non autorisés (ni espace ni accent)." + (svc.jeton ? " L'ancien jeton reste enregistré." : ""), true);
    }
    updateSend();
  });
  $("svcTokClear").addEventListener("click", function () {
    svc.jeton = null; lsDel(KEY_TOK);
    $("svcTok").value = ""; $("svcTok").setAttribute("aria-invalid", "false");
    setMsg("svcTokMsg", "Jeton effacé.", false);
    updateSend();
  });

  $("svcForm").addEventListener("submit", function (e) { e.preventDefault(); }); // Entrée ne recharge pas la page

  function navLink(text, hash, nav) { var a = el("a", null, text); a.href = hash; a.setAttribute("data-nav", nav); return a; }

  function setDemande(d) {
    demande = d;
    // Attente du Wi-Fi : la demande est figée au toucher ; si elle change (% ou réglages), l'attente est annulée.
    // On le dit, avec l'heure de l'ancienne demande : rien ne doit laisser croire qu'un envoi est encore en cours.
    if (att && JSON.stringify(d) !== att.cle) {
      var ancienne = sortirAttente();
      journal({ action: "page-attente-wifi", etat: "annulee" });
      koAttente(ancienne, "local_attente_modifiee", "Attente annulée");
    }
    // Une alerte qui concerne une autre demande que l'actuelle est périmée.
    if (!busy && alertKey !== null && alertKey !== JSON.stringify(d)) hideAlert();
    updateSend();
  }

  function updateSend() {
    svcSummary();
    var b = $("sendBtn"), help = $("sendHelp");
    var occ = busy || !!localEnVol || !!att; // un envoi local dont le plafond est tombé tourne encore : pas de second envoi
    var ctx = demande && dernierPlan ? contexteHoraire({ maintenant: new Date(), hcStart: cur.hcStart, hcEnd: cur.hcEnd, startRel: dernierPlan.startRel, nuitChangement: !!dernierNuit }) : null;
    var lab = libelleBouton(demande, ctx);
    moyen = moyenEnvoi({ pont: pontOk, adresse: svc.adresse, jeton: svc.jeton });
    // Le câble a déjà la plage demandée : rien à envoyer (seulement quand la batterie est confirmée).
    var deja = confirme && dejaProgramme(plageCable, demande);
    $("sendMain").textContent = att ? LIBELLES_ATTENTE.principal : occ ? "Envoi en cours…" : deja ? libelleDejaProgramme(demande) : (lab ? lab.principal : "Programmer la charge");
    var cle = demande ? JSON.stringify(demande) : null;
    $("sendSub").textContent = sousLigneBouton({
      attente: att ? att.etape : null, occupe: occ, delaiS: moyen === "local" ? 30 : 25, demande: demande, confirme: confirme,
      reussi: reussi && reussi.cle === cle ? "programmé à " + reussi.heure + " · relu sur le câble" : null, deja: deja,
      blocage: moyen === "local" ? blocageCable(etatCable) : null,
      secondaire: lab ? lab.secondaire : "",
    });
    b.disabled = !boutonActif({ moyen: moyen, demande: demande, confirme: confirme, occupe: occ, dejaProgramme: deja });
    b.classList.toggle("attente", !b.disabled && moyen === "local" && !!blocageCable(etatCable));
    // Sans moyen d'envoi, la barre est masquée : réglage manuel avec l'heure affichée (voir Aide).
    $("sendBar").hidden = !moyen;
    document.body.classList.toggle("has-sendbar", !!moyen);
    $("attenteBox").hidden = !att;
    $("attenteInfo").textContent = att && att.info ? att.info : "";
    $("attenteInfo").hidden = !(att && att.info);
    document.body.classList.toggle("en-attente", !!att);
    help.hidden = !(moyen && !demande && !occ);
    if (!help.hidden) help.textContent = "Corrigez la saisie pour pouvoir programmer la charge.";
    b.setAttribute("aria-busy", occ ? "true" : "false");
  }

  // Deux conteneurs permanents (présents dès le chargement, annoncés par les lecteurs d'écran) :
  // on ne fait que les remplir ou les vider.
  function hideAlert() { $("sendOk").textContent = ""; $("sendKo").textContent = ""; alertKey = null; reussi = null; $("sendResult").className = "card send vide"; }
  function showAlert(res, d) {
    hideAlert();
    var a = res.etat === "ok" ? $("sendOk") : $("sendKo");
    if (res.etat === "ok") {
      a.appendChild(el("p", "alert-title", res.message));
      if (res.detail) a.appendChild(el("p", null, res.detail));
      if (res.rappel) a.appendChild(el("p", null, res.rappel));
      if (res.avertissement) a.appendChild(el("p", "manual", res.avertissement));
    } else {
      a.appendChild(el("p", "alert-title", res.titre || "Programmation non confirmée"));
      a.appendChild(el("p", null, res.message));
      a.appendChild(el("p", "manual", res.manuel));
      if (res.verifier) a.appendChild(el("p", null, res.verifier));
      var l = el("p", null); l.appendChild(navLink("Voir l'aide au réglage manuel", "#aide", "aide"));
      a.appendChild(l);
    }
    alertKey = JSON.stringify(d);
    if (res.etat === "ok") { var h = plageRelue(res).debut; reussi = h ? { cle: alertKey, heure: h } : null; }
    $("sendResult").className = "card send";
    try { if (a.scrollIntoView) a.scrollIntoView({ block: "nearest" }); } catch (e) { /* défilement facultatif */ }
  }

  var DELAI_LOCAL_MAX_MS = ENVOI_PLAFOND_MS, envoiPlafond = null;
  // Appelée à la reprise de la page et toutes les 5 s : si le plafond de l'envoi est dépassé sans que son minuteur ait sonné
  // (minuteurs gelés pendant une fenêtre système), l'échec est affiché maintenant, avec l'heure manuelle.
  function verifierPlafondEnvoi() {
    var p = envoiPlafond;
    if (p && busy && plafondDepasse(p.debut, Date.now(), DELAI_LOCAL_MAX_MS)) { envoiPlafond = null; p.declencher(); }
  }
  var localEnVol = null; // envoi local réel en cours (il peut survivre au plafond de 30 s)
  $("sendBtn").addEventListener("click", function () {
    if (busy || localEnVol || controle || att || !demande || !confirme || !moyen) return;
    // Lecture ou recherche en vol : le toucher attend sa fin (jamais deux opérations en même temps), puis on décide.
    if (opCable && moyen === "local") {
      if (!clicEnAttente) { clicEnAttente = true; opFin.then(function () { clicEnAttente = false; $("sendBtn").click(); }); }
      return;
    }
    // Page restée affichée d'un soir à l'autre sans changer de visibilité : la confirmation est revérifiée au clic.
    if (!confirmationValable(confirmeLe, Date.now())) { verifierConfirmation(); return; }
    if (moyen !== "local") { lancerEnvoi(); return; }
    if (decisionEnvoi({ etat: etatCable, surReseau: "inconnu" }) === "panneau") { ouvrirPanneau(true); return; } // câble pas prêt à recevoir : on l'explique, rien n'est envoyé
    // Appli : le téléphone est-il déjà sur le Wi-Fi de la maison ? Sinon, attente (jamais d'échec immédiat pour cette seule raison).
    controle = true;
    reseauMaison().then(function (sr) {
      controle = false;
      if (busy || localEnVol || att || !demande || !confirme) return; // l'état a changé pendant le contrôle (une seule lecture, quasi instantanée)
      // Page passée en arrière-plan pendant ce contrôle : rien ne part, ni attente ni envoi (règle 1) ; on le dit (règle 2).
      if (document.hidden) { koAttente({ d: demande, finHC: fmt(hm(cur.hcEnd)) }, "local_attente_quittee", "Programmation non envoyée"); return; }
      if (decisionEnvoi({ etat: etatCable, surReseau: sr }) === "attendre") demarrerAttente(sr); else lancerEnvoi();
    });
  });

  // Dépendances du mode Local, avec la configuration du câble lue au toucher quand l'attente en garde une.
  function depsAvec(l, conf) { return conf ? Object.assign({}, l.deps, { confCable: conf }) : l.deps; }
  function reseauMaison(conf) {
    return localPret().then(function (l) { return l.surLeReseauDeLaMaison(depsAvec(l, conf)); }).catch(function () { return "inconnu"; });
  }
  // Appel au pont natif (attente en arrière-plan) ; ne rejette jamais.
  function appelPont(op, params, delaiMs) {
    return localPret().then(function (l) { return l.client.appeler(op, params || {}, delaiMs); }).catch(function () { return { ok: false }; });
  }
  // Notification de fin (mode arrière-plan) : une seule fois par attente.
  function notifierFin(a, resultat, incertain, heure) {
    if (!a || a.finNotifiee) return;
    a.finNotifiee = true;
    var p = { resultat: resultat };
    if (heure) p.heure = heure;
    if (incertain) p.incertain = true;
    appelPont("attenteFin", p);
  }
  function sortirAttente() {
    var a = att;
    if (!a) return null;
    clearInterval(a.timer); att = null;
    a.conf = null; // la configuration du câble ne survit jamais à l'attente
    $("attenteLive").textContent = "";
    updateSend();
    return a;
  }
  // Fin d'attente sans envoi : carte KO avec l'heure à régler à la main (règle 2).
  function koAttente(a, code, titre) {
    var r = resultatKo(a.d, code, a.finHC);
    r.titre = titre;
    try { showAlert(r, a.d); } catch (e) { /* l'état du bouton est déjà rendu */ }
    if (a.arriere) notifierFin(a, resultatNotification({ code: code }), false, heureNotification({ demande: a.d, finHC: a.finHC }));
  }
  function demarrerAttente(sr) {
    var d = demande, now = Date.now(), surReseau = sr === "oui";
    att = { d: d, cle: JSON.stringify(d), debut: now, finHC: fmt(hm(cur.hcEnd)), verif: true, timer: null,
      etape: surReseau ? "cable" : "wifi", cableDepuis: surReseau ? now : null, derniere: null, rechercheFaite: false,
      prepa: true, arriere: false, conf: null, confLuLe: null, info: "", etatEnCours: false, finNotifiee: false };
    var a = att;
    hideAlert();
    a.timer = setInterval(tickAttente, ATTENTE_SONDE_MS);
    $("attenteLive").textContent = LIBELLES_ATTENTE.annonce;
    journal({ action: "page-attente-wifi", etat: "debut" });
    if (surReseau) journal({ action: "page-attente-wifi", etat: "cable" });
    updateSend();
    // Préparation : tant qu'elle dure (a.prepa), aucun tick ne lit le câble ni n'envoie (a.verif les retient). Elle finit
    // une seule fois : résultat du pont, ou abandon à 125 s (demande de notifications sans réponse = refus).
    a.prepaTimer = setTimeout(function () { terminerPrepa(a, null); }, PREPARATION_MAX_MS);
    preparerArrierePlan(a).then(function (r) { terminerPrepa(a, r); });
  }
  function terminerPrepa(a, r) {
    if (a.prepaFinie) {
      // Réponse arrivée après l'abandon : un service de premier plan démarré trop tard est arrêté.
      if (r && !a.arriere) notifierFin(a, "annulee", false, heureNotification({ demande: a.d, finHC: a.finHC }));
      return;
    }
    a.prepaFinie = true; clearTimeout(a.prepaTimer);
    if (att !== a) { if (r) notifierFin(a, "annulee", false, heureNotification({ demande: a.d, finHC: a.finHC })); return; } // annulée pendant la préparation : le service démarré est arrêté
    a.prepa = false; a.verif = false;
    if (r) { a.arriere = true; a.conf = r.conf; a.confLuLe = r.luLe; a.info = ""; journal({ action: "page-attente-wifi", etat: "arriere-plan" }); }
    else if (!a.info) a.info = LIBELLES_ATTENTE.sansNotifications;
    journal({ action: "page-attente-wifi", etat: "preparation-finie", arriere: !!r });
    updateSend();
    tickAttente(); // Wi-Fi et câble déjà prêts : l'envoi part maintenant
  }
  // Mode arrière-plan : notifications autorisées (demandées une fois), configuration du câble lue ici (illisible écran
  // verrouillé) et gardée en mémoire le temps de l'attente seulement, service de premier plan démarré.
  // -> { conf, luLe } ou null (mode « appli ouverte », avec sa ligne d'explication si les notifications sont refusées).
  function preparerArrierePlan(a) {
    var c = null;
    return localPret().then(function (l) {
      c = l;
      return l.client.appeler("notifications");
    }).then(function (n) {
      if (n && n.ok && n.autorise) return true;
      a.info = LIBELLES_ATTENTE.autoriser; if (att === a) updateSend();
      return c.client.appeler("demanderNotifications", {}, 120000).then(function (r) { return !!(r && r.ok && r.autorise); });
    }).then(function (autorise) {
      if (!autorise) { a.info = LIBELLES_ATTENTE.sansNotifications; return null; }
      if (a.prepaFinie) return null; // abandon entre-temps : on ne démarre pas de service
      a.info = "";
      return c.lireConfigurationCable(c.client).then(function (conf) {
        if (!conf || conf.erreur) { c.client.oublierMemoire(); return null; } // rien ne doit rester gardé côté natif
        var h = heureNotification({ demande: a.d, finHC: a.finHC });
        return c.client.appeler("attenteDebut", h ? { heure: h } : {}).then(function (r) {
          if (r && r.ok) return { conf: conf, luLe: Date.now() };
          c.client.oublierMemoire(); // service non démarré : le natif n'a plus à garder la configuration
          return null;
        });
      });
    }).catch(function () { if (c) c.client.oublierMemoire(); return null; });
  }
  function quitterAttente() {
    var a = sortirAttente();
    if (!a) return;
    journal({ action: "page-attente-wifi", etat: "quittee" });
    koAttente(a, "local_attente_quittee", "Programmation non envoyée");
  }
  // Envoi après attente : la confirmation du % est revérifiée à cet instant (6 h, même jour).
  function envoiApresAttente(a) {
    if (a.prepa) return; // jamais d'envoi avant la fin de la préparation
    var opts = { conf: a.conf, confLuLe: a.confLuLe, arriere: a.arriere, a: a };
    sortirAttente();
    // Échéance revérifiée juste avant l'envoi : une lecture ou une recherche tardive ne déclenche rien.
    if (attenteExpiree(a.debut, Date.now())) {
      journal({ action: "page-attente-wifi", etat: "expiree" });
      koAttente(a, codeEcheance(a.cableDepuis), "Programmation non envoyée");
      return;
    }
    journal({ action: "page-attente-wifi", etat: "envoi" });
    if (!confirme || !confirmationValable(confirmeLe, Date.now())) {
      hideAlert(); setConfirme(false);
      koAttente(a, "local_attente_confirmation", "Programmation non envoyée");
      return;
    }
    lancerEnvoi(opts);
  }
  function changerEtape(a, etape) {
    if (a.etape === etape) return;
    a.etape = etape;
    if (etape === "cable") journal({ action: "page-attente-wifi", etat: "cable" });
    updateSend();
  }
  // Une seule opération à la fois (a.verif) : contrôle du Wi-Fi, lecture du câble ou recherche.
  function tickAttente() {
    var a = att;
    if (!a) return;
    // Mode arrière-plan : l'annulation touchée dans la notification est relue à chaque tick (indépendamment des lectures du câble).
    if (a.arriere && !a.etatEnCours) {
      a.etatEnCours = true;
      appelPont("attenteEtat").then(function (r) {
        a.etatEnCours = false;
        if (att !== a || !r || !r.ok || !r.annulee) return;
        sortirAttente(); journal({ action: "page-attente-wifi", etat: "annulee" });
        koAttente(a, "local_attente_annulee", "Programmation annulée");
      });
    }
    // Préparation trop longue (minuteurs gelés pendant une fenêtre système) : abandon, mode appli ouverte.
    if (a.prepa && Date.now() - a.debut >= PREPARATION_MAX_MS) terminerPrepa(a, null);
    if (a.verif || a.prepa) return; // jamais de lecture ni d'envoi pendant la préparation
    if (quitterSiCache({ cache: document.hidden, arriere: a.arriere, prepa: a.prepa })) { quitterAttente(); return; } // l'événement de visibilité a pu manquer
    if (attenteExpiree(a.debut, Date.now())) {
      sortirAttente(); journal({ action: "page-attente-wifi", etat: "expiree" });
      koAttente(a, codeEcheance(a.cableDepuis), "Programmation non envoyée");
      return;
    }
    if (opCable) return; // une opération sur le câble est encore en vol : on attend sa fin
    a.verif = true;
    borne(reseauMaison(a.conf), 10000, "inconnu").then(function (sr) {
      if (att !== a) return null;
      var now = Date.now();
      if (sr !== "oui") { a.cableDepuis = null; a.verif = false; changerEtape(a, "wifi"); return null; }
      if (!Number.isFinite(a.cableDepuis)) a.cableDepuis = now;
      var etape = etapeAttente({ surReseau: sr, cableDepuis: a.cableDepuis, maintenant: now, rechercheFaite: a.rechercheFaite });
      changerEtape(a, etape);
      if (etape === "recherche") return chercherPendantAttente(a);
      if (!lectureDue(a.derniere, now)) { a.verif = false; return null; }
      return lireCablePendantAttente(a);
    }).catch(function () { if (att === a) a.verif = false; });
  }
  function lireCablePendantAttente(a) {
    var reel = opCableLancer(function () { return localPret().then(function (l) { return l.etatCable(depsAvec(l, a.conf)); }); });
    // Si la lecture dépasse 10 s, l'attente reprend la main ; la réponse tardive est quand même traitée.
    borne(reel.then(function () {}, function () {}), 10000).then(function () { if (att === a) { a.verif = false; if (!Number.isFinite(a.derniere)) a.derniere = Date.now(); } });
    return reel.then(function (r) {
      if (att !== a) return;
      a.derniere = Date.now(); a.verif = false;
      var suite = suiteLecture(r && r.etat);
      journal({ action: "page-attente-wifi", etat: "lecture", cable: r && r.etat });
      if (suite === "envoyer") { pastilleMontre("pret"); envoiApresAttente(a); }
      else if (suite === "relier") finirParCle(a, r.etat);
    }, function () { if (att === a) { a.derniere = Date.now(); a.verif = false; } });
  }
  function chercherPendantAttente(a) {
    a.rechercheFaite = true;
    journal({ action: "page-attente-wifi", etat: "recherche" });
    cherche = true;
    var reel = opCableLancer(function () { return localPret().then(function (l) { return l.chercherCable(depsAvec(l, a.conf)); }); });
    var fini = function () { cherche = false; };
    reel.then(fini, fini);
    borne(reel.then(function () {}, function () {}), 45000).then(function () { if (att === a) { a.verif = false; a.derniere = null; changerEtape(a, "cable"); } });
    return reel.then(function (r) {
      if (att !== a) return;
      a.derniere = null; a.verif = false;
      if (r && r.ok) { pastilleMontre("pret"); envoiApresAttente(a); }
      else if (r && r.etat === "a_relier") finirParCle(a, "a_relier");
      else changerEtape(a, "cable"); // on continue de lire l'adresse (peut-être nouvelle) jusqu'à l'échéance
    }, function () { if (att === a) { a.derniere = null; a.verif = false; changerEtape(a, "cable"); } });
  }
  // Clé refusée ou câble non relié pendant l'attente : fin d'attente, carte KO et panneau du câble ouvert.
  function finirParCle(a, etat) {
    sortirAttente(); journal({ action: "page-attente-wifi", etat: "cle" });
    pastilleMontre(etat);
    koAttente(a, "local_attente_cle", "Programmation non envoyée");
    ouvrirPanneau(true);
  }
  $("attenteAnnuler").addEventListener("click", function () {
    var a = sortirAttente();
    if (!a) return;
    journal({ action: "page-attente-wifi", etat: "annulee" });
    koAttente(a, "local_attente_annulee", "Programmation annulée");
  });

  // opts (après une attente en arrière-plan) : { conf, confLuLe, arriere, a } ; la configuration du câble n'est utilisée que
  // moins de 15 min après sa lecture et n'est plus référencée après l'envoi.
  function lancerEnvoi(opts) {
    var d = demande, m = moyen, finHC = fmt(hm(cur.hcEnd));
    var conf = opts && opts.conf && confValable(opts.confLuLe, Date.now()) ? opts.conf : null;
    if (opts) opts.conf = null;
    busy = true;
    try { hideAlert(); updateSend(); } catch (e) { /* l'envoi et son alerte restent garantis ci-dessous */ }
    var envoi = {
      service: function () { return envoyer(svc.adresse, svc.jeton, d, { finHC: finHC }); },
      local: function () {
        // Aucun repli vers le service : si le mode Local échoue, l'échec est affiché avec l'heure à régler à la main.
        // Plafond de 30 s : l'échec est affiché, mais le bouton reste occupé jusqu'à la fin réelle de l'envoi.
        var minuteur = null;
        var reel = opCableLancer(function () { return localPret().then(function (l) { return l.programmerLocal(d, depsAvec(l, conf), finHC); }); });
        localEnVol = reel;
        var fin = function () { clearTimeout(minuteur); if (localEnVol === reel) { localEnVol = null; try { updateSend(); } catch (e) { /* sans effet */ } } };
        reel.then(fin, fin);
        // Tout ce qui précède programmerLocal (import, pont, configuration) est dans ce plafond : le minuteur est posé
        // avant la moindre attente, et verifierPlafondEnvoi le déclenche aussi à la reprise si les minuteurs ont été gelés.
        return Promise.race([
          reel,
          new Promise(function (ok) {
            var declencher = function () { ok(resultatKo(d, "local_delai", finHC)); };
            envoiPlafond = { debut: Date.now(), declencher: declencher };
            minuteur = setTimeout(declencher, DELAI_LOCAL_MAX_MS);
          }),
        ]);
      },
    };
    programmerSelonMoyen(m, envoi).catch(function () { return resultatKo(d, "inattendue", finHC); }).then(function (res) {
      try { showAlert(res, d); } catch (e) { try { showAlert(resultatKo(d, "inattendue", finHC), d); } catch (e2) { /* rien de plus */ } }
      busy = false; envoiPlafond = null;
      if (opts && opts.arriere) {
        var pr = plageRelue(res);
        notifierFin(opts.a, resultatNotification({ res: res }), !!(res && res.etat === "ko" && res.incertain), heureNotification({ demande: d, finHC: finHC, debutRelu: pr.debut }));
      }
      // Plage du câble : relue dans un envoi réussi ; inconnue si le résultat est incertain (la ligne disparaît).
      if (res && res.etat === "ok") majPlage(plageDuCable(res));
      else if (res && res.incertain) majPlage(null);
      setDemande(demande); // la demande a pu changer pendant l'envoi
      if (m === "local") {
        var pl = plageRelue(res);
        journal({ action: "page-programmer", ok: !!res && res.etat === "ok", debut: pl.debut, fin: pl.fin, code: res && res.etat === "ko" ? res.code : undefined, manuel: res && res.etat === "ko" ? res.manuel : undefined });
        // Écran éteint après un envoi en arrière-plan : pas de lecture (clé illisible téléphone verrouillé) ;
        // le retour au premier plan relit l'état.
        if (res && res.etat === "ok" && !(opts && opts.arriere && document.hidden)) majEtatCable();
      }
    });
  }

  // ---------- Appli Android : pont natif, état du câble, recherche (mode Local) ----------
  // Chargé seulement si le pont est présent : sur GitHub Pages, ces chemins n'existent pas et ne sont jamais demandés.
  var cherche = false, minuteurRecherche = null, localCache = null, rechercheAutoFaite = false, rechercheEchouee = false;
  // Journal des essais sur émulateur : version de mise au point seulement, une ligne par action, jamais de clé,
  // d'identifiant ni de trame (le résultat de service.js n'en contient pas).
  function journal(o) { if (debugPont) { try { console.log("ESSAI " + JSON.stringify(o)); } catch (e) { /* sans effet */ } } }
  function localPret() {
    if (!localCache) {
      localCache = Promise.all([
        import("./local.js"), import("../android/essai/transport-pont.js"),
      ]).then(function (mods) {
        // Le protocole local tourne dans le code natif : la page ne reçoit ni la clé ni l'identifiant du câble.
        var client = mods[1].creerClientPont(globalThis.PontLocal);
        return client.demarrage().then(function (dem) {
          debugPont = !!(dem && dem.ok && dem.variante === "debug");
          return {
            programmerLocal: mods[0].programmerLocal, surLeReseauDeLaMaison: mods[0].surLeReseauDeLaMaison, etatCable: mods[0].etatCable, chercherCable: mods[0].chercherCable, lireConfigurationCable: mods[0].lireConfigurationCable,
            client: client,
            deps: { client: client },
          };
        });
      });
      localCache.catch(function () { localCache = null; }); // nouvel essai possible au prochain geste
    }
    return localCache;
  }
  function ouvrirPanneau(oui) { $("cablePanel").hidden = !oui; $("pill").setAttribute("aria-expanded", oui ? "true" : "false"); }
  function actionPanneau(action) {
    var label = { chercher: rechercheEchouee ? "Chercher à nouveau" : "Chercher sur le Wi-Fi", relier: "Relier le câble", reessayer: "Réessayer" }[action];
    var act = $("cableAction");
    act.hidden = !label; act.textContent = label || ""; act.setAttribute("data-action", action || "");
  }
  // Ligne « Câble réglé : 00:35 → 06:00 » sous la pastille, seulement quand la plage a été lue.
  function majPlage(plage) {
    plageCable = plage || null;
    var t = ligneCable(plageCable);
    $("cablePlage").hidden = !t;
    $("cablePlage").textContent = t || "";
    updateSend();
  }
  function pastilleMontre(etat) {
    var d = pastille(etat);
    if (etat !== "verification" && etat !== "recherche") etatCable = etat;
    if (etat !== "pret" && etat !== "verification") majPlage(null); // pastille d'échec ou recherche : rien de plus que la pastille
    var interactive = !!(d.aide || d.action);
    $("pill").hidden = !interactive; $("pillFixe").hidden = interactive;
    var box = interactive ? $("pill") : $("pillFixe");
    box.className = "pill " + d.ton;
    $(interactive ? "pillText" : "pillFixeText").textContent = d.texte;
    $("cableMsg").textContent = d.aide || "";
    actionPanneau(d.action);
    if (!interactive) ouvrirPanneau(false);
    updateSend();
  }
  function majEtatCable() {
    if (!pontOk || cherche || opCable) return Promise.resolve();
    pastilleMontre("verification");
    return opCableLancer(function () { return localPret().then(function (l) { return l.etatCable(l.deps); }); }).then(function (r) {
      journal({ action: "page-etat", etat: r.etat });
      if (cherche) return;
      pastilleMontre(r.etat);
      if (r.etat === "pret") majPlage(plageDuCable(r));
      // Aucune adresse connue (première ouverture, nouvelle clé) : une seule recherche automatique par chargement.
      if (rechercheAutomatique({ etat: r.etat, dejaFaite: rechercheAutoFaite, pont: pontOk })) { rechercheAutoFaite = true; lancerRecherche(true); }
    }).catch(function () { if (!cherche) pastilleMontre("erreur"); });
  }
  function lancerRecherche(auto) {
    if (cherche || opCable) return;
    cherche = true;
    var echeance = null;
    // Pendant la recherche, seule la pastille reste (le panneau ferait glisser l'écran) ; le compte à rebours est dans la pastille.
    pastilleMontre("recherche");
    ouvrirPanneau(false);
    function texte() {
      var s = secondesRestantes(echeance, Date.now());
      $("pillSec").textContent = s === null ? "" : " · " + s + " s"; // lecteur d'écran : texte masqué, pas d'annonce chaque seconde
    }
    texte();
    minuteurRecherche = setInterval(texte, 1000);
    var fin = function (r) {
      clearInterval(minuteurRecherche); cherche = false; $("pillSec").textContent = "";
      journal({ action: "page-chercher", auto: auto === true, ok: !!(r && r.ok), etat: r && r.ok ? "pret" : r && r.etat });
      if (r && r.ok) { rechercheEchouee = false; pastilleMontre("pret"); majPlage(plageDuCable({ etat: "pret", plage: r.plage })); ouvrirPanneau(false); return; }
      rechercheEchouee = true;
      var e = r && r.etat;
      // Recherche ratée sans aucune adresse connue : le câble reste « à localiser » (Programmer ouvre le panneau,
      // aucun envoi possible) ; « muet » est réservé à un câble connu qui ne répond pas.
      var inconnu = etatCable === "sans_adresse";
      pastilleMontre(e === "a_relier" ? "a_relier" : e === "hors_wifi" ? "hors_wifi" : e === "introuvable" ? (inconnu ? "sans_adresse" : "muet") : "erreur");
      if (e === "introuvable") $("cableMsg").textContent = "Aucun câble trouvé sur le Wi-Fi. Vérifiez qu'il est branché, fermez Smart Life s'il est ouvert, puis réessayez.";
      $("pillSec").textContent = "";
      ouvrirPanneau(true);
    };
    opCableLancer(function () {
      return localPret().then(function (l) {
        return l.chercherCable(l.deps, function (p) { if (p && Number.isFinite(p.echeance)) echeance = p.echeance; });
      });
    }).then(fin).catch(function () { fin({ ok: false, etat: "erreur" }); });
  }
  $("pill").addEventListener("click", function () {
    if (!$("cableMsg").textContent && $("cableAction").hidden) return; // rien à proposer
    ouvrirPanneau($("cablePanel").hidden);
  });
  $("cableAction").addEventListener("click", function () {
    var a = this.getAttribute("data-action");
    if (att || opCable) return; // une seule lecture ou recherche à la fois : l'attente en a la main
    if (a === "chercher") lancerRecherche(); // seulement sur ce geste
    else if (a === "relier") localPret().then(function (l) { return l.client.saisirCle(); }).catch(function () { $("cableMsg").textContent = "L'application ne répond pas : fermez-la puis rouvrez-la."; });
    else if (a === "reessayer") majEtatCable();
  });
  // Retour de l'écran de saisie de la clé, ou du réglage du Wi-Fi : on relit l'état (une lecture, jamais de recherche).
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { // rien ne part en arrière-plan, sauf l'attente en mode arrière-plan (service de premier plan + notification)
      if (quitterSiCache({ cache: true, arriere: att && att.arriere, prepa: att && att.prepa })) quitterAttente();
      return;
    }
    verifierPlafondEnvoi();
    verifierConfirmation();
    if (soirAffiche !== null && soirAffiche !== cleSoir() && !busy && !att) render(); // page restée ouverte d'un soir à l'autre : bandeau et calcul
    else updateSend(); // « pour cette nuit » / « démarre tout de suite » dépendent de l'heure
    if (pontOk && !busy && !att) majEtatCable();
  });
  // Pastille « Hors Wi-Fi maison » : le Wi-Fi est relu toutes les 5 s (page visible seulement, rien en cours) ;
  // dès que le téléphone est sur le bon réseau, une lecture de l'état (jamais de recherche) passe la pastille à « Câble prêt ».
  var suiviEnCours = false;
  function suivreWifiPastille() {
    verifierPlafondEnvoi();
    if (!pontOk || suiviEnCours || cherche || opCable || controle || !suiviWifiActif({ etat: etatCable, visible: !document.hidden, occupe: busy || !!localEnVol || !!att })) return;
    suiviEnCours = true;
    reseauMaison().then(function (sr) {
      if (sr === "oui" && etatCable === "hors_wifi" && !document.hidden && !att && !busy && !localEnVol) return majEtatCable();
    }).then(function () { suiviEnCours = false; }, function () { suiviEnCours = false; });
  }
  if (pontOk) setInterval(suivreWifiPastille, SUIVI_PASTILLE_MS);
  // Confirmation du % périmée (nouveau jour, ou plus de 6 h) : on redemande, et les anciens résultats disparaissent.
  function verifierConfirmation() {
    if (busy || !confirme || confirmationValable(confirmeLe, Date.now())) return;
    hideAlert(); setConfirme(false);
  }

  // Premier lancement ou données effacées : un seul bandeau, tant qu'il n'a pas été vu (lien ou « Masquer »).
  function defautsVus() { return lsGet(KEY_DEFAUTS) === "1"; }
  function marquerDefautsVus() { lsSet(KEY_DEFAUTS, "1"); $("bandeauDefauts").hidden = true; }
  function afficherBandeauDefauts() { $("bandeauDefauts").hidden = !(reglagesParDefaut && !defautsVus()); }
  $("defautsMasquer").addEventListener("click", marquerDefautsVus);
  $("defautsLien").addEventListener("click", marquerDefautsVus); // la navigation est faite par le gestionnaire commun

  // Stockage persistant : sans lui, Chrome peut vider les réglages et le jeton si le téléphone
  // manque de place. Chrome l'accorde en général à une page installée, sans fenêtre de demande.
  // Facultatif : un refus ou une erreur ne change rien au reste de la page.
  function protegerStockage() {
    var s = navigator.storage;
    if (!s || !s.persist || !s.persisted) return;
    s.persisted().then(function (ok) { return ok || s.persist(); }).then(function (ok) {
      $("stockNote").textContent = ok
        ? "Réglages enregistrés dans ce navigateur, protégés contre l'effacement automatique."
        : "Réglages enregistrés dans ce navigateur. Non protégés : Chrome peut les effacer si le téléphone manque de place (installer la page sur l'écran d'accueil aide).";
    }).catch(function () { /* stockage ordinaire, la page fonctionne pareil */ });
  }

  hideAlert(); load();
  // Essais et captures, seulement sur la machine locale : ?soc=38 simule une dernière valeur, &confirme=1 la confirme.
  var essai = (location.hostname === "127.0.0.1" || location.hostname === "localhost") ? new URLSearchParams(location.search) : null;
  if (essai && socValide(essai.get("soc")) !== null) { $("soc").value = socValide(essai.get("soc")); socEnregistre = true; }
  loadService(); chargerVehicules(); render(); setConfirme(!!essai && essai.get("confirme") === "1" && socValide($("soc").value) !== null); route(false);
  if (pontOk) { $("svcBox").hidden = true; majEtatCable(); } // dans l'appli, le service n'est pas joignable : pas de carte service
  else if (svc.adresse && svc.jeton) {
    // Mode service (GitHub Pages) : une lecture de la plage, purement informative ; au moindre échec, rien de plus n'est affiché.
    lireEtatService(svc.adresse, svc.jeton).then(function (r) { if (r && !busy) majPlage(plageDuCable(r)); }, function () { /* sans effet */ });
  }
  afficherBandeauDefauts();
  protegerStockage();
})();
