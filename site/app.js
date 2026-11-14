import { plan, hm, fmt, fdur, fr, eur } from "./calc.js";
import { validerAdresse, validerJeton, choisirDemande, libelleBouton, consigneManuelle, envoyerEtAfficher } from "./service.js";

(function () {
  var DEFAULTS = { cap: 46, soh: 92, target: 80, dep: "07:30", hcStart: "22:00", hcEnd: "06:00", amp: 16, volt: 230, eff: 90, pre: 30, pHC: 0.146688, pHP: 0.196476, mode: "end", deduct: false, soc: 38 };
  var KEY = "recharge-ds3-v1"; // clé inchangée depuis la phase 1 : aucun paramètre perdu
  var ids = ["cap", "soh", "target", "dep", "hcStart", "hcEnd", "amp", "volt", "eff", "pre", "pHC", "pHP", "mode"];
  var NUMS = ["cap", "soh", "target", "amp", "volt", "eff", "pre", "pHC", "pHP"];
  var CAR = ["cap", "soh", "amp", "volt", "eff"];
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

  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    var p = Object.assign({}, DEFAULTS);
    if (s && typeof s === "object") Object.keys(DEFAULTS).forEach(function (k) { if (s[k] !== null && s[k] !== undefined) p[k] = s[k]; });
    ids.forEach(function (k) { setVal(k, p[k]); });
    $("deduct").checked = !!p.deduct;
    $("soc").value = p.soc; $("socRange").value = p.soc;
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

  var LABELS = { cap: "Capacité utile", soh: "SOH", target: "Batterie visée", dep: "Heure de départ", hcStart: "Début heures creuses", hcEnd: "Fin heures creuses", amp: "Courant de charge", volt: "Tension", eff: "Rendement de charge", pre: "Prise rallumée avant départ", pHC: "Prix heures creuses", pHP: "Prix heures pleines", soc: "Batterie à l'arrivée" };
  var TIME_RE = /^\d{1,2}:\d{2}$/;
  function okNum(k, v) {
    if (!isFinite(v)) return false;
    if (k === "soc" || k === "target") return v >= 0 && v <= 100;
    if (k === "soh" || k === "eff") return v > 0 && v <= 100;
    if (k === "pre") return v >= 0 && v <= 600;
    return v > 0; // cap, amp, volt, pHC, pHP : vide ou 0 = invalide, jamais traité comme 0
  }

  // Lit les champs. Un champ vide ou hors limites est signalé et n'entre pas dans le plan.
  function read() {
    var p = {}, bad = [];
    ids.forEach(function (k) { p[k] = getVal(k); });
    NUMS.forEach(function (k) {
      var raw = String($(k).value).trim();
      var v = raw === "" ? NaN : Number(raw);
      p[k] = v;
      if (!okNum(k, v)) bad.push(k);
    });
    ["dep", "hcStart", "hcEnd"].forEach(function (k) {
      if (!TIME_RE.test(p[k])) bad.push(k);
    });
    if (p.mode !== "start" && p.mode !== "end") p.mode = "end";
    p.deduct = $("deduct").checked;
    var rawSoc = String($("soc").value).trim();
    p.soc = rawSoc === "" ? NaN : Number(rawSoc);
    if (!okNum("soc", p.soc)) bad.push("soc");
    return { p: p, bad: bad };
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
    $("timeline").textContent = ""; $("ticks").textContent = "";
    $("timeline").setAttribute("aria-label", "Frise de la nuit : aucun plan calculé");
    $("ampWarn").hidden = true;
  }

  function updateStatic() {
    $("chipText").textContent = fmt(hm(cur.dep)) + " · " + cur.target + " %";
    $("chip").setAttribute("aria-label", "Départ " + fmt(hm(cur.dep)) + ", batterie visée " + cur.target + " %. Modifier dans les paramètres");
    $("carSum").textContent = num(cur.cap) + " kWh · SOH " + num(cur.soh) + " % · " + num(cur.amp) + " A · " + num(cur.volt) + " V · rendement " + num(cur.eff) + " %";
    var dep = hm(cur.dep), preS = dep - cur.pre;
    var fills = { dep: fmt(dep), preS: fmt(preS), pre: String(cur.pre), hcStart: fmt(hm(cur.hcStart)), hcEnd: fmt(hm(cur.hcEnd)) };
    Array.prototype.forEach.call(document.querySelectorAll("[data-fill]"), function (e) { e.textContent = fills[e.getAttribute("data-fill")]; });
    $("lblHc").textContent = fills.hcStart + " – " + fills.hcEnd;
    $("lblPre").textContent = fills.preS + " – " + fills.dep;
  }

  function render() {
    var rd = read(), p = rd.p, bad = rd.bad;
    mark(bad);
    // Enregistre uniquement les champs valides : les autres gardent leur dernière valeur valide.
    ids.forEach(function (k) { if (bad.indexOf(k) < 0) cur[k] = p[k]; });
    cur.deduct = p.deduct;
    if (bad.indexOf("soc") < 0) cur.soc = p.soc;
    save(cur);
    updateStatic();
    syncStepper();

    var pe = $("paramErr");
    pe.hidden = true;

    if (bad.length) {
      clearResults();
      var pbad = bad.filter(function (k) { return k !== "soc"; });
      var t = el("p", "alt-text", "Aucun plan calculé. À corriger : " + bad.map(function (k) { return LABELS[k]; }).join(", ") + ". ");
      if (pbad.length) {
        var a = el("a", null, "Ouvrir les paramètres"); a.href = "#parametres"; a.setAttribute("data-nav", "parametres");
        t.appendChild(a);
        pe.hidden = false;
        pe.textContent = "Valeur manquante ou impossible : " + pbad.map(function (k) { return LABELS[k]; }).join(", ") + ". Le calcul reste en attente tant qu'elle n'est pas corrigée.";
        if (pbad.some(function (k) { return CAR.indexOf(k) >= 0; })) $("carBox").open = true;
      }
      setHero("bad", "Saisie à corriger", [t]);
      announce("Saisie à corriger");
      drawAide(null, null);
      setDemande(null);
      return;
    }

    var r = plan(p);
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
      setHero("none", "Pas de charge nécessaire", [el("p", "alt-text", "Désactivez la plage de charge du câble pour cette nuit. Il se rallumera quand même à " + fmt(r.preS) + " pour le préconditionnement.")]);
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
      $("tagSmall").textContent = (p.mode === "start" && sv) ? "à régler aussi" : "inchangé";
      var note = $("heroNote");
      if (r.status === "short") {
        note.hidden = false;
        note.textContent = "Démarre avant les heures creuses : " + fdur(r.offMin) + " au tarif plein (environ " + fr(r.offMin / 60 * r.P, 1) + " kWh).";
      } else note.hidden = true;
      announce((sv ? "Allumer la prise à " : "Éteindre à ") + fmt(sv ? r.start : r.end));
    }

    // Tuiles
    $("fArr").textContent = Math.round(r.arrival) + " %";
    var as = $("fArrS");
    if (reached) { as.textContent = "objectif atteint"; as.className = "ts"; }
    else { as.textContent = Math.round(p.target - r.arrival) + " % sous l'objectif"; as.className = "ts miss"; }
    $("fDur").textContent = r.status === "none" ? "0 h 00" : fdur(r.chargeMin);
    $("fKwh").textContent = fr(r.kwh, 1) + " kWh";
    $("fCost").textContent = eur(r.cost);
    var cs = $("fCostS");
    if (r.kwhHP > 0) { cs.textContent = "dont " + eur(r.kwhHP * p.pHP) + " hors creuses"; cs.className = "ts hp"; }
    else { cs.textContent = r.kwh > 0 ? "100 % creuses" : "aucune charge"; cs.className = "ts"; }

    var aw = $("ampWarn");
    if (p.amp > 16) {
      aw.hidden = false;
      aw.textContent = "Au-delà de 16 A (3,7 kW), une prise Green'up ne suffit plus : il faut une borne de recharge.";
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
    var label = "Préconditionnement " + fmt(r.preS) + " – " + fmt(r.dep);
    if (r.chargeMin > 0) {
      seg("charge", r.startRel, r.chargeMin);
      var txt = "Charge " + fmt(r.start) + " → " + fmt(r.end);
      tl.appendChild(el("span", "clabel in", txt));
      label = txt.replace("→", "à") + ". " + label;
    } else label = "Pas de charge. " + label;
    seg("pre", r.preRel, r.depRel - r.preRel);
    tl.setAttribute("aria-label", "Frise de la nuit. Heures creuses " + $("lblHc").textContent + ". " + label);

    tk.textContent = "";
    var step = total > 14 * 60 ? 240 : 120; // nuit très longue (charge bien avant les HC) : toutes les 4 h, sinon illisible
    var first = Math.ceil((r.hcS + o) / step) * step - r.hcS;
    for (var x = first; x <= endX; x += step) {
      var s = el("span", null, fmt(r.hcS + x).slice(0, 2) + " h");
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

  // ---------- Saisie de la batterie : champ, boutons − / + et curseur synchronisés ----------
  function syncStepper() {
    var v = Number($("soc").value), empty = String($("soc").value).trim() === "";
    $("socMinus").disabled = !empty && v <= 0;
    $("socPlus").disabled = !empty && v >= 100;
  }
  function bump(d) {
    var raw = String($("soc").value).trim(), v = Number(raw);
    if (raw === "" || !isFinite(v)) v = cur.soc;
    v = Math.min(100, Math.max(0, Math.round(v) + d));
    $("soc").value = v; $("socRange").value = v;
    render();
  }
  $("socMinus").addEventListener("click", function () { bump(-1); });
  $("socPlus").addEventListener("click", function () { bump(1); });
  $("socRange").addEventListener("input", function () { $("soc").value = this.value; render(); });
  $("soc").addEventListener("input", function () { if ($("soc").value !== "") $("socRange").value = $("soc").value; render(); });

  ids.filter(function (k) { return k !== "mode"; }).concat(["deduct"]).forEach(function (k) { $(k).addEventListener("input", render); $(k).addEventListener("change", render); });
  Array.prototype.forEach.call(radios(), function (r) { r.addEventListener("change", render); });
  $("resetBtn").addEventListener("click", function () {
    if (!window.confirm("Revenir aux valeurs de départ ? Tous vos réglages seront remplacés.")) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    cur = Object.assign({}, DEFAULTS);
    load(); render();
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
    Array.prototype.forEach.call(document.querySelectorAll(".tabbar a"), function (a) {
      if (a.getAttribute("data-nav") === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
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
  var demande = null, busy = false, alertKey = null;

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
    // Une alerte qui concerne une autre demande que l'actuelle est périmée.
    if (!busy && alertKey !== null && alertKey !== JSON.stringify(d)) hideAlert();
    updateSend();
  }

  function updateSend() {
    var b = $("sendBtn"), help = $("sendHelp");
    var lab = libelleBouton(demande);
    var configured = !!(svc.adresse && svc.jeton);
    $("sendMain").textContent = busy ? "Envoi en cours…" : (lab ? lab.principal : "Programmer la charge");
    $("sendSub").textContent = busy ? "patientez, jusqu'à 25 secondes" : (lab ? lab.secondaire : "saisie à corriger");
    b.disabled = busy || !configured || !demande;
    help.textContent = "";
    if (!configured && !busy) {
      help.hidden = false;
      help.append("Service non configuré : renseignez l'adresse et le jeton dans ", navLink("Paramètres", "#parametres", "parametres"), ". Le réglage manuel dans Smart Life reste possible (voir ", navLink("Aide", "#aide", "aide"), ").");
    } else if (!demande && !busy) {
      help.hidden = false;
      help.textContent = "Corrigez la saisie pour pouvoir programmer la charge.";
    } else help.hidden = true;
    b.setAttribute("aria-busy", busy ? "true" : "false");
  }

  // Deux conteneurs permanents (présents dès le chargement, annoncés par les lecteurs d'écran) :
  // on ne fait que les remplir ou les vider.
  function hideAlert() { $("sendOk").textContent = ""; $("sendKo").textContent = ""; alertKey = null; }
  function showAlert(res, d) {
    hideAlert();
    var a = res.etat === "ok" ? $("sendOk") : $("sendKo");
    if (res.etat === "ok") {
      a.appendChild(el("p", "alert-title", res.message));
      if (res.detail) a.appendChild(el("p", null, res.detail));
    } else {
      a.appendChild(el("p", "alert-title", "Programmation non confirmée"));
      a.appendChild(el("p", null, res.message));
      a.appendChild(el("p", "manual", res.manuel));
      if (res.verifier) a.appendChild(el("p", null, res.verifier));
      var l = el("p", null); l.appendChild(navLink("Voir l'aide au réglage manuel", "#aide", "aide"));
      a.appendChild(l);
    }
    alertKey = JSON.stringify(d);
    try { if (a.scrollIntoView) a.scrollIntoView({ block: "nearest" }); } catch (e) { /* défilement facultatif */ }
  }

  $("sendBtn").addEventListener("click", function () {
    if (busy || !demande || !svc.adresse || !svc.jeton) return;
    var d = demande;
    busy = true;
    try { hideAlert(); updateSend(); } catch (e) { /* l'envoi et son alerte restent garantis ci-dessous */ }
    envoyerEtAfficher(svc.adresse, svc.jeton, d, function (res) { showAlert(res, d); }).then(function () {
      busy = false;
      // La demande a pu changer pendant l'envoi : l'alerte ne doit pas rester pour une autre demande.
      setDemande(demande);
    });
  });

  load(); loadService(); render(); route(false);
})();
