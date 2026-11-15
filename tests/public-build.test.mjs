// Tests de la construction du site public (phase 3a, lot S1).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { construire, SORTIE_PAR_DEFAUT } from "../tools/build-public.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(readFileSync(join(RACINE, "tests", "golden-cases.json"), "utf8"));
const temporaires = [];
const envNeutre = { ...process.env }; delete envNeutre.PUBLIC_INDEXABLE; delete envNeutre.PUBLIC_ORIGINE;

function tmp() { const d = mkdtempSync(join(tmpdir(), "public-build-")); temporaires.push(d); return d; }
function empreintes(d) {
  const out = {};
  (function parcourir(c) {
    for (const n of readdirSync(c).sort()) {
      const p = join(c, n);
      if (statSync(p).isDirectory()) parcourir(p); else out[p.slice(d.length).split(sep).join("/")] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  })(d);
  return out;
}
const lire = (d, f) => readFileSync(join(d, f), "utf8");

let dirA;
before(() => { dirA = tmp(); construire({ sortie: dirA, env: envNeutre }); });
process.on("exit", () => { for (const d of temporaires) rmSync(d, { recursive: true, force: true }); });

const pagesHtml = () => readdirSync(dirA).filter((f) => f.endsWith(".html"));

test("construction déterministe : deux constructions donnent les mêmes fichiers", () => {
  const dirB = tmp();
  construire({ sortie: dirB, env: envNeutre });
  assert.deepEqual(empreintes(dirB), empreintes(dirA));
});

test("la commande écrit dist/public deux fois de suite à l'identique", () => {
  const lancer = () => execFileSync(process.execPath, [join(RACINE, "tools", "build-public.mjs")], { cwd: RACINE, env: envNeutre, encoding: "utf8" });
  lancer(); const a = empreintes(SORTIE_PAR_DEFAUT);
  lancer(); const b = empreintes(SORTIE_PAR_DEFAUT);
  assert.deepEqual(b, a);
  assert.ok(a["/index.html"] && a["/404.html"] && a["/robots.txt"] && a["/sitemap.xml"]);
  assert.deepEqual(a, empreintes(dirA));
});

test("la construction refuse de vider un dossier étranger", () => {
  const d = tmp(); writeFileSync(join(d, "precieux.txt"), "x");
  assert.throws(() => construire({ sortie: d, env: envNeutre }), /Refus de vider/);
  assert.ok(existsSync(join(d, "precieux.txt")));
});

test("calc.js, vehicules.js et vehicules.json sont identiques à ceux de site/", () => {
  for (const f of ["calc.js", "vehicules.js", "vehicules.json"]) {
    assert.ok(readFileSync(join(RACINE, "site", f)).equals(readFileSync(join(dirA, f))), f);
  }
});

test("aucun fichier de site/ n'est modifié", () => {
  // Indexé, non indexé ou nouveau : git status voit les trois (git diff seul ne voit pas l'index).
  const sortie = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "site/"], { cwd: RACINE, encoding: "utf8" });
  assert.equal(sortie.trim(), "");
});

test("les cas de golden-cases.json sont reproduits par le calc.js copié", async () => {
  const { plan, fmt } = await import(pathToFileURL(join(dirA, "calc.js")).href);
  const { energie_kwh: tolKwh, cout_eur: tolEur } = golden._tolerances;
  for (const c of golden.cas) {
    const r = plan({ ...c.entree });
    const charge = r.status === "ok" || r.status === "short";
    const got = {
      statut: r.status, allumage: charge ? fmt(r.start) : null, extinction: charge ? fmt(r.end) : null,
      duree_min: r.chargeMin, hors_hc_min: r.offMin, batterie_estimee_pct: Math.round(r.arrival),
      energie_kwh: r.kwh, cout_eur: r.cost, preconditionnement: fmt(r.preS) + "-" + fmt(r.dep),
    };
    for (const [k, v] of Object.entries(c.attendu)) {
      if (k === "energie_kwh") assert.ok(Math.abs(got[k] - v) <= tolKwh + 1e-9, `${c.nom} ${k}`);
      else if (k === "cout_eur") assert.ok(Math.abs(got[k] - v) <= tolEur + 1e-9, `${c.nom} ${k}`);
      else assert.equal(got[k], v, `${c.nom} ${k}`);
    }
  }
});

test("chaque page : un seul h1, titre et description uniques, canonique sans paramètres, balises de partage, lang fr", () => {
  const titres = new Set(), descs = new Set();
  const pages = pagesHtml();
  assert.ok(pages.includes("index.html") && pages.includes("404.html"));
  for (const f of pages) {
    const h = lire(dirA, f);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, f);
    assert.match(h, /<html lang="fr">/);
    const titre = /<title>([^<]+)<\/title>/.exec(h)[1];
    const desc = /<meta name="description" content="([^"]+)"/.exec(h)[1];
    assert.ok(!titres.has(titre) && !descs.has(desc), `doublon ${f}`);
    titres.add(titre); descs.add(desc);
    const can = /<link rel="canonical" href="([^"]+)"/.exec(h)[1];
    assert.ok(!/[?#]/.test(can), can);
    assert.ok(can.startsWith("https://exemple.invalid/"));
    for (const p of ["og:title", "og:description", "og:image", "og:url"]) assert.match(h, new RegExp(`<meta property="${p}" content="[^"]+"`), `${f} ${p}`);
    assert.match(h, /<meta name="twitter:card"/);
  }
});

test("liens et ressources internes aboutissent", () => {
  for (const f of pagesHtml()) {
    const h = lire(dirA, f);
    const cibles = [...h.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|#|mailto:)/.test(u));
    const baseUrl = f === "404.html" ? "/" : "/";
    for (const u of cibles) {
      const chemin = new URL(u, "http://local" + baseUrl).pathname;
      const fichier = chemin.endsWith("/") ? chemin + "index.html" : chemin;
      assert.ok(existsSync(join(dirA, fichier)), `${f} -> ${u}`);
    }
  }
  const ancres = [...lire(dirA, "index.html").matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  for (const a of ancres) assert.ok(lire(dirA, "index.html").includes(`id="${a}"`), `ancre #${a}`);
  assert.ok(existsSync(join(dirA, "app", "partage.svg")));
});

test("le plan du site liste les pages indexables existantes", () => {
  const s = lire(dirA, "sitemap.xml");
  assert.match(s, /<loc>https:\/\/exemple\.invalid\/<\/loc>/);
  assert.ok(!s.includes("404"));
});

test("aucune ressource externe, ni workers.dev, ni jeton, ni MyDS, ni matériel imposé", () => {
  const fichiers = ["index.html", "404.html", "app/app-public.js", "app/style.css", "robots.txt", "sitemap.xml"];
  for (const f of pagesHtml()) {
    const h = lire(dirA, f);
    for (const m of h.matchAll(/(?:src|href)="(https?:[^"]+)"/g)) {
      assert.ok(m[1].startsWith("https://exemple.invalid/") && /rel="canonical"/.test(h.slice(m.index - 30, m.index)), `${f} : ressource externe ${m[1]}`);
    }
    assert.ok(!/<style|\sstyle=|<script(?![^>]*\ssrc=)|\son\w+=/i.test(h), `${f} : style ou script en ligne`);
    assert.ok(!/@import|url\(\s*["']?https?:/.test(lire(dirA, "app/style.css")));
  }
  for (const f of fichiers) {
    const t = lire(dirA, f);
    assert.ok(!/workers\.dev/i.test(t), `${f} workers.dev`);
    assert.ok(!/jeton|token/i.test(t), `${f} jeton`);
    assert.ok(!/MyDS|Smart ?Life|DS ?3|la prise/i.test(t), `${f} vocabulaire imposé`);
  }
  assert.ok(!/<input[^>]+type="password"/.test(lire(dirA, "index.html")));
});

test("la CSP est celle du cahier des charges", () => {
  for (const f of pagesHtml()) {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(lire(dirA, f))[1];
    assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
  }
});

test("sans PUBLIC_INDEXABLE : noindex partout et robots.txt interdit tout ; avec : indexable sauf 404", () => {
  for (const f of pagesHtml()) assert.match(lire(dirA, f), /<meta name="robots" content="noindex">/);
  assert.match(lire(dirA, "robots.txt"), /Disallow: \//);
  const d = tmp();
  construire({ sortie: d, env: { PUBLIC_INDEXABLE: "1", PUBLIC_ORIGINE: "https://exemple.org/" } });
  assert.ok(!/noindex/.test(lire(d, "index.html")));
  assert.match(lire(d, "404.html"), /noindex/);
  assert.match(lire(d, "index.html"), /href="https:\/\/exemple\.org\/"/);
  assert.match(lire(d, "robots.txt"), /Sitemap: https:\/\/exemple\.org\/sitemap\.xml/);
  assert.throws(() => construire({ sortie: tmp(), env: { PUBLIC_ORIGINE: "ftp://x/y" } }), /PUBLIC_ORIGINE/);
});

test("prix vides : aucun prix inventé dans la page, rappel de la facture présent", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /data-phc="" data-php=""/);
  assert.match(h, /figurent sur votre facture/);
  const t = JSON.parse(readFileSync(join(RACINE, "public", "donnees", "tarifs.json"), "utf8"));
  assert.equal(t.hc, null); assert.equal(t.hp, null); assert.equal(t.source, null); assert.equal(t.date, null);
});

test("les emplacements des lots suivants sont prévus et les champs ont un libellé", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /emplacement S2/);
  for (const id of [...h.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1])) assert.match(h, new RegExp(`<label for="${id}"`), id);
  assert.ok(statSync(join(dirA, "index.html")).size + statSync(join(dirA, "app", "app-public.js")).size + statSync(join(dirA, "app", "style.css")).size + statSync(join(dirA, "calc.js")).size < 150000);
});
