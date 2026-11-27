import { plan, hm, fmt, fdur, fr, eur, effAuto, nuitChangementHeure, soirDe, soirSimule, texteChangementHeure } from "./calc.js";
import { lignesValides, marques, modeles, versions, trouver } from "./vehicules.js";
import { validerAdresse, validerJeton, choisirDemande, libelleBouton, envoyer, resultatKo, lireEtatService, RAPPEL_REPROGRAMMER, heureManuelleDe, consigneManuelle, messageNonSuivie } from "./service.js";
import { confirmationValable, confirmationAEnregistrer, confirmationRestauree, CLE_CONFIRMATION, blocageCable, plageRelue, plageDuCable, ligneCable, dejaProgramme, libelleDejaProgramme, contexteHoraire, LIBELLES_SOC, mentionProvisoire, sousLigneBouton, socValide, moyenEnvoi, boutonActif, programmerSelonMoyen, pastille, secondesRestantes, rechercheAutomatique, relectureEtat, relanceRecherche, DELAI_RELECTURE_MS, decisionEnvoi, suiviWifiActif, plafondDepasse, ENVOI_PLAFOND_MS, LIBELLES_ATTENTE, ATTENTE_SONDE_MS, SUIVI_PASTILLE_MS, enteteAttente, memeDemande, titreAttente, lireEtatAttente, ATTENTE_MAX_MS } from "./accueil.js";

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
  var soirAffiche = null, dernierPlan = null, dernierNuit = null, petite = null;
  // « déjà réglé » sous l'heure fixe seulement si la plage lue sur le câble porte bien cette heure ; sinon rien.
  function majTag() {
    var t = $("tagSmall");
    if (petite && petite.aussi) { t.textContent = "à régler aussi"; t.hidden = false; return; }
    var ok = !!(petite && plageCable && (petite.fin ? plageCable.fin : plageCable.debut) === petite.heure);
    t.textContent = "déjà réglé"; t.hidden = !ok;
  }

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
      petite = { heure: fmt(sv ? r.end : r.start), fin: sv, aussi: p.mode === "start" && sv };
      majTag();
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
    // Le plan fournit aussi la fin, la durée de charge et le départ : le câble décide au moment de l'envoi (démarrage tardif).
    setDemande(choisirDemande(r.status, r.status === "none" ? null : fmt(r.start), { fin: fmt(r.end), dureeMin: r.chargeMin, depart: fmt(r.dep), finHC: fmt(hm(cur.hcEnd)) }));
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
  function setConfirme(oui, le) {
    confirme = oui;
    confirmeLe = oui ? (Number.isFinite(le) ? le : Date.now()) : null;
    // Conservée pour un rechargement de la page (thème) : voir accueil.js, confirmationRestauree.
    var brut = oui ? confirmationAEnregistrer(confirmeLe, socValide($("soc").value)) : null;
    if (brut) lsSet(CLE_CONFIRMATION, brut); else lsDel(CLE_CONFIRMATION);
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
    $("socCard").classList.toggle("vide", empty);
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
  var att = null, controle = false; // att : miroir de l'attente tenue par le natif (E3) ; controle : contrôle du réseau au toucher
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
    // Attente : la demande est figée au toucher ; si elle change (% ou réglages), l'attente est annulée (tant que l'envoi n'a pas
    // commencé). On le dit, avec l'heure de l'ancienne demande : rien ne doit laisser croire qu'un envoi est encore en cours.
    // Une attente reprise après un rechargement de la page n'est pas liée à la saisie actuelle : seul « Annuler » l'arrête.
    if (att && !att.reprise && !memeDemande(d, att.d)) annulerAttente("local_attente_modifiee", "Attente annulée");
    // Une alerte qui concerne une autre demande que l'actuelle est périmée.
    if (!busy && alertKey !== null && alertKey !== JSON.stringify(d)) hideAlert();
    updateSend();
  }

  // Hauteur réelle de la barre fixe du bas (police agrandie, attente) -> marge du contenu (--sendbar-h, voir style.css).
  var barreObs = null;
  function mesurerBarre() {
    var b = $("sendBar");
    try {
      if (!b.hidden) document.documentElement.style.setProperty("--sendbar-h", b.offsetHeight + "px");
      if (!barreObs && typeof ResizeObserver === "function") { barreObs = new ResizeObserver(mesurerBarre); barreObs.observe(b); }
    } catch (e) { /* marge par défaut */ }
  }

  function updateSend() {
    svcSummary();
    var b = $("sendBtn"), help = $("sendHelp");
    var occ = busy || !!localEnVol || !!att; // un envoi local dont le plafond est tombé tourne encore : pas de second envoi
    var ctx = demande && dernierPlan ? contexteHoraire({ maintenant: new Date(), hcStart: cur.hcStart, hcEnd: cur.hcEnd, startRel: dernierPlan.startRel, nuitChangement: !!dernierNuit, dep: cur.dep }) : null;
    var lab = libelleBouton(demande, ctx);
    moyen = moyenEnvoi({ pont: pontOk, adresse: svc.adresse, jeton: svc.jeton });
    // Le câble a déjà la plage demandée : rien à envoyer (seulement quand la batterie est confirmée).
    var deja = confirme && dejaProgramme(plageCable, demande, ctx);
    $("sendMain").textContent = att ? (att.envoi ? LIBELLES_ATTENTE.envoi : LIBELLES_ATTENTE.principal) : occ ? "Envoi en cours…" : deja ? libelleDejaProgramme(demande) : (lab ? lab.principal : "Programmer la charge");
    var cle = demande ? JSON.stringify(demande) : null;
    var socVide = String($("soc").value).trim() === "";
    $("sendSub").textContent = sousLigneBouton({
      attente: att ? att.etape : null, attenteRestantMs: att ? att.restantMs : undefined, occupe: occ, delaiS: moyen === "local" ? 30 : 25, demande: demande, confirme: confirme, socVide: socVide,
      reussi: reussi && reussi.cle === cle ? "programmé à " + reussi.heure + " · relu sur le câble" : null, deja: deja,
      blocage: moyen === "local" ? blocageCable(etatCable) : null,
      secondaire: lab ? lab.secondaire : "",
    });
    b.disabled = !boutonActif({ moyen: moyen, demande: demande, confirme: confirme, occupe: occ, dejaProgramme: deja });
    b.classList.toggle("attente", !b.disabled && moyen === "local" && !!blocageCable(etatCable));
    // Sans moyen d'envoi, la barre est masquée : réglage manuel avec l'heure affichée (voir Aide).
    $("sendBar").hidden = !moyen;
    mesurerBarre();
    document.body.classList.toggle("has-sendbar", !!moyen);
    // Écran d'attente : l'état en haut, la consigne en clair (début et fin à régler à la main), « Annuler » puis « Régler à la main ».
    $("attenteBox").hidden = !att;
    $("attenteEtat").textContent = att ? enteteAttente(att.heure && att.heure.debut) : "";
    $("attenteConsigne").textContent = att ? consigneManuelle(att.d, att.finHC) : "";
    $("attenteAnnuler").hidden = !!(att && att.envoi); // « Annuler » n'agit qu'avant l'envoi de l'écriture
    $("attenteInfo").textContent = att && att.info ? att.info : "";
    $("attenteInfo").hidden = !(att && att.info);
    document.body.classList.toggle("en-attente", !!att);
    help.hidden = !(moyen && !demande && !occ);
    if (!help.hidden) help.textContent = socVide ? "Entrez votre batterie pour pouvoir programmer la charge." : "Corrigez la saisie pour pouvoir programmer la charge.";
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
      if (res.rappel2) a.appendChild(el("p", null, res.rappel2));
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

  function reseauMaison() {
    return localPret().then(function (l) { return l.surLeReseauDeLaMaison(l.deps); }).catch(function () { return "inconnu"; });
  }
  // Appel au pont natif ; ne rejette jamais.
  function appelPont(op, params, delaiMs) {
    return localPret().then(function (l) { return l.client.appeler(op, params || {}, delaiMs); }).catch(function () { return { ok: false }; });
  }

  // ---------- Attente tenue par le code natif (lot E3) ----------
  // « Programmer » touché avant que le téléphone et le câble soient prêts : la demande est confiée au natif (attenteDebut), qui
  // attend le Wi-Fi puis le câble (10 min au plus), envoie et notifie, même appli balayée ou écran éteint. Ici, on relit son état
  // (attenteEtat, page visible) et on affiche ce qu'il rend ; le résultat BRUT est interprété par service.js (resultatAttente).
  function sortirAttente() {
    var a = att;
    if (!a) return null;
    clearInterval(a.timer); att = null;
    $("attenteLive").textContent = "";
    updateSend();
    return a;
  }
  // Fin d'attente sans envoi : carte KO avec l'heure à régler à la main (règle 2).
  function koAttente(a, code, titre) {
    var r = resultatKo(a.d, code, a.finHC);
    if (code === "local_non_suivie") r.message = messageNonSuivie(a.heure);
    r.titre = titre;
    try { showAlert(r, a.d); } catch (e) { /* l'état du bouton est déjà rendu */ }
  }

  // Permission de notification : demandée une seule fois, jamais bloquante (refusée, l'attente tourne quand même).
  function notificationsDabord(a) {
    return localPret().then(function (l) {
      return l.client.notifications().then(function (n) {
        if (n && n.ok && n.autorise) return null;
        a.info = LIBELLES_ATTENTE.autoriser; if (att === a) updateSend();
        return l.client.demanderNotifications().then(function (r) {
          a.info = r && r.ok && r.autorise ? "" : LIBELLES_ATTENTE.sansNotifications; if (att === a) updateSend();
        });
      });
    }).catch(function () { /* facultatif */ });
  }

  function demarrerAttente(sr) {
    var d = demande, finHC = fmt(hm(cur.hcEnd));
    var h = heureManuelleDe(d, finHC, new Date());
    var a = att = { d: d, finHC: finHC, heure: h, etape: sr === "oui" ? "cable" : "wifi", restantMs: ATTENTE_MAX_MS, envoi: false,
      demarre: false, envoye: false, annulee: false, annulation: false, enSonde: false, timer: null, info: "", reprise: false };
    hideAlert();
    $("attenteLive").textContent = LIBELLES_ATTENTE.annonce;
    journal({ action: "page-attente-wifi", etat: "debut" });
    if (sr === "oui") journal({ action: "page-attente-wifi", etat: "cable" });
    updateSend();
    notificationsDabord(a).then(function () {
      if (a.annulee) return null; // annulée pendant la demande de permission : le natif n'a rien reçu
      a.envoye = true; // dès maintenant, le natif a peut-être démarré : une annulation passe par lui
      return appelPont("attenteDebut", { demande: d, heureManuelle: h }, 15000);
    }).then(function (r) {
      if (!r) return;
      if (!r.ok) {
        journal({ action: "page-attente-wifi", etat: "refusee", erreur: r.erreur });
        var definitive = r.erreur === "requete_invalide" || r.erreur === "pas_de_cle" || r.erreur === "service";
        if (!definitive) {
          // Réponse ambiguë (pont muet, délai de 15 s, occupé) : le natif a peut-être démarré. On relit son état avant de conclure.
          if (att === a) sortirAttente();
          return reprendreAttente().then(function (trouve) {
            if (trouve) return;
            if (a.annulee) koAttente(a, a.codeAnnul, a.titreAnnul);
            else koAttente(a, "local_format", "Programmation non confirmée");
          });
        }
        if (att !== a) return;
        sortirAttente();
        var code = r.erreur === "pas_de_cle" ? "local_pas_de_cle" : r.erreur === "service" ? "local_attente_refusee" : "requete_invalide";
        koAttente(a, code, "Programmation non envoyée");
        if (code === "local_pas_de_cle") majEtatCable();
        return;
      }
      a.demarre = true;
      if (a.annulee) { confirmerAnnulation(a); return; } // « Annuler » touché pendant le démarrage : c'est le natif qui décide
      if (att !== a) return;
      suivreAttente(a);
    });
  }
  function suivreAttente(a) {
    if (!a.timer) a.timer = setInterval(sonderAttente, ATTENTE_SONDE_MS);
    sonderAttente();
  }
  // Annulation demandée pendant le démarrage : le pilote a pu passer en phase envoi entre-temps. La carte « rien n'a été envoyé »
  // n'est affichée que si le natif confirme l'annulation (annulee:true) ; sinon l'attente continue jusqu'au résultat.
  function confirmerAnnulation(a) {
    appelPont("attenteAnnuler").then(function (r) {
      if (r && r.ok && r.annulee === true) {
        if (att === a) sortirAttente();
        journal({ action: "page-attente-wifi", etat: "annulee" });
        koAttente(a, a.codeAnnul, a.titreAnnul);
        appelPont("attenteAcquitter");
        return;
      }
      a.annulee = false; a.annulation = false;
      if (att !== a) { reprendreAttente(); return; }
      a.envoi = !!(r && r.ok); a.info = "L'envoi a commencé : il ne peut plus être annulé.";
      updateSend(); suivreAttente(a);
    });
  }

  // Une seule lecture de l'état à la fois ; page visible seulement (cachée, le natif continue sans elle).
  function sonderAttente() {
    var a = att;
    if (!a || !a.demarre || a.enSonde || document.hidden) return Promise.resolve();
    a.enSonde = true;
    return appelPont("attenteEtat", {}, 5000).then(function (e) {
      a.enSonde = false;
      if (att !== a) return;
      var s = lireEtatAttente(e);
      if (s.action === "suivre") {
        if (a.etape !== s.etape) { a.etape = s.etape; journal({ action: "page-attente-wifi", etat: s.etape === "envoi" ? "envoi" : s.etape === "recherche" ? "recherche" : "cable" }); }
        a.envoi = s.envoi; a.restantMs = s.restantMs;
        updateSend();
      } else if (s.action === "finir") finirAttente(a, s);
      else if (e && e.ok && e.phase === "inactive") finirAttente(a, { resultat: { ok: false, erreur: "non_suivie" }, heureManuelle: a.heure }); // le natif n'a plus rien : suivi perdu
    });
  }

  // Résultat du natif : carte « ok » ou KO avec l'heure à régler à la main, puis acquittement (il ne sera plus rendu).
  function finirAttente(a, f) {
    if (att === a) sortirAttente();
    var res = lireResultatAttente(a, f);
    try { showAlert(res, a.d); } catch (e) { try { showAlert(resultatKo(a.d, "inattendue", a.finHC), a.d); } catch (e2) { /* rien de plus */ } }
    appelPont("attenteAcquitter");
    var pl = plageRelue(res);
    journal({ action: "page-attente-wifi", etat: "fin", ok: res.etat === "ok", code: res.etat === "ko" ? res.code : undefined });
    journal({ action: "page-programmer", ok: res.etat === "ok", debut: pl.debut, fin: pl.fin, tardif: res.tardif === true ? true : undefined, code: res.etat === "ko" ? res.code : undefined, manuel: res.etat === "ko" ? res.manuel : undefined });
    if (res.etat === "ok") majPlage(plageDuCable(res)); else if (res.incertain) majPlage(null);
    if (res.etat === "ko" && res.code === "local_attente_cle") majEtatCable().then(function () { ouvrirPanneau(true); });
    else if (res.etat === "ok") cablePretApresSucces(res);
    // Pas de setDemande ici : la demande figée du natif peut différer de la saisie actuelle, et la carte du résultat ne doit pas disparaître.
    updateSend();
  }
  // Résultat BRUT du natif -> carte (service.js, seul chemin vers « ok »). Le module local est déjà chargé : l'attente l'a demandé.
  var resultatAttenteFn = null;
  function lireResultatAttente(a, f) {
    var r = resultatAttenteFn ? resultatAttenteFn(a.d, f.resultat, a.finHC, undefined, f.heureManuelle || a.heure) : resultatKo(a.d, "local_non_suivie", a.finHC);
    if (r.etat === "ko") { var t = titreAttente(r.code); if (t) r.titre = t; }
    return r;
  }

  // Page (re)chargée ou rouverte : une attente peut tourner côté natif, ou avoir fini en notre absence (résultat à montrer une fois).
  var repriseEnVol = null; // une seule reprise à la fois : évite une double carte et un double page-programmer
  function reprendreAttente() {
    if (!pontOk) return Promise.resolve(false);
    if (att) return Promise.resolve(true);
    if (repriseEnVol) return repriseEnVol;
    var p = appelPont("attenteEtat", {}, 5000).then(function (e) {
      var s = lireEtatAttente(e);
      if (att) return true;
      if (s.action !== "suivre" && s.action !== "finir") return false;
      var a = { d: s.demande, finHC: fmt(hm(cur.hcEnd)), heure: s.heureManuelle, etape: s.etape, restantMs: s.restantMs, envoi: !!s.envoi,
        demarre: true, envoye: true, annulee: false, annulation: false, enSonde: false, timer: null, info: "", reprise: true };
      if (s.action === "finir") { finirAttente(a, s); return true; }
      att = a;
      a.timer = setInterval(sonderAttente, ATTENTE_SONDE_MS);
      $("attenteLive").textContent = LIBELLES_ATTENTE.annonce;
      journal({ action: "page-attente-wifi", etat: "reprise", phase: a.envoi ? "envoi" : "attente" });
      updateSend();
      return true;
    }).then(function (r) { repriseEnVol = null; return r; }, function () { repriseEnVol = null; return false; });
    repriseEnVol = p;
    return p;
  }

  // Annulation voulue (bouton, ou saisie modifiée). Avant le démarrage du natif, on s'arrête ici ; ensuite, c'est le natif qui décide :
  // « Annuler » n'agit qu'avant l'envoi de l'écriture, et s'il est refusé l'attente continue jusqu'au résultat.
  function annulerAttente(code, titre) {
    var a = att;
    if (!a || a.annulation) return;
    if (!a.demarre) {
      a.annulee = true;
      if (!a.envoye) { // le natif n'a encore rien reçu : on s'arrête ici
        sortirAttente();
        journal({ action: "page-attente-wifi", etat: "annulee" });
        koAttente(a, code, titre);
        return;
      }
      // Le natif a peut-être démarré (et peut être passé à l'envoi) : à sa réponse, on lui demande d'annuler ; rien n'est affiché avant.
      a.codeAnnul = code; a.titreAnnul = titre; a.info = "Annulation en cours…";
      updateSend();
      return;
    }
    a.annulation = true;
    appelPont("attenteAnnuler").then(function (r) {
      a.annulation = false;
      if (att !== a) return;
      if (r && r.ok && r.annulee === true) {
        sortirAttente();
        journal({ action: "page-attente-wifi", etat: "annulee" });
        koAttente(a, code, titre);
        appelPont("attenteAcquitter");
      } else if (r && r.ok) { // l'envoi a commencé entre-temps : plus annulable
        a.envoi = true; a.info = "L'envoi a commencé : il ne peut plus être annulé."; updateSend(); sonderAttente();
      }
    });
  }
  $("attenteAnnuler").addEventListener("click", function () { annulerAttente("local_attente_annulee", "Programmation annulée"); });

  // Envoi direct, page au premier plan : le câble répond déjà (sinon, attente tenue par le natif).
  function lancerEnvoi() {
    var d = demande, m = moyen, finHC = fmt(hm(cur.hcEnd));
    busy = true;
    try { hideAlert(); updateSend(); } catch (e) { /* l'envoi et son alerte restent garantis ci-dessous */ }
    var envoi = {
      service: function () { return envoyer(svc.adresse, svc.jeton, d, { finHC: finHC }); },
      local: function () {
        // Aucun repli vers le service : si le mode Local échoue, l'échec est affiché avec l'heure à régler à la main.
        // Plafond de 30 s : l'échec est affiché, mais le bouton reste occupé jusqu'à la fin réelle de l'envoi.
        var minuteur = null;
        var t0 = performance.now();
        var reel = opCableLancer(function () { return localPret().then(function (l) { return l.programmerLocal(d, l.deps, finHC); }); });
        reel.then(function (r) { journal({ action: "page-duree", op: "ecriture", ok: !!r && r.etat === "ok", ms: Math.round(performance.now() - t0) }); }, function () { /* sans effet */ });
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
      // Plage du câble : relue dans un envoi réussi ; inconnue si le résultat est incertain (la ligne disparaît).
      if (res && res.etat === "ok") majPlage(plageDuCable(res));
      else if (res && res.incertain) majPlage(null);
      setDemande(demande); // la demande a pu changer pendant l'envoi
      if (m === "local") {
        var pl = plageRelue(res);
        journal({ action: "page-programmer", ok: !!res && res.etat === "ok", debut: pl.debut, fin: pl.fin, tardif: res && res.tardif === true ? true : undefined, code: res && res.etat === "ko" ? res.code : undefined, manuel: res && res.etat === "ko" ? res.manuel : undefined });
        if (res && res.etat === "ok") cablePretApresSucces(res);
      }
    });
  }

  // ---------- Appli Android : pont natif, état du câble, recherche (mode Local) ----------
  // Chargé seulement si le pont est présent : sur GitHub Pages, ces chemins n'existent pas et ne sont jamais demandés.
  var cherche = false, minuteurRecherche = null, localCache = null, rechercheAutoFaite = false, rechercheEchouee = false;
  // Après un envoi réussi, programmerLocal a déjà relu et vérifié la plage : aucune connexion de plus. On reproduit ici ce que
  // majEtatCable déduit d'une lecture réussie (pastille « Câble prêt », plage), à partir du résultat seulement.
  function cablePretApresSucces(res) {
    if (cherche) return; // une recherche en cours garde la pastille
    pastilleMontre("pret");
    majPlage(plageDuCable(res));
  }
  // Journal des essais sur émulateur : version de mise au point seulement, une ligne par action, jamais de clé,
  // d'identifiant ni de trame (le résultat de service.js n'en contient pas).
  function journal(o) { if (debugPont) { try { console.log("ESSAI " + JSON.stringify(o)); } catch (e) { /* sans effet */ } } }
  function localPret() {
    if (!localCache) {
      localCache = Promise.all([
        import("./local.js"), import("./pont.js"),
      ]).then(function (mods) {
        // Le protocole local tourne dans le code natif : la page ne reçoit ni la clé ni l'identifiant du câble.
        resultatAttenteFn = mods[0].resultatAttente;
        var client = mods[1].creerClientPont(globalThis.PontLocal);
        return client.demarrage().then(function (dem) {
          debugPont = !!(dem && dem.ok && dem.variante === "debug");
          journal({ action: "page-prete", ms: Math.round(performance.now()) }); // depuis le début du chargement de la page
          return {
            programmerLocal: mods[0].programmerLocal, surLeReseauDeLaMaison: mods[0].surLeReseauDeLaMaison, etatCable: mods[0].etatCable, chercherCable: mods[0].chercherCable, resultatAttente: mods[0].resultatAttente,
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
    $("cablePlage").hidden = !t && !pontOk; // dans l'appli, la place est réservée dès l'ouverture : rien ne glisse à l'apparition
    majTag();
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
  function majEtatCable(relu) {
    if (!pontOk || cherche || opCable) return Promise.resolve();
    pastilleMontre("verification");
    var t0 = performance.now();
    return opCableLancer(function () { return localPret().then(function (l) { return l.etatCable(l.deps); }); }).then(function (r) {
      var ms = Math.round(performance.now() - t0);
      if (cherche) { journal({ action: "page-etat", etat: r.etat, relu: relu === true, ms: ms }); return; }
      // Premier contact raté avec un câble connu : la pastille reste « vérification », une seconde lecture suit
      // (journalisée à part : « page-etat » ne porte que le résultat montré).
      if (relectureEtat({ etat: r.etat, dejaRelu: relu === true })) {
        journal({ action: "page-etat-relecture", etat: r.etat, ms: ms });
        return new Promise(function (ok) { setTimeout(ok, DELAI_RELECTURE_MS); }).then(function () {
          if (cherche) return; // la recherche a pris la pastille et la finira
          // Un envoi, une attente ou une autre lecture a pris la main pendant le délai : pas de nouvelle connexion au câble
          // (une seule à la fois) et la pastille ne reste pas sur « vérification » : on montre le premier résultat.
          if (opCable || att || busy || localEnVol || controle) { pastilleMontre(r.etat); return; }
          return majEtatCable(true);
        });
      }
      journal({ action: "page-etat", etat: r.etat, relu: relu === true, ms: ms });
      pastilleMontre(r.etat);
      if (r.etat === "pret") majPlage(plageDuCable(r));
      // Aucune adresse connue (première ouverture, nouvelle clé) : une seule recherche automatique par chargement.
      if (rechercheAutomatique({ etat: r.etat, dejaFaite: rechercheAutoFaite, pont: pontOk })) { rechercheAutoFaite = true; lancerRecherche(true); }
    }).catch(function () { if (!cherche) pastilleMontre("erreur"); });
  }
  function lancerRecherche(auto, relance) {
    if (cherche || opCable) return;
    cherche = true;
    var echeance = null, t0 = performance.now();
    // Pendant la recherche, seule la pastille reste (le panneau ferait glisser l'écran) ; le compte à rebours est dans la pastille.
    pastilleMontre("recherche");
    ouvrirPanneau(false);
    function texte() {
      var s = secondesRestantes(echeance, Date.now());
      $("pillSec").textContent = s === null ? "" : " · " + s + " s"; // lecteur d'écran : texte masqué, pas d'annonce chaque seconde
    }
    texte();
    minuteurRecherche = setInterval(texte, 1000);
    var fin = function (r, sansRelance) {
      var ms = Math.round(performance.now() - t0);
      if (!(r && r.ok) && relanceRecherche({ auto: auto, etat: r && r.etat, ms: ms, dejaRelancee: relance === true || sansRelance === true })) {
        // Réponse trop rapide pour une vraie fouille : la pastille reste « recherche » (cherche reste vrai, aucun autre geste
        // ne passe), une seconde recherche suit.
        journal({ action: "page-chercher-relance", etat: r && r.etat, ms: ms });
        setTimeout(function () {
          // Une opération a pris la main pendant le délai : pas de seconde recherche, l'échec est montré tel quel.
          if (opCable || att || busy || localEnVol || controle) { fin(r, true); return; }
          clearInterval(minuteurRecherche); cherche = false; lancerRecherche(true, true);
        }, DELAI_RELECTURE_MS);
        return;
      }
      clearInterval(minuteurRecherche); cherche = false; $("pillSec").textContent = "";
      journal({ action: "page-chercher", auto: auto === true, ok: !!(r && r.ok), etat: r && r.ok ? "pret" : r && r.etat, ms: ms });
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
    if (document.hidden) return; // l'attente éventuelle continue dans le service natif, sans la page
    verifierPlafondEnvoi();
    verifierConfirmation();
    updateSend(); // l'heure a pu changer pendant l'absence
    if (soirAffiche !== null && soirAffiche !== cleSoir() && !busy && !att) render(); // page restée ouverte d'un soir à l'autre : bandeau et calcul
    else updateSend(); // « pour cette nuit » / « démarre tout de suite » dépendent de l'heure
    if (pontOk && !busy) {
      if (att) sonderAttente();
      else reprendreAttente().then(function () { if (!att && !busy) majEtatCable(); }); // une attente finie en notre absence : résultat montré ici
    } else if (!pontOk && !busy) lirePlageService();
  });
  // Mode service : la plage lue n'est jamais gardée d'une visite à l'autre (« Déjà programmé » ne doit jamais
  // reposer sur une lecture périmée : onglet ouvert d'un soir à l'autre, autre téléphone). Elle est effacée puis relue,
  // au plus une fois par minute (limite d'appels du service) ; au moindre échec, rien de plus n'est affiché.
  var derniereLecturePlage = 0;
  function lirePlageService() {
    if (pontOk || !svc.adresse || !svc.jeton) return;
    if (Date.now() - derniereLecturePlage < 60000) return;
    derniereLecturePlage = Date.now();
    majPlage(null);
    lireEtatService(svc.adresse, svc.jeton).then(function (r) { if (r && !busy) majPlage(plageDuCable(r)); }, function () { /* sans effet */ });
  }
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
  // Chaque minute, page visible : « Déjà programmé » et la sous-ligne du bouton suivent l'heure (une heure de début qui passe change la décision).
  setInterval(function () { if (!document.hidden) { try { updateSend(); } catch (e) { /* sans effet */ } } }, 60000);
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
  var confirmationReprise = confirmationRestauree(lsGet(CLE_CONFIRMATION), Date.now(), socValide($("soc").value)); // avant tout setConfirme
  loadService(); chargerVehicules(); render();
  setConfirme(confirmationReprise !== null || (!!essai && essai.get("confirme") === "1" && socValide($("soc").value) !== null), confirmationReprise);
  route(false);
  if (pontOk) { $("svcBox").hidden = true; reprendreAttente().then(function () { if (!att && !busy) majEtatCable(); }); } // dans l'appli, le service n'est pas joignable : pas de carte service
  else lirePlageService(); // Mode service (GitHub Pages) : lecture de la plage au chargement, puis à chaque retour sur la page
  afficherBandeauDefauts();
  protegerStockage();
})();
