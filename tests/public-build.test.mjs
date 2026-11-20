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

import { cpSync } from "node:fs";
// Copie de public/ dont les marqueurs « [À SOURCER … ] » et « [À COMPLÉTER … ] » sont remplacés par un texte neutre.
function sansMarqueurs(modif) {
  const src = tmp(); cpSync(join(RACINE, "public"), src, { recursive: true });
  for (const f of readdirSync(join(src, "contenu"))) {
    const c = join(src, "contenu", f);
    writeFileSync(c, readFileSync(c, "utf8").replace(/\[À (?:SOURCER|COMPLÉTER)[^\]]*\]/g, "Texte vérifié."));
  }
  if (modif) modif(src);
  return src;
}

let dirA;
before(() => { dirA = tmp(); construire({ sortie: dirA, env: envNeutre }); });
process.on("exit", () => { for (const d of temporaires) rmSync(d, { recursive: true, force: true }); });

// Toutes les pages HTML, y compris celles des sous-dossiers (chemins relatifs à la racine, avec « / »).
function listerHtml(d) {
  const out = [];
  (function parcourir(c) {
    for (const n of readdirSync(c).sort()) {
      const p = join(c, n);
      if (statSync(p).isDirectory()) parcourir(p); else if (n.endsWith(".html")) out.push(p.slice(d.length + 1).split(sep).join("/"));
    }
  })(d);
  return out;
}
const pagesHtml = () => listerHtml(dirA);

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

test("aucun fichier de site/ n'est modifié", (t) => {
  // Indexé, non indexé ou nouveau : git status voit les trois (git diff seul ne voit pas l'index).
  // Contrôle de développement : sans git utilisable (machine de construction), il est ignoré au lieu de bloquer la publication.
  let sortie;
  try { sortie = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "site/"], { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { t.skip(`git status indisponible ici (${String(e.message).split("\n")[0]})`); return; }
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
    const baseUrl = f === "404.html" ? "/" : "/" + f.replace(/index\.html$/, "");
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

test("le plan du site liste toutes les pages indexables, et seulement elles", () => {
  const s = lire(dirA, "sitemap.xml");
  assert.match(s, /<loc>https:\/\/exemple\.invalid\/<\/loc>/);
  assert.ok(!s.includes("404"));
  const locs = [...s.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const attendu = pagesHtml().filter((f) => f !== "404.html").map((f) => "https://exemple.invalid/" + f.replace(/index\.html$/, "")).sort();
  assert.deepEqual(locs, attendu);
});

// Adresses qui sortent du site ou exécutent du code, hors liens suivis admis : <a href="https://…" rel="noopener">
// (source lue) ou rel="sponsored nofollow noopener" (partenaire déclaré), et le lien canonique. Toute autre adresse
// absolue (schéma quelconque ou //), tout attribut qui charge ou envoie (src, action, data, poster, srcset, formaction)
// et tout meta refresh sont refusés, quelle que soit la casse ou le guillemet.
function sortiesInterdites(h) {
  const reste = h
    .replace(/<a(?: class="[^"]*")? href="https:\/\/[^"\s<>]+" rel="(?:sponsored nofollow )?noopener">/g, "<a>")
    .replace(/<link rel="canonical" href="https:\/\/exemple\.invalid\/[^"\s<>]*">/g, "");
  const trouves = [...reste.matchAll(/\b(?:src|href|action|data|poster|srcset|formaction)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)[^"'\s>]*/gi)].map((m) => m[0]);
  if (/http-equiv\s*=\s*["']?refresh/i.test(reste)) trouves.push("meta refresh");
  return trouves;
}

test("le contrôle des sorties refuse les variantes dangereuses et admet les liens suivis déclarés", () => {
  for (const mauvais of [
    '<a href="http://x.fr" rel="noopener">', '<a href="https://x.fr" rel="noopener" target="_blank">',
    '<a href="https://x.fr" href="https://y.fr" rel="noopener">', '<a href="javascript:alert(1)">', "<a HREF='HTTPS://x.fr'>",
    '<img src="//x.fr/y.png">', '<form action="https://x.fr">', '<meta http-equiv="refresh" content="0;url=https://x.fr">',
    '<link rel="canonical" href="https://autre.fr/">', '<a href="mailto:a@b.fr">',
  ]) assert.ok(sortiesInterdites(mauvais).length, mauvais);
  for (const bon of ['<a href="https://x.fr/a" rel="noopener">', '<a class="bouton" href="https://x.fr" rel="sponsored nofollow noopener">', '<a href="../guides/">', '<link rel="canonical" href="https://exemple.invalid/guides/">'])
    assert.deepEqual(sortiesInterdites(bon), [], bon);
});

test("aucune ressource externe, ni workers.dev, ni jeton, ni MyDS, ni matériel imposé", () => {
  const fichiers = [...pagesHtml(), "app/app-public.js", "app/style.css", "robots.txt", "sitemap.xml"];
  for (const f of pagesHtml()) {
    const h = lire(dirA, f);
    assert.deepEqual(sortiesInterdites(h), [], `${f} : adresse externe ou active`);
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
  // Les marqueurs « [À SOURCER » et « [À COMPLÉTER » bloquent l'indexation : on les retire d'une copie des contenus.
  construire({ sortie: d, env: { PUBLIC_INDEXABLE: "1", PUBLIC_ORIGINE: "https://exemple.org/" }, source: sansMarqueurs() });
  assert.ok(!/noindex/.test(lire(d, "index.html")));
  assert.match(lire(d, "404.html"), /noindex/);
  assert.match(lire(d, "index.html"), /href="https:\/\/exemple\.org\/"/);
  assert.match(lire(d, "robots.txt"), /Sitemap: https:\/\/exemple\.org\/sitemap\.xml/);
  assert.throws(() => construire({ sortie: tmp(), env: { PUBLIC_ORIGINE: "ftp://x/y" } }), /PUBLIC_ORIGINE/);
  assert.ok(!/X-Robots-Tag/.test(lire(d, "_headers")), "site indexable : pas de X-Robots-Tag");
});

test("_headers (Cloudflare Pages) : même CSP que la balise, plus frame-ancestors ; noindex hors mise en ligne indexable", () => {
  const h = lire(dirA, "_headers");
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(lire(dirA, "index.html"))[1];
  const lignes = h.split("\n");
  assert.equal(lignes[0], "/*");
  assert.ok(lignes.slice(1).filter(Boolean).every((l) => /^  [A-Za-z-]+: \S/.test(l) && l.length <= 2000), "syntaxe : en-têtes indentés, 2 000 caractères au plus");
  assert.ok(lignes.includes(`  Content-Security-Policy: ${csp}; frame-ancestors 'none'`));
  assert.ok(lignes.includes("  X-Content-Type-Options: nosniff"));
  assert.ok(lignes.includes("  X-Robots-Tag: noindex"));
});

test("prix par défaut : ceux de tarifs.json, avec leur source officielle, rappel de la facture présent", () => {
  const h = lire(dirA, "index.html");
  const t = JSON.parse(readFileSync(join(RACINE, "public", "donnees", "tarifs.json"), "utf8"));
  assert.match(h, /figurent sur votre facture/);
  if (t.hc === null) {
    assert.match(h, /data-phc="" data-php=""/);
    return;
  }
  const fr = (x) => String(x).replace(".", ",");
  assert.match(h, new RegExp(`data-phc="${fr(t.hc)}" data-php="${fr(t.hp)}"`));
  assert.ok(h.includes(`Prix par défaut : ${t.source}, lus le ${t.date}.`));
  // Source officielle et traçable : grille du fournisseur historique, CRE ou Journal officiel.
  assert.match(t.url, /^https:\/\/([a-z0-9-]+\.)*(edf\.fr|cre\.fr|legifrance\.gouv\.fr)\//);
  assert.match(t.applicable_le, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(t.hp > t.hc, "heures pleines plus chères que les heures creuses");
});

test("les emplacements des lots suivants sont prévus et les champs ont un libellé", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /emplacement S3|Comment lancez-vous la charge/);
  for (const id of [...h.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1])) assert.match(h, new RegExp(`<label for="${id}"`), id);
  assert.ok(statSync(join(dirA, "index.html")).size + statSync(join(dirA, "app", "app-public.js")).size + statSync(join(dirA, "app", "style.css")).size + statSync(join(dirA, "calc.js")).size < 150000);
});

// ---- Lot S2 : « Comment régler », liste d'attente, liens rémunérés
function avecOffres(modif) {
  const src = tmp(); cpSync(join(RACINE, "public"), src, { recursive: true });
  const f = join(src, "donnees", "offres.json");
  const o = JSON.parse(readFileSync(f, "utf8")); modif(o); writeFileSync(f, JSON.stringify(o));
  const sortie = tmp();
  return { src, sortie, construire: () => construire({ sortie, env: envNeutre, source: src }) };
}

test("Comment régler : question, quatre réponses, un encart par réponse, lus dans offres.json", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /Comment lancez-vous la charge \?/);
  const offres = JSON.parse(readFileSync(join(RACINE, "public", "donnees", "offres.json"), "utf8"));
  assert.equal(offres.reponses.length, 4);
  for (const r of offres.reponses) {
    assert.ok(h.includes(`value="${r.id}" data-encart="encart-${r.encart}"`), r.id);
    assert.match(h, new RegExp(`id="encart-${r.encart}" hidden`));
  }
  assert.ok(!/prise connectée.*(achet|recommand)/i.test(h));
});

test("encarts inactifs absents de la page ; l'activer les fait apparaître", () => {
  const h = lire(dirA, "index.html");
  const offres = JSON.parse(readFileSync(join(RACINE, "public", "donnees", "offres.json"), "utf8"));
  for (const id of ["reglage-automatique", "offres-electricite"]) {
    const e = offres.encarts.find((x) => x.id === id);
    assert.equal(e.actif, false);
    assert.ok(!h.includes(`encart-${id}`) && !h.includes(e.titre), id);
  }
  const t = avecOffres((o) => { o.encarts.find((x) => x.id === "reglage-automatique").actif = true; });
  t.construire();
  assert.ok(lire(t.sortie, "index.html").includes('id="encart-reglage-automatique"'));
});

test("liste d'attente : bouton absent si l'adresse est vide, présent sinon", () => {
  const h = lire(dirA, "index.html");
  assert.ok(!/liste d'attente|Vous voulez que ça se règle tout seul/.test(h));
  const t = avecOffres((o) => { o.liste_attente.url = "https://formulaire.exemple.eu/inscription"; });
  t.construire();
  const p = lire(t.sortie, "index.html");
  assert.match(p, /Vous voulez que ça se règle tout seul \?/);
  assert.match(p, /<a class="bouton" href="https:\/\/formulaire\.exemple\.eu\/inscription" rel="noopener">Ouvrir le formulaire de la liste d'attente<\/a>/);
});

test("lien rémunéré : rel et mention imposés par la construction ; lien vide non affiché", () => {
  assert.ok(!/sponsored|lien rémunéré/.test(lire(dirA, "index.html")), "adresse vide : aucun lien");
  const t = avecOffres((o) => { o.encarts.find((x) => x.id === "solutions").liens = [
    { texte: "Un câble", url: "https://partenaire.exemple.com/a?b=1&c=2", remunere: true },
    { texte: "Un guide", url: "https://exemple.org/guide", remunere: false },
  ]; });
  t.construire();
  const p = lire(t.sortie, "index.html");
  assert.match(p, /<a href="https:\/\/partenaire\.exemple\.com\/a\?b=1&amp;c=2" rel="sponsored nofollow noopener">Un câble<\/a> <span class="remunere">lien rémunéré<\/span>/);
  assert.match(p, /<a href="https:\/\/exemple\.org\/guide" rel="noopener">Un guide<\/a><\/p>/);
  assert.equal((p.match(/lien rémunéré/g) || []).length, 1);
});

test("offres.json invalide refusé par la construction", () => {
  const cas = [
    [(o) => { o.liste_attente.url = "http://pas-https.example"; }, /liste_attente/],
    [(o) => { o.liste_attente.url = "javascript:alert(1)"; }, /liste_attente/],
    [(o) => { o.encarts[0].liens = [{ texte: "x", url: "ftp://x", remunere: false }]; }, /adresse/],
    [(o) => { o.encarts[0].liens = [{ texte: "x", url: "", remunere: "oui" }]; }, /remunere/],
    [(o) => { o.encarts[0].actif = "non"; }, /actif/],
    [(o) => { o.reponses[0].encart = "inconnu"; }, /réponse invalide/],
    [(o) => { o.encarts.push({ ...o.encarts[0] }); }, /en double/],
    [(o) => { o.encarts[0].titre = ""; }, /titre/],
  ];
  for (const [modif, motif] of cas) assert.throws(() => avecOffres(modif).construire(), motif);
});

test("lien de partage : bouton présent, aucun champ de batterie dans le lien, canonique inchangée", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /id="copier-lien"/);
  assert.match(h, /id="zone-partage"[^>]* hidden/);
  assert.match(h, /rel="canonical" href="https:\/\/exemple\.invalid\/"/);
  assert.ok(!/<input[^>]+(?:readonly)[^>]*value=/.test(h));
  const js = lire(dirA, "app/app-public.js");
  const fn = js.slice(js.indexOf("export function lienPartage"), js.indexOf("export function lireLien"));
  assert.ok(!/soc|pHC|pHP/.test(fn), "lienPartage ne lit ni la batterie du soir ni les prix (le SOH, oui : même voiture en famille)");
});

test("accueil : limite des heures creuses, valeurs proposées, le site ne pilote rien", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /Une seule plage par nuit\. Si vos heures creuses sont en deux plages, indiquez celle de la nuit\./);
  assert.equal((h.match(/Valeurs proposées : vérifiez-les\./g) || []).length, 2);
  assert.match(h, /Choisissez le courant réglé sur votre câble ou votre borne/);
  assert.match(h, /Prise ordinaire, 10 A/);
  assert.match(h, /Prise renforcée ou câble réglé sur 16 A \(3,7 kW\)/);
  assert.ok(!/Prise classique/.test(h));
  assert.match(h, /value="16" checked/);
  assert.match(h, /Ce site calcule l'heure ; c'est vous qui la réglez\./);
});

test("accueil : question de lancement sans choix par défaut, encarts annoncés, solution sans achat", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /Choisissez votre cas pour voir quoi régler et où\./);
  assert.ok(!/name="lancement"[^>]*checked/.test(h));
  assert.match(h, /id="encarts-lancement" aria-live="polite"/);
  const rien = h.slice(h.indexOf('id="encart-solutions"'));
  assert.ok(rien.indexOf("Sans rien acheter") < rien.indexOf("Autre solution"));
  assert.ok(!/réponse précédente|affichée dans le résultat/.test(h));
  const diff = h.slice(h.indexOf('id="encart-charge-differee"'));
  assert.ok(diff.indexOf("Attention") < diff.indexOf("Entrez l'heure"));
});

test("accueil : bloc d'envoi des réglages masqué au départ, titres de partage renommés", () => {
  const h = lire(dirA, "index.html");
  assert.match(h, /id="zone-partage"[^>]*hidden/);
  assert.match(h, /Envoyer mes réglages à quelqu'un/);
  assert.match(h, /Ce que vous économisez/);
  assert.ok(!/Deux chiffres à partager|>Partager mes réglages</.test(h));
  assert.match(h, /id="etat-reglages"[^>]*role="status"/);
});
