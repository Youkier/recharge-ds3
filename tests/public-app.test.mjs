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

test("short : pas de surcoût négatif si le prix HP est inférieur au prix HC", () => {
  const entree = { ...avecPrix({ pHC: "0,20", pHP: "0,15" }), cap: "100", amp: "10", courant: "10" };
  const v = A.resultat(entree, "5");
  assert.equal(v.statut, "short");
  assert.ok(!v.lignes.some((l) => l[0] === "Surcoût du dépassement"));
});

test("nombres : notations exponentielle, hexadécimale et binaire refusées", () => {
  for (const s of ["1e1", "0x1A", "0b11", "16abc", "-16"]) {
    const v = A.resultat(sansPrix({ amp: s }), "38");
    assert.equal(v.statut, "err", `courant « ${s} » accepté`);
  }
  assert.equal(A.resultat(sansPrix({ amp: "15,5" }), "38").statut, "ok");
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

// ---- Lien de partage (lot S2)
const vehicules = async () => {
  const { lignesValides } = await import(pathToFileURL(join(d, "vehicules.js")).href);
  return lignesValides(JSON.parse((await import("node:fs")).readFileSync(join(d, "vehicules.json"), "utf8")));
};

test("lien de partage : aller-retour sans perte, batterie absente", async () => {
  const lignes = await vehicules();
  const m = lignes[0];
  const brut = { marque: m[0], modele: m[1], version: m[2], courant: "32", amp: "32", hcStart: "23:30", hcEnd: "07:00", dep: "08:15", target: "85", soc: "37", pHC: "0,15", pHP: "0,2", soh: "90" };
  const lien = A.lienPartage(brut, "https://exemple.org/chemin/");
  assert.ok(lien.startsWith("https://exemple.org/chemin/?"));
  assert.ok(!/[?&](soc|pHC|pHP)=/.test(lien));
  const lu = A.lireLien(lien.slice(lien.indexOf("?")), lignes);
  assert.deepEqual(lu, { marque: m[0], modele: m[1], version: m[2], courant: "32", hcStart: "23:30", hcEnd: "07:00", dep: "08:15", target: "85", soh: "90" });
  const autre = A.lienPartage({ marque: A.AUTRE, cap: "52,5", courant: "autre", amp: "12", hcStart: "01:00", hcEnd: "07:00", dep: "08:00", target: "80", soh: "92,5" }, "https://x.fr/");
  assert.deepEqual(A.lireLien(autre.split("?")[1], lignes), { marque: A.AUTRE, cap: "52.5", courant: "autre", amp: "12", hcStart: "01:00", hcEnd: "07:00", dep: "08:00", target: "80", soh: "92.5" });
  for (const mauvais of ["soh=0", "soh=101", "soh=abc", "soh=1e2", "soh=-5"]) assert.deepEqual(A.lireLien(mauvais, lignes), {}, mauvais);
});

test("lien de partage : la batterie du soir passée dans l'adresse est ignorée", async () => {
  const lu = A.lireLien("soc=40&batterie=40&courant=16", await vehicules());
  assert.deepEqual(lu, { courant: "16" });
});

test("lien de partage : paramètres invalides ou inconnus ignorés", async () => {
  const lignes = await vehicules();
  const mauvais = "marque=Inconnue&modele=X&courant=99&hcStart=25:00&hcEnd=6:00&dep=abc&target=150&zzz=1&amp=12";
  assert.deepEqual(A.lireLien(mauvais, lignes), {});
  assert.deepEqual(A.lireLien("marque=autre&cap=0", lignes), {});
  assert.deepEqual(A.lireLien("marque=autre&cap=1e2", lignes), {});
  assert.deepEqual(A.lireLien("courant=autre&amp=-3", lignes), {});
  assert.deepEqual(A.lireLien("target=0", lignes), {});
  assert.deepEqual(A.lireLien("", lignes), {});
  const m = lignes[0];
  assert.deepEqual(A.lireLien(new URLSearchParams({ marque: m[0], modele: "Modèle inexistant", version: m[2] }).toString(), lignes), { marque: m[0] });
  assert.deepEqual(A.lireLien(new URLSearchParams({ marque: m[0] }).toString(), null), {}, "sans liste, la voiture est ignorée");
});

test("message affiché quand un lien de partage est appliqué", () => {
  assert.equal(A.MESSAGE_LIEN, "Réglages du lien appliqués : vérifiez-les.");
});

test("résumé des réglages : valeurs réellement utilisées, sans DOM", () => {
  const lu = A.lireReglages({ ...base, target: "100", soh: "92", amp: "10", courant: "10", hcStart: "23:00", hcEnd: "07:00", dep: "08:15" }, "38");
  assert.equal(A.resumeReglages(lu.p), "Calculé avec : cible 100 %, SOH 92 %, 10 A, heures creuses 23:00–07:00, départ 08:15");
  assert.match(A.resultat(base, "38").resume, /^Calculé avec : cible 80 %, SOH 100 %, 16 A/);
  assert.equal(A.resultat(base, "").resume, "");
  assert.equal(A.resultat({ ...base, cap: "" }, "38").resume, "");
});

test("page : cible et SOH hors du bloc avancé, résumé et bouton présents", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(join(d, "index.html"), "utf8");
  const avance = html.slice(html.indexOf('<details id="avance"'), html.indexOf("</details>", html.indexOf('<details id="avance"')));
  for (const id of ["target", "soh"]) {
    assert.ok(html.includes('id="' + id + '"'), id + " présent");
    assert.ok(!avance.includes('id="' + id + '"'), id + " hors des paramètres avancés");
    assert.equal(html.split('id="' + id + '"').length, 2, id + " une seule fois");
  }
  assert.ok(html.indexOf('id="target"') > html.indexOf('id="titre-soir"'));
  assert.ok(html.includes('id="modifier-reglages"') && html.includes('id="calcule-avec"'));
});
