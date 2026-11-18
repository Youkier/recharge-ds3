// Tests des lots S3 (guides, pages fixes, navigation) et S4 (pages par modèle) du site public.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { construire } from "../tools/build-public.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envNeutre = { ...process.env }; delete envNeutre.PUBLIC_INDEXABLE; delete envNeutre.PUBLIC_ORIGINE;
const temporaires = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "public-pages-")); temporaires.push(d); return d; };
process.on("exit", () => { for (const d of temporaires) rmSync(d, { recursive: true, force: true }); });
const lire = (d, f) => readFileSync(join(d, f), "utf8");

let dirA, resultatA;
before(() => { dirA = tmp(); resultatA = construire({ sortie: dirA, env: envNeutre }); });

// Copie de public/ dont on modifie un fichier de données (offres.json ou modeles.json).
function avec(fichier, modif) {
  const src = tmp(); cpSync(join(RACINE, "public"), src, { recursive: true });
  const f = join(src, "donnees", fichier);
  const o = JSON.parse(readFileSync(f, "utf8")); modif(o); writeFileSync(f, JSON.stringify(o));
  const sortie = tmp();
  return { src, sortie, construire: (env = envNeutre) => construire({ sortie, env, source: src }) };
}

const SOURCE_OK = { url: "https://exemple.org/notice-208", lu_le: "2026-11-18", ce_que_dit_la_source: "Source de test : page fictive." };
const ENTREE_OK = {
  slug: "peugeot-e-208", marque: "Peugeot", modele: "e-208", limite_native: false, charge_differee: "debut_seul",
  sources: [SOURCE_OK], particularites: ["Paragraphe de test, propre à ce modèle fictif, sans valeur factuelle réelle."],
};
const avecModeles = (...entrees) => avec("modeles.json", (o) => { o.modeles = entrees; });

// ---------------------------------------------------------------- S3

const PAGES_S3 = ["guides/index.html", "guides/charge-differee-de-la-voiture/index.html", "guides/cable-ou-borne-programmable/index.html",
  "guides/pourquoi-80-pour-cent/index.html", "financement/index.html", "confidentialite/index.html", "mentions-legales/index.html"];

test("S3 : les pages prévues existent, avec un seul h1 et le plan du site les liste", () => {
  const plan = lire(dirA, "sitemap.xml");
  for (const f of PAGES_S3) {
    assert.ok(existsSync(join(dirA, f)), f);
    assert.equal((lire(dirA, f).match(/<h1[\s>]/g) || []).length, 1, f);
    assert.ok(plan.includes(`<loc>https://exemple.invalid/${f.replace("index.html", "")}</loc>`), f);
  }
});

test("S3 : navigation commune (Accueil, Guides, Financement) et pied de page sur chaque page", () => {
  for (const f of ["index.html", ...PAGES_S3, "404.html"]) {
    const h = lire(dirA, f);
    const nav = /<ul class="menu">([\s\S]*?)<\/ul>/.exec(h)[1];
    for (const t of ["Accueil", "Guides", "Financement"]) assert.match(nav, new RegExp(`>${t}</a>`), `${f} ${t}`);
    const pied = /<p class="liens-pied">([\s\S]*?)<\/p>/.exec(h)[1];
    for (const t of ["Financement", "Confidentialité", "Mentions légales"]) assert.match(pied, new RegExp(`>${t}</a>`), `${f} pied ${t}`);
  }
  assert.match(lire(dirA, "guides/pourquoi-80-pour-cent/index.html"), /<a href="\.\.\/\.\.\/guides\/"[^>]* aria-current="page">Guides<\/a>/);
});

test("S3 : les encarts de « Comment régler » renvoient vers les guides, avec des liens internes relatifs", () => {
  const h = lire(dirA, "index.html");
  assert.ok(h.includes('href="guides/charge-differee-de-la-voiture/"'));
  assert.ok(h.includes('href="guides/cable-ou-borne-programmable/"'));
  const g = lire(dirA, "guides/index.html");
  for (const f of ["charge-differee-de-la-voiture", "cable-ou-borne-programmable", "pourquoi-80-pour-cent"]) assert.ok(g.includes(`href="../guides/${f}/"`), f);
});

test("S3 : un guide d'encart qui vise une page inexistante est refusé", () => {
  const t = avec("offres.json", (o) => { o.encarts[0].guide = { texte: "x", chemin: "guides/inexistant/" }; });
  assert.throws(() => t.construire(), /guide\.chemin/);
});

test("S3 : le guide « 80 % » n'écrit aucun chiffre de dégradation ni de pourcentage autre que 80 et 100", () => {
  const h = lire(dirA, "guides/pourquoi-80-pour-cent/index.html");
  const texte = h.replace(/<[^>]+>/g, " ");
  assert.ok(!/\b(?!80\b|100\b)\d+(?:[,.]\d+)?\s?%/.test(texte), "pourcentage inattendu");
  assert.match(texte, /\[À SOURCER/);
});

test("S3 : mentions légales et confidentialité : éditeur, hébergeur et mesure d'audience restent à compléter", () => {
  const m = lire(dirA, "mentions-legales/index.html");
  assert.match(m, /Éditeur du site<\/h2>\s*<p class="a-sourcer">\[À COMPLÉTER PAR MATHIEU/);
  assert.match(m, /Hébergeur<\/h2>\s*<p class="a-sourcer">\[À COMPLÉTER PAR MATHIEU/);
  assert.match(m, /LICENCE-open-ev-data\.txt/);
  assert.ok(existsSync(join(dirA, "LICENCE-open-ev-data.txt")));
  const c = lire(dirA, "confidentialite/index.html");
  assert.match(c, /Mesure d'audience<\/h2>\s*<p class="a-sourcer">\[À COMPLÉTER/);
  assert.match(c, /aucun cookie/);
  assert.ok(!/<h2>Liste d'attente/.test(c), "sans formulaire, pas de section liste d'attente");
});

test("S3 : la construction refuse PUBLIC_INDEXABLE=1 tant qu'un marqueur reste, et le dit", () => {
  assert.ok(resultatA.marqueurs.length >= 5);
  assert.throws(() => construire({ sortie: tmp(), env: { PUBLIC_INDEXABLE: "1" } }), /PUBLIC_INDEXABLE=1 refusé.*À SOURCER/);
  assert.throws(() => construire({ sortie: tmp(), env: { PUBLIC_INDEXABLE: "1" } }), /mentions-legales/);
});

test("S3 : financement : aucun lien rémunéré ni don aujourd'hui ; liste et bouton apparaissent avec des adresses", () => {
  const h = lire(dirA, "financement/index.html");
  assert.match(h, /Aucun lien rémunéré aujourd'hui/);
  assert.ok(!/Faire un don|sponsored/.test(h));
  const t = avec("offres.json", (o) => {
    o.don = { url: "https://don.exemple.org/x" };
    o.encarts.find((e) => e.id === "solutions").liens = [{ texte: "Un câble", url: "https://partenaire.exemple.com/a", remunere: true }];
    o.liste_attente.url = "https://formulaire.exemple.eu/i";
  });
  t.construire();
  const p = lire(t.sortie, "financement/index.html");
  assert.match(p, /<a href="https:\/\/partenaire\.exemple\.com\/a" rel="sponsored nofollow noopener">Un câble<\/a> <span class="remunere">lien rémunéré<\/span>/);
  assert.match(p, /<a class="bouton" href="https:\/\/don\.exemple\.org\/x" rel="noopener">Faire un don<\/a>/);
  assert.ok(!/Aucun lien rémunéré aujourd'hui/.test(p));
  assert.match(lire(t.sortie, "confidentialite/index.html"), /<h2>Liste d'attente<\/h2>\s*<p class="a-sourcer">\[À COMPLÉTER/);
  assert.throws(() => avec("offres.json", (o) => { o.don = { url: "http://pas-https" }; }).construire(), /don/);
});

test("S3 : balises de partage et description propres à chaque page (déjà contrôlées globalement), image relative à l'origine", () => {
  for (const f of ["index.html", ...PAGES_S3]) {
    const h = lire(dirA, f);
    assert.match(h, /<meta property="og:image" content="https:\/\/exemple\.invalid\/app\/partage\.svg">/, f);
    assert.match(h, /<meta name="robots" content="noindex">/, f);
  }
});

// ---------------------------------------------------------------- S4

test("S4 : les deux entrées d'exemple sont marquées « à vérifier », ignorées, et la construction le dit", () => {
  const doc = JSON.parse(lire(join(RACINE, "public"), "donnees/modeles.json"));
  assert.ok(doc.modeles.length >= 2 && doc.modeles.every((e) => e.a_verifier === true));
  assert.deepEqual(resultatA.modelesIgnores.sort(), doc.modeles.map((e) => e.slug).sort());
  assert.ok(!existsSync(join(dirA, "limite-de-charge")));
  assert.ok(!lire(dirA, "sitemap.xml").includes("limite-de-charge"));
  assert.ok(!/limite-de-charge/.test(lire(dirA, "guides/index.html")));
});

test("S4 : une entrée valide donne une page avec h1 unique, source, calcul prérempli et lien depuis les guides", async () => {
  const t = avecModeles(ENTREE_OK);
  const r = t.construire();
  assert.deepEqual(r.modelesIgnores, []);
  const f = "limite-de-charge/peugeot-e-208/index.html";
  const h = lire(t.sortie, f);
  assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(h, /<h1>Limite de charge à 80 % sur Peugeot e-208<\/h1>/);
  assert.match(h, /<a href="https:\/\/exemple\.org\/notice-208" rel="noopener">/);
  assert.match(h, /lue le 2026-11-18/);
  assert.match(h, /<script type="module" src="\.\.\/\.\.\/app\/app-public\.js">/);
  assert.match(h, /rel="canonical" href="https:\/\/exemple\.invalid\/limite-de-charge\/peugeot-e-208\/"/);
  assert.match(h, /Nous ne savons pas encore|ne propose pas de limite/);
  assert.ok(h.includes("Heure de début seule"));
  assert.ok(/environ \d+ h \d{2} de charge/.test(h));
  assert.ok(lire(t.sortie, "sitemap.xml").includes("<loc>https://exemple.invalid/limite-de-charge/peugeot-e-208/</loc>"));
});

test("S4 : page de modèle : voiture préremplie (data-lien lisible par lireLien), plan du site et guides à jour", async () => {
  const t = avecModeles(ENTREE_OK);
  t.construire({ ...envNeutre });
  const h = lire(t.sortie, "limite-de-charge/peugeot-e-208/index.html");
  const m = /<form id="calcul"[^>]* data-lien="([^"]+)"/.exec(h);
  assert.ok(m);
  const lien = m[1].replace(/&amp;/g, "&");
  const A = await import(pathToFileURL(join(t.sortie, "app", "app-public.js")).href);
  const { lignesValides } = await import(pathToFileURL(join(t.sortie, "vehicules.js")).href);
  const lignes = lignesValides(JSON.parse(lire(t.sortie, "vehicules.json")));
  const l = A.lireLien("?" + lien, lignes);
  assert.equal(l.marque, "Peugeot"); assert.equal(l.modele, "e-208");
  assert.ok(lire(t.sortie, "guides/index.html").includes('href="../limite-de-charge/peugeot-e-208/"'));
  assert.ok(A.MESSAGE_MODELE && A.MESSAGE_MODELE !== A.MESSAGE_LIEN);
  // Construction indexable : la page de modèle est indexable aussi.
  const i = construire({ sortie: tmp(), env: { PUBLIC_INDEXABLE: "1" }, source: sansMarqueurs(t.src) });
  assert.ok(lire(i.sortie, "sitemap.xml").includes("/limite-de-charge/peugeot-e-208/"));
  assert.ok(!/noindex/.test(lire(i.sortie, "limite-de-charge/peugeot-e-208/index.html")));
});

function sansMarqueurs(srcModeles) {
  const src = tmp(); cpSync(srcModeles, src, { recursive: true });
  for (const f of readdirSync(join(src, "contenu"))) {
    const c = join(src, "contenu", f);
    writeFileSync(c, readFileSync(c, "utf8").replace(/\[À (?:SOURCER|COMPLÉTER)[^\]]*\]/g, "Texte vérifié."));
  }
  return src;
}

test("S4 : la page de modèle garde les libellés neutres de l'accueil (pas de matériel imposé, pas de jeton)", () => {
  const t = avecModeles(ENTREE_OK); t.construire();
  const h = lire(t.sortie, "limite-de-charge/peugeot-e-208/index.html");
  assert.ok(!/MyDS|Smart ?Life|DS ?3|la prise|jeton|token|workers\.dev/i.test(h));
  assert.match(h, /id="soc"/);
});

test("S4 : refus d'une entrée sans source lue", () => {
  assert.throws(() => avecModeles({ ...ENTREE_OK, sources: [] }).construire(), /aucune source lue/);
  assert.throws(() => avecModeles({ ...ENTREE_OK, sources: undefined }).construire(), /aucune source lue/);
  for (const mauvaise of [{ ...SOURCE_OK, url: "" }, { ...SOURCE_OK, url: "http://pas-https.example" }, { ...SOURCE_OK, lu_le: "hier" }, { ...SOURCE_OK, ce_que_dit_la_source: "" }]) {
    assert.throws(() => avecModeles({ ...ENTREE_OK, sources: [mauvaise] }).construire(), /chaque source exige/);
  }
});

test("S4 : refus d'une entrée absente de vehicules.json", () => {
  assert.throws(() => avecModeles({ ...ENTREE_OK, modele: "e-9999" }).construire(), /absent de vehicules\.json/);
  assert.throws(() => avecModeles({ ...ENTREE_OK, marque: "Inconnue" }).construire(), /absent de vehicules\.json/);
});

test("S4 : refus d'une entrée sans texte propre, ou dont le texte ne diffère que par le nom", () => {
  assert.throws(() => avecModeles({ ...ENTREE_OK, particularites: [] }).construire(), /particularites/);
  assert.throws(() => avecModeles({ ...ENTREE_OK, particularites: ["Trop court."] }).construire(), /particularites/);
  const b = { ...ENTREE_OK, slug: "opel-corsa-e", marque: "Opel / Vauxhall", modele: "Corsa-e",
    particularites: ["Paragraphe de test, propre à ce modèle fictif, sans valeur factuelle réelle."] };
  // Mêmes textes aux noms près : refusé (ici, les textes ne contiennent même pas le nom, ils sont donc identiques).
  assert.throws(() => avecModeles(ENTREE_OK, b).construire(), /identiques au nom du modèle près/);
  const a2 = { ...ENTREE_OK, particularites: ["La Peugeot e-208 de ce texte de test est une phrase longue pour passer le seuil."] };
  const b2 = { ...b, particularites: ["La Opel / Vauxhall Corsa-e de ce texte de test est une phrase longue pour passer le seuil."] };
  assert.throws(() => avecModeles(a2, b2).construire(), /identiques au nom du modèle près/);
  const b3 = { ...b, particularites: ["Texte réellement différent, écrit pour ce modèle fictif, avec un autre contenu."], sources: [{ ...SOURCE_OK, url: "https://exemple.org/autre" }] };
  assert.doesNotThrow(() => avecModeles(ENTREE_OK, b3).construire());
});

test("S4 : champs invalides et identifiants en double refusés ; une entrée « a_verifier » n'est jamais publiée même sans erreur", () => {
  assert.throws(() => avecModeles({ ...ENTREE_OK, limite_native: "peut-être" }).construire(), /limite_native/);
  assert.throws(() => avecModeles({ ...ENTREE_OK, charge_differee: "parfois" }).construire(), /charge_differee/);
  assert.throws(() => avecModeles({ ...ENTREE_OK, slug: "Mauvais Slug" }).construire(), /identifiant invalide/);
  assert.throws(() => avecModeles({ ...ENTREE_OK, a_verifier: true }, { ...ENTREE_OK, a_verifier: true }).construire(), /en double/);
  const t = avecModeles({ ...ENTREE_OK, a_verifier: true }); // complète, mais marquée à vérifier
  const r = t.construire();
  assert.deepEqual(r.modelesIgnores, ["peugeot-e-208"]);
  assert.ok(!existsSync(join(t.sortie, "limite-de-charge")));
});
