// Tests de la logique de l'interface publique (public/app/app-public.js), sans DOM.
// Le module importe ../calc.js et ../vehicules.js : on le charge depuis une construction temporaire.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { construire } from "../tools/build-public.mjs";

const d = mkdtempSync(join(tmpdir(), "public-app-"));
process.on("exit", () => rmSync(d, { recursive: true, force: true }));
let A;
before(async () => {
  const env = { ...process.env }; delete env.PUBLIC_INDEXABLE; delete env.PUBLIC_ORIGINE;
  construire({ sortie: d, env });
  A = await import(pathToFileURL(join(d, "app", "app-public.js")).href);
});

const base = { cap: "46", courant: "16", amp: "16" };
const sansPrix = (o = {}) => ({ ...base, ...o });
const avecPrix = (o = {}) => ({ ...base, pHC: "0,15", pHP: "0,20", ...o });

test("ok : heure de début, fin, durée, énergie ; pas de coût sans prix", () => {
  const v = A.resultat(sansPrix(), "38");
  assert.equal(v.statut, "ok");
  assert.match(v.titre, /^Démarrer la charge à \d\d:\d\d$/);
  assert.match(v.message, /Fin à 06:00/);
  const libs = v.lignes.map((l) => l[0]);
  assert.ok(libs.includes("Durée") && libs.includes("Énergie"));
  assert.ok(!libs.includes("Coût de la nuit"), "pas de coût sans prix");
  assert.equal(v.prixManquants, true);
  assert.equal(v.chiffres.economie, null);
  assert.equal(v.chiffres.nuits, 100);
});

test("ok avec prix : coût et économie annuelle affichés", () => {
  const v = A.resultat(avecPrix(), "38");
  assert.equal(v.prixManquants, false);
  assert.ok(v.lignes.some((l) => l[0] === "Coût de la nuit" && /€/.test(l[1])));
  assert.ok(v.chiffres.economie > 0);
  assert.match(A.texteChiffres(v.chiffres).join(" "), /Économie estimée/);
  assert.match(A.modeCalcul(v.chiffres), /100 recharges par an/);
});

test("none : pas de charge nécessaire", () => {
  const v = A.resultat(sansPrix(), "85");
  assert.equal(v.statut, "none");
  assert.match(v.titre, /Pas de charge nécessaire ce soir/);
  assert.equal(v.chiffres, null);
});

test("short : dit de combien la cible est manquée, et le surcoût avec prix", () => {
  const entree = { ...avecPrix(), cap: "100", amp: "10", courant: "10" };
  const v = A.resultat(entree, "5");
  assert.equal(v.statut, "short");
  assert.match(v.message, /il manquera environ \d+ %/);
  assert.ok(v.lignes.some((l) => l[0] === "Dont hors heures creuses"));
});

test("short sans manque : la cible est atteinte mais hors heures creuses", () => {
  const v = A.resultat(sansPrix({ cap: "60", amp: "16" }), "10");
  if (v.statut === "short") assert.match(v.message, /(il manquera environ \d+ %|avant vos heures creuses)/);
  else assert.equal(v.statut, "ok");
});

test("err : le champ fautif est désigné", () => {
  for (const [brut, soc, champ] of [
    [{ ...base, cap: "" }, "38", "cap"],
    [{ ...base, amp: "abc" }, "38", "amp"],
    [{ ...base, hcStart: "25:99" }, "38", "hcStart"],
    [{ ...base }, "150", "soc"],
    [{ ...base }, "", "soc"],
    [{ ...base, target: "0" }, "38", "target"],
    [{ ...base, pHC: "0,15" }, "38", "pHP"],
  ]) {
    const v = A.resultat(brut, soc);
    assert.equal(v.statut, "err", champ);
    assert.equal(v.champ, champ);
    assert.ok(v.message.length > 10);
  }
});

test("le rendement se déduit du courant (90 % à 16 A) et une saisie manuelle prime", () => {
  assert.equal(A.effAuto(16, 230), 90);
  assert.equal(A.lireReglages(sansPrix()).p.eff, 90);
  assert.equal(A.lireReglages(sansPrix({ eff: "80" })).p.eff, 80);
});

test("le résultat de la page reproduit le plan() du cas nominal à capacité et rendement égaux", async () => {
  const { plan } = await import(pathToFileURL(join(d, "calc.js")).href);
  const lu = A.lireReglages(sansPrix({ soh: "100" }), "38");
  const r = plan(lu.p);
  assert.equal(r.status, "ok");
  assert.equal(A.resultat(sansPrix(), "38").titre, "Démarrer la charge à " + (await import(pathToFileURL(join(d, "calc.js")).href)).fmt(r.start));
});

test("valeurs par défaut neutres et clé de stockage propre au site public", () => {
  assert.equal(A.DEFAUTS.target, "80"); assert.equal(A.DEFAUTS.soh, "100");
  assert.equal(A.DEFAUTS.hcStart, "22:00"); assert.equal(A.DEFAUTS.hcEnd, "06:00"); assert.equal(A.DEFAUTS.dep, "07:30");
  assert.equal(A.DEFAUTS.mode, "end");
  assert.notEqual(A.CLE, "recharge-ds3-v1");
  const p = A.lireReglages(sansPrix()).p;
  assert.equal(p.pre, 0); assert.equal(p.deduct, false);
});
