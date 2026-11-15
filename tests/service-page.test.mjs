// Tests de la logique du bouton « Programmer la charge » (site/service.js).
// Aucun réseau : fetch est simulé. Vérifie surtout qu'aucun faux succès n'est possible.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validerAdresse, validerJeton, choisirDemande, libelleBouton, consigneManuelle,
  interpreterReponse, envoyer, envoyerEtAfficher, resultatKo,
} from "../site/service.js";

const prog = { allumage: "00:35" };
const desact = { desactiver: true };
const okRep = { ok: true, debut: "00:35", fin: "06:00", plage_active: true };
const courteRep = { ok: true, debut: "05:59", fin: "06:00", plage_active: true, courte: true };

describe("Adresse du service", () => {
  test("acceptées", () => {
    assert.deepEqual(validerAdresse("https://recharge.mon-compte.workers.dev"), { ok: true, adresse: "https://recharge.mon-compte.workers.dev" });
    assert.equal(validerAdresse("  https://a.workers.dev/ ").adresse, "https://a.workers.dev");
    assert.equal(validerAdresse("HTTPS://A.Workers.dev").adresse, "https://a.workers.dev");
  });
  test("refusées", () => {
    for (const x of [
      "", "   ", "http://a.workers.dev", "a.workers.dev", "https://a.workers.dev/api", "https://a.workers.dev//",
      "https://a.workers.dev:8443", "https://u:p@a.workers.dev", "https://a.workers.dev?x=1", "https://a.workers.dev#x",
      "https://example.com", "https://workers.dev", "https://a.workers.dev.evil.com", "https://evil.com/.workers.dev",
      "https://a.workers.dev@evil.com", "https://-a.workers.dev", "javascript:alert(1)", "https://a b.workers.dev",
    ]) assert.equal(validerAdresse(x).ok, false, x);
  });
});

describe("Jeton", () => {
  test("accepté ou refusé", () => {
    assert.equal(validerJeton(" abc-DEF_123 ").jeton, "abc-DEF_123");
    for (const x of ["", "  ", "a b", "é", "a\nb", null, undefined]) assert.equal(validerJeton(x).ok, false, String(x));
  });
});

describe("Choix de la demande", () => {
  test("aucune charge -> désactiver", () => assert.deepEqual(choisirDemande("none", null), desact));
  test("charge -> allumage", () => {
    assert.deepEqual(choisirDemande("ok", "00:35"), prog);
    assert.deepEqual(choisirDemande("short", "21:10"), { allumage: "21:10" });
  });
  test("heure invalide ou statut inconnu -> rien", () => {
    assert.equal(choisirDemande("ok", "0:35"), null);
    assert.equal(choisirDemande("ok", null), null);
    assert.equal(choisirDemande("err", "00:35"), null);
  });
  test("libellés", () => {
    assert.deepEqual(libelleBouton(prog), { principal: "Programmer la charge", secondaire: "démarrage 00:35" });
    assert.equal(libelleBouton(desact).principal, "Pas de charge ce soir");
  });
});

describe("Interprétation : OK seulement si tout est conforme", () => {
  test("200, ok, debut identique", () => {
    const r = interpreterReponse(prog, 200, okRep);
    assert.equal(r.etat, "ok");
    assert.equal(r.message, "Charge programmée : démarrage 00:35");
    assert.match(r.detail, /06:00/);
  });
  test("200 mais debut différent -> KO", () => {
    const r = interpreterReponse(prog, 200, { ...okRep, debut: "00:40" });
    assert.equal(r.etat, "ko");
    assert.equal(r.code, "relecture_differente");
    assert.match(r.manuel, /00:35/);
    assert.match(r.verifier, /Smart Life/);
  });
  test("ok:true sans debut -> KO", () => {
    const { debut, ...sans } = okRep;
    assert.equal(interpreterReponse(prog, 200, sans).etat, "ko");
    assert.equal(interpreterReponse(prog, 200, { ...okRep, debut: 35 }).etat, "ko");
    assert.equal(interpreterReponse(prog, 200, { ...okRep, debut: "0:35" }).etat, "ko");
  });
  test("plage non active -> KO", () => {
    assert.equal(interpreterReponse(prog, 200, { ...okRep, plage_active: false }).etat, "ko");
    const { plage_active, ...sans } = okRep;
    assert.equal(interpreterReponse(prog, 200, sans).etat, "ko");
  });
  test("ok truthy mais pas true -> KO", () => {
    assert.equal(interpreterReponse(prog, 200, { ...okRep, ok: "true" }).etat, "ko");
    assert.equal(interpreterReponse(prog, 200, { ...okRep, ok: 1 }).etat, "ko");
  });
  test("ok:true mais statut HTTP différent de 200 -> KO", () => {
    assert.equal(interpreterReponse(prog, 201, okRep).etat, "ko");
    assert.equal(interpreterReponse(prog, 502, okRep).etat, "ko");
  });
  test("démarrage immédiat", () => {
    const r = interpreterReponse(prog, 200, { ...okRep, debut: "23:58", immediat: true });
    assert.equal(r.etat, "ok");
    assert.match(r.message, /Démarrage immédiat : l'heure calculée était passée/);
    assert.match(r.detail, /23:58/);
  });
  test("immédiat sans heure relue valide -> KO", () => {
    assert.equal(interpreterReponse(prog, 200, { ...okRep, debut: undefined, immediat: true }).etat, "ko");
  });
  test("immédiat truthy mais pas true : on exige l'égalité", () => {
    assert.equal(interpreterReponse(prog, 200, { ...okRep, debut: "23:58", immediat: "oui" }).etat, "ko");
  });
  test("plage courte : OK avec les heures relues", () => {
    const r = interpreterReponse(desact, 200, courteRep);
    assert.equal(r.etat, "ok");
    assert.equal(r.message, "Pas de charge cette nuit : plage réduite à une minute (05:59–06:00), inutile de brancher.");
    assert.equal(interpreterReponse(desact, 200, { ...courteRep, debut: "23:59", fin: "00:00" }).etat, "ok");
  });
  test("plage courte : KO si courte absent, plage inactive ou début incohérent", () => {
    const { courte, ...sansCourte } = courteRep;
    for (const rep of [
      sansCourte, { ...courteRep, courte: false }, { ...courteRep, courte: "true" },
      { ...courteRep, plage_active: false }, { ...courteRep, debut: "05:58" }, { ...courteRep, debut: "06:00" },
      { ...courteRep, debut: "5:59" }, { ...courteRep, fin: undefined }, { ...courteRep, debut: undefined },
      { ok: true, debut: "22:00", fin: "06:00", plage_active: false, charge_active: false },
    ]) {
      const r = interpreterReponse(desact, 200, rep);
      assert.equal(r.etat, "ko", JSON.stringify(rep));
      assert.equal(r.code, "relecture_differente");
    }
  });
  test("avertissement si la fin relue diffère de la fin des heures creuses, sans KO", () => {
    const r = interpreterReponse(prog, 200, okRep, "07:00");
    assert.equal(r.etat, "ok");
    assert.match(r.avertissement, /fin de plage du câble \(06:00\) ne correspond pas à la fin des heures creuses \(07:00\) : vérifiez dans Smart Life/);
    const c = interpreterReponse(desact, 200, courteRep, "07:00");
    assert.equal(c.etat, "ok");
    assert.match(c.avertissement, /\(06:00\).*\(07:00\)/);
  });
  test("pas d'avertissement si la fin correspond ou si la fin des Paramètres est inconnue", () => {
    assert.equal(interpreterReponse(prog, 200, okRep, "06:00").avertissement, undefined);
    assert.equal(interpreterReponse(desact, 200, courteRep, "06:00").avertissement, undefined);
    assert.equal(interpreterReponse(prog, 200, okRep).avertissement, undefined);
  });
});

describe("Interprétation : causes en clair", () => {
  const cas = [
    [401, { ok: false, erreur: "non_autorise" }, "non_autorise", /Jeton refusé.*Paramètres/, false],
    [429, { ok: false, erreur: "trop_de_requetes" }, "trop_de_requetes", /Trop de requêtes/, false],
    [502, { ok: false, erreur: "hors_ligne" }, "hors_ligne", /hors ligne/, true],
    [502, { ok: false, erreur: "jeton" }, "jeton", /Tuya/, true],
    [502, { ok: false, erreur: "tuya" }, "tuya", /Tuya/, true],
    [504, { ok: false, erreur: "delai" }, "delai", /pas répondu/, true],
    [502, { ok: false, erreur: "relecture_differente" }, "relecture_differente", /pas la valeur demandée/, true],
    [501, { ok: false, erreur: "non_disponible" }, "inattendue", /Réponse inattendue/, true],
    [400, { ok: false, erreur: "requete_invalide" }, "requete_invalide", /refusé/, false],
  ];
  for (const [status, json, code, re, incertain] of cas) {
    test(code, () => {
      for (const demande of [prog, desact]) {
        const r = interpreterReponse(demande, status, json);
        assert.equal(r.etat, "ko");
        assert.equal(r.code, code);
        assert.match(r.message, re);
        assert.match(r.manuel, /Smart Life/);
        assert.equal(r.incertain, incertain);
        assert.equal(/Vérifiez dans Smart Life/.test(r.verifier ?? ""), incertain);
      }
    });
  }
  test("l'heure à régler à la main est celle demandée", () => {
    assert.match(interpreterReponse(prog, 401, { ok: false, erreur: "non_autorise" }).manuel, /début 00:35/);
    const m = interpreterReponse(desact, 502, { ok: false, erreur: "tuya" }, "06:00").manuel;
    assert.match(m, /début de la plage à une minute avant la fin des heures creuses \(05:59\)/);
    assert.match(m, /ne branchez pas la voiture/);
    assert.ok(!/désactiver/i.test(m));
    assert.match(consigneManuelle(desact, "00:00"), /\(23:59\)/);
    assert.match(consigneManuelle(desact, "07:30"), /\(07:29\)/);
  });
  test("code HTTP seul sans erreur reconnue", () => {
    assert.equal(interpreterReponse(prog, 401, { ok: false }).code, "non_autorise");
    assert.equal(interpreterReponse(prog, 429, { ok: false }).code, "trop_de_requetes");
    assert.equal(interpreterReponse(prog, 501, { ok: false, erreur: "autre" }).code, "inattendue");
    assert.equal(interpreterReponse(desact, 501, { ok: false }).code, "inattendue");
    assert.equal(interpreterReponse(prog, 500, { ok: false, erreur: "inconnue" }).code, "inattendue");
  });
  test("réponse illisible ou de forme inattendue", () => {
    assert.equal(interpreterReponse(prog, 200, undefined).code, "illisible");
    assert.equal(interpreterReponse(prog, 200, null).code, "illisible");
    assert.equal(interpreterReponse(prog, 200, []).code, "illisible");
    assert.equal(interpreterReponse(prog, 200, "ok").code, "illisible");
    assert.equal(interpreterReponse(prog, 200, undefined).incertain, true);
    assert.equal(interpreterReponse(prog, 401, undefined).code, "non_autorise");
    assert.equal(interpreterReponse(prog, 200, {}).etat, "ko");
  });
  test("code d'erreur inconnu pour resultatKo", () => assert.equal(resultatKo(prog, "zzz").code, "inattendue"));
  test("consigne manuelle", () => assert.match(consigneManuelle(prog), /00:35/));
});

describe("Envoi (fetch simulé)", () => {
  const reponse = (status, corps) => ({ status, text: async () => (typeof corps === "string" ? corps : JSON.stringify(corps)) });

  test("requête conforme au contrat", async () => {
    let vu;
    const r = await envoyer("https://a.workers.dev/", "tok-123", prog, { onLine: true, fetch: async (url, init) => { vu = { url, init }; return reponse(200, okRep); } });
    assert.equal(r.etat, "ok");
    assert.equal(vu.url, "https://a.workers.dev/api/programmer");
    assert.equal(vu.init.method, "POST");
    assert.equal(vu.init.headers.Authorization, "Bearer tok-123");
    assert.equal(vu.init.headers["Content-Type"], "application/json");
    assert.equal(vu.init.body, '{"allumage":"00:35"}');
    assert.equal(vu.init.credentials, "omit");
    assert.equal(vu.init.redirect, "error");
    assert.ok(!vu.url.includes("tok-123"));
  });
  test("corps de désactivation", async () => {
    let corps;
    await envoyer("https://a.workers.dev", "t", desact, { onLine: true, fetch: async (u, i) => { corps = i.body; return reponse(200, courteRep); } });
    assert.equal(corps, '{"desactiver":true}');
  });
  test("hors ligne : KO immédiat, aucun appel", async () => {
    let appels = 0;
    const r = await envoyer("https://a.workers.dev", "t", prog, { onLine: false, fetch: async () => { appels++; return reponse(200, okRep); } });
    assert.equal(appels, 0);
    assert.equal(r.etat, "ko");
    assert.equal(r.code, "hors_ligne_navigateur");
    assert.match(r.manuel, /00:35/);
  });
  test("réseau en échec : service injoignable", async () => {
    const r = await envoyer("https://a.workers.dev", "t", prog, { onLine: true, fetch: async () => { throw new TypeError("Failed to fetch"); } });
    assert.equal(r.etat, "ko");
    assert.equal(r.code, "injoignable");
    assert.match(r.verifier, /Smart Life/);
  });
  test("délai dépassé (AbortController)", async () => {
    const r = await envoyer("https://a.workers.dev", "t", prog, {
      onLine: true, delaiMs: 20,
      fetch: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("abort"), { name: "AbortError" })))),
    });
    assert.equal(r.etat, "ko");
    assert.equal(r.code, "delai_page");
    assert.match(r.message, /25 secondes/);
    assert.match(r.verifier, /Smart Life/);
  });
  test("corps non JSON", async () => {
    const r = await envoyer("https://a.workers.dev", "t", prog, { onLine: true, fetch: async () => reponse(200, "<html>") });
    assert.equal(r.code, "illisible");
  });
  test("200 mais valeur relue différente", async () => {
    const r = await envoyer("https://a.workers.dev", "t", prog, { onLine: true, fetch: async () => reponse(200, { ...okRep, debut: "01:00" }) });
    assert.equal(r.etat, "ko");
  });
  test("adresse ou jeton invalides : rien n'est envoyé", async () => {
    let appels = 0;
    const f = async () => { appels++; return reponse(200, okRep); };
    assert.equal((await envoyer("http://a.workers.dev", "t", prog, { onLine: true, fetch: f })).etat, "ko");
    assert.equal((await envoyer("https://a.workers.dev", "", prog, { onLine: true, fetch: f })).etat, "ko");
    assert.equal((await envoyer("https://a.workers.dev", "t", null, { onLine: true, fetch: f })).etat, "ko");
    assert.equal(appels, 0);
  });
  test("le jeton n'apparaît dans aucun message", async () => {
    const r = await envoyer("https://a.workers.dev", "SECRET-XYZ", prog, { onLine: true, fetch: async () => reponse(401, { ok: false, erreur: "non_autorise" }) });
    assert.ok(!JSON.stringify(r).includes("SECRET-XYZ"));
  });
  test("redirection refusée (fetch lève) : KO service injoignable", async () => {
    const r = await envoyer("https://a.workers.dev", "t", prog, { onLine: true, fetch: async (u, init) => { if (init.redirect === "error") throw new TypeError("redirect"); return reponse(200, okRep); } });
    assert.equal(r.etat, "ko");
    assert.equal(r.code, "injoignable");
  });
});

describe("Envoi et affichage : jamais d'échec silencieux", () => {
  const reponse = (status, corps) => ({ status, text: async () => JSON.stringify(corps) });
  test("affichage qui lève : un KO générique avec l'heure à la main est tenté, sans exception", async () => {
    const vus = [];
    await envoyerEtAfficher("https://a.workers.dev", "t", prog, (res) => { vus.push(res); if (vus.length === 1) throw new Error("DOM"); }, { onLine: true, fetch: async () => reponse(200, okRep) });
    assert.equal(vus.length, 2);
    assert.equal(vus[1].etat, "ko");
    assert.match(vus[1].manuel, /00:35/);
  });
  test("affichage qui lève toujours : la promesse se résout quand même (bouton libéré)", async () => {
    await envoyerEtAfficher("https://a.workers.dev", "t", prog, () => { throw new Error("DOM"); }, { onLine: true, fetch: async () => reponse(200, okRep) });
  });
  test("résultat transmis tel quel à l'affichage", async () => {
    let vu;
    await envoyerEtAfficher("https://a.workers.dev", "t", prog, (r) => { vu = r; }, { onLine: true, fetch: async () => reponse(200, okRep) });
    assert.equal(vu.etat, "ok");
  });
});

describe("Page : enregistrement du jeton et accessibilité (contrôle du source)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  test("le jeton n'est enregistré que dans le gestionnaire change, après validation", () => {
    const iChange = app.indexOf('$("svcTok").addEventListener("change"');
    const avant = app.slice(app.indexOf('$("svcTok").addEventListener("input"'), iChange);
    const apres = app.slice(iChange);
    assert.ok(!/lsSet\(/.test(avant), "pas d'enregistrement à la frappe");
    assert.match(apres, /if \(v\.ok\) \{[^}]*lsSet\(KEY_TOK/s);
  });
  test("conteneurs d'alerte permanents, rôles posés dans le HTML", () => {
    assert.match(html, /id="sendOk"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /id="sendKo"[^>]*role="alert"[^>]*aria-live="assertive"/);
    assert.ok(!/setAttribute\("role"/.test(app));
  });
});

describe("Critères 2c : alerte KO distincte, aide hors ligne, avertissement affiché (contrôle du source)", async () => {
  const { readFileSync } = await import("node:fs");
  const lire = (f) => readFileSync(new URL("../site/" + f, import.meta.url), "utf8");
  const app = lire("app.js"), html = lire("index.html"), sw = lire("sw.js");

  test("service coupé, jeton faux, câble hors ligne : trois messages distincts, heure manuelle rappelée", () => {
    const sCoupe = envoyer("https://a.workers.dev", "t", prog, { onLine: true, fetch: async () => { throw new TypeError("Failed to fetch"); } });
    return sCoupe.then((coupe) => {
      const faux = interpreterReponse(prog, 401, { ok: false, erreur: "non_autorise" });
      const horsLigne = interpreterReponse(prog, 502, { ok: false, erreur: "hors_ligne" });
      const msgs = [coupe, faux, horsLigne].map((r) => r.message);
      assert.equal(new Set(msgs).size, 3);
      assert.deepEqual([coupe.code, faux.code, horsLigne.code], ["injoignable", "non_autorise", "hors_ligne"]);
      for (const r of [coupe, faux, horsLigne]) { assert.equal(r.etat, "ko"); assert.match(r.manuel, /00:35/); }
    });
  });
  test("tous les messages d'erreur sont distincts deux à deux", () => {
    const codes = ["non_autorise", "trop_de_requetes", "hors_ligne", "jeton", "tuya", "delai", "relecture_differente", "requete_invalide", "hors_ligne_navigateur", "injoignable", "delai_page", "illisible", "inattendue"];
    const msgs = codes.map((c) => resultatKo(prog, c).message);
    assert.equal(new Set(msgs).size, codes.length);
  });
  test("l'alerte KO affichée contient le message, l'heure manuelle et un lien vers #aide", () => {
    const ko = app.slice(app.indexOf("} else {", app.indexOf("function showAlert")), app.indexOf("alertKey = JSON.stringify(d)"));
    assert.match(ko, /res\.message/);
    assert.match(ko, /res\.manuel/);
    assert.match(ko, /navLink\([^)]*"#aide"/);
  });
  test("l'avertissement de fin de plage est affiché dans l'alerte OK, et la fin des Paramètres est transmise", () => {
    assert.match(app, /if \(res\.avertissement\) a\.appendChild/);
    assert.match(app, /finHC: fmt\(hm\(cur\.hcEnd\)\)/);
  });
  test("l'Aide est dans la page mise en cache : vue #aide dans index.html, index.html et app.js dans le précache", () => {
    assert.match(html, /id="v-aide"/);
    const pre = sw.slice(sw.indexOf("const PRECACHE"), sw.indexOf("];", sw.indexOf("const PRECACHE")));
    for (const f of ["./", "./index.html", "./app.js", "./service.js", "./style.css", "./calc.js"]) assert.ok(pre.includes(`"${f}"`), f);
  });
  test("le service worker ne touche jamais aux requêtes vers le service (POST ou autre origine)", () => {
    assert.match(sw, /request\.method !== "GET"\) return/);
    assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
  });
});
