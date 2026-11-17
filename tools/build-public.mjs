// Construit le site public dans dist/public/ (phase 3a). Node seul, aucune dépendance.
//   node tools/build-public.mjs
// Variables : PUBLIC_INDEXABLE=1 (sinon noindex partout et robots.txt qui interdit tout),
//             PUBLIC_ORIGINE=https://exemple.fr (liens canoniques et plan du site ; défaut neutre https://exemple.invalid).
// Même entrée, même sortie : aucune date du jour dans les fichiers produits.

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SORTIE_PAR_DEFAUT = join(RACINE, "dist", "public");
export const ORIGINE_PAR_DEFAUT = "https://exemple.invalid";
const MARQUEUR = ".build-public";

const PAGES = [
  { chemin: "/", fichier: "index.html", gabarit: "accueil", base: "", scripts: true, indexable: true,
    titre: "Limite de charge à 80 % en heures creuses : l'heure de démarrage, calculée",
    description: "Votre voiture n'a pas de limite de charge à 80 % ? Saisissez la batterie à l'arrivée : le calcul donne l'heure de début de charge pour finir à 80 % en heures creuses." },
  { chemin: "/404.html", fichier: "404.html", gabarit: "404", base: "/", scripts: false, indexable: false,
    titre: "Page introuvable",
    description: "Cette adresse n'existe pas ou a changé. Revenez au calcul de la charge en heures creuses." },
];

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// Remplacement en une passe : le texte inséré n'est jamais ré-interprété. Un champ inconnu est une erreur.
function rendre(modele, valeurs, nom) {
  return modele.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in valeurs)) throw new Error(`Champ « ${k} » inconnu dans ${nom}`);
    return valeurs[k];
  });
}

function lirePrix(dossier) {
  const t = JSON.parse(readFileSync(join(dossier, "donnees", "tarifs.json"), "utf8"));
  for (const k of ["hc", "hp"]) {
    if (t[k] !== null && !(typeof t[k] === "number" && t[k] > 0 && t[k] < 10)) throw new Error(`tarifs.json : « ${k} » doit être null ou un prix en €/kWh`);
  }
  if ((t.hc === null) !== (t.hp === null)) throw new Error("tarifs.json : hc et hp sont renseignés ensemble ou pas du tout");
  if (t.hc !== null && !(typeof t.source === "string" && t.source && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)))) {
    throw new Error("tarifs.json : un prix renseigné exige « source » et « date » (AAAA-MM-JJ)");
  }
  return t;
}

const REL_REMUNERE = "sponsored nofollow noopener";
const ID = /^[a-z0-9-]+$/;
const texte = (x) => typeof x === "string" && x.trim() !== "";
const urlVideOuHttps = (x) => typeof x === "string" && (x === "" || /^https:\/\/[^\s"'<>]+$/.test(x));

// offres.json : toute entrée mal formée arrête la construction (jamais de lien ou d'encart à moitié rendu).
function lireOffres(dossier) {
  const o = JSON.parse(readFileSync(join(dossier, "donnees", "offres.json"), "utf8"));
  const fail = (m) => { throw new Error("offres.json : " + m); };
  if (!o || typeof o !== "object" || !o.liste_attente || !urlVideOuHttps(o.liste_attente.url)) fail("« liste_attente.url » doit être vide ou commencer par https://");
  if (!Array.isArray(o.encarts) || !Array.isArray(o.reponses)) fail("« encarts » et « reponses » doivent être des listes");
  const encarts = new Map();
  for (const e of o.encarts) {
    if (!e || !ID.test(e.id || "") || encarts.has(e.id)) fail(`identifiant d'encart invalide ou en double (${e && e.id})`);
    if (typeof e.actif !== "boolean") fail(`encart ${e.id} : « actif » doit valoir true ou false`);
    if (!texte(e.titre)) fail(`encart ${e.id} : titre manquant`);
    for (const k of ["paragraphes", "points", "liens"]) if (e[k] !== undefined && !Array.isArray(e[k])) fail(`encart ${e.id} : « ${k} » doit être une liste`);
    if (![...(e.paragraphes || []), ...(e.points || [])].every(texte)) fail(`encart ${e.id} : texte vide`);
    for (const l of e.liens || []) {
      if (!texte(l.texte)) fail(`encart ${e.id} : lien sans texte`);
      if (!urlVideOuHttps(l.url)) fail(`encart ${e.id} : l'adresse « ${l.url} » doit être vide ou commencer par https://`);
      if (typeof l.remunere !== "boolean") fail(`encart ${e.id} : « remunere » doit valoir true ou false pour chaque lien`);
    }
    encarts.set(e.id, e);
  }
  const ids = new Set();
  for (const r of o.reponses) {
    if (!r || !ID.test(r.id || "") || ids.has(r.id) || !texte(r.libelle) || !encarts.has(r.encart)) fail(`réponse invalide (${r && r.id})`);
    ids.add(r.id);
  }
  return o;
}

function htmlLien(l) {
  if (l.url === "") return "";
  const rel = l.remunere ? REL_REMUNERE : "noopener";
  return `<p><a href="${esc(l.url)}" rel="${rel}">${esc(l.texte)}</a>${l.remunere ? ' <span class="remunere">lien rémunéré</span>' : ""}</p>`;
}
function htmlEncart(e, masque) {
  const h = [`<div class="encart" id="encart-${e.id}"${masque ? " hidden" : ""}>`, `<h3>${esc(e.titre)}</h3>`];
  for (const p of e.paragraphes || []) h.push(`<p>${esc(p)}</p>`);
  if ((e.points || []).length) h.push("<ul>" + e.points.map((p) => `<li>${esc(p)}</li>`).join("") + "</ul>");
  for (const l of e.liens || []) h.push(htmlLien(l));
  h.push("</div>");
  return h.join("\n");
}
// Seuls les encarts actifs sont écrits. Ceux que désigne une réponse s'affichent à son choix ; les autres, toujours.
function htmlCommentRegler(o) {
  const parId = new Map(o.encarts.map((e) => [e.id, e]));
  const reponses = o.reponses.filter((r) => parId.get(r.encart).actif);
  const designes = new Set(o.reponses.map((r) => r.encart));
  const h = ['<section class="bloc" id="comment-regler" aria-labelledby="titre-regler">', '<h2 id="titre-regler">Comment régler ?</h2>'];
  if (reponses.length) {
    h.push('<fieldset class="radios" id="lancement"><legend>Comment lancez-vous la charge ?</legend>', '<p class="aide">Choisissez votre cas pour voir quoi régler et où.</p>');
    for (const r of reponses) h.push(`<label><input type="radio" name="lancement" value="${r.id}" data-encart="encart-${r.encart}"> ${esc(r.libelle)}</label>`);
    h.push("</fieldset>");
    h.push('<div id="encarts-lancement" aria-live="polite">');
    for (const r of reponses) h.push(htmlEncart(parId.get(r.encart), true));
    h.push("</div>");
  }
  for (const e of o.encarts) if (e.actif && !designes.has(e.id)) h.push(htmlEncart(e, false));
  h.push("</section>");
  return h.join("\n");
}
function htmlListeAttente(o) {
  if (o.liste_attente.url === "") return "";
  return `<section class="bloc" id="liste-attente" aria-labelledby="titre-attente">
<h2 id="titre-attente">Vous voulez que ça se règle tout seul ?</h2>
<p>Nous étudions un réglage automatique de l'heure de charge pour certains câbles et bornes connectés. Laissez-nous votre adresse e-mail pour être prévenu quand il sera prêt.</p>
<p class="aide">Le formulaire s'ouvre sur un autre site. Il demande votre voiture, la marque et le modèle de votre câble ou de votre borne, et votre adresse e-mail.</p>
<p><a class="bouton" href="${esc(o.liste_attente.url)}" rel="noopener">Ouvrir le formulaire de la liste d'attente</a></p>
</section>`;
}

function listerFichiers(dossier, base = dossier) {
  const out = [];
  for (const n of readdirSync(dossier).sort()) {
    const c = join(dossier, n);
    if (statSync(c).isDirectory()) out.push(...listerFichiers(c, base)); else out.push(c.slice(base.length + 1).split(sep).join("/"));
  }
  return out;
}

// Vide le dossier de sortie : seulement dist/public du dépôt, ou un dossier que ce script a lui-même rempli (marqueur), ou un dossier vide.
function preparerSortie(sortie) {
  const s = resolve(sortie);
  if (existsSync(s)) {
    const estCelui = s === SORTIE_PAR_DEFAUT;
    const estVide = statSync(s).isDirectory() && readdirSync(s).length === 0;
    const marque = existsSync(join(s, MARQUEUR));
    if (!estCelui && !estVide && !marque) throw new Error(`Refus de vider ${s} : ce n'est ni ${SORTIE_PAR_DEFAUT} ni un dossier construit par ce script`);
    if (estCelui && s !== join(RACINE, "dist", "public")) throw new Error("Chemin de sortie inattendu");
    rmSync(s, { recursive: true, force: true });
  }
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, MARQUEUR), "Dossier construit par tools/build-public.mjs : peut être vidé.\n");
  return s;
}

// source : dossier à la forme de public/ (les tests y mettent un offres.json de leur choix).
export function construire({ sortie = SORTIE_PAR_DEFAUT, env = process.env, source = join(RACINE, "public") } = {}) {
  const pub = source;
  const indexable = env.PUBLIC_INDEXABLE === "1";
  let origine = (env.PUBLIC_ORIGINE || ORIGINE_PAR_DEFAUT).replace(/\/$/, "");
  if (!/^https?:\/\/[^\s/?#"'<>]+$/.test(origine)) throw new Error("PUBLIC_ORIGINE doit ressembler à https://exemple.fr (sans chemin)");
  const tarifs = lirePrix(pub);
  const offres = lireOffres(pub);
  const s = preparerSortie(sortie);

  // Moteur partagé, copié à l'identique depuis site/.
  for (const f of ["calc.js", "vehicules.js", "vehicules.json"]) copyFileSync(join(RACINE, "site", f), join(s, f));
  // Interface publique.
  mkdirSync(join(s, "app"), { recursive: true });
  for (const f of readdirSync(join(pub, "app")).sort()) copyFileSync(join(pub, "app", f), join(s, "app", f));

  const base = readFileSync(join(pub, "gabarits", "base.html"), "utf8");
  const phc = tarifs.hc === null ? "" : String(tarifs.hc).replace(".", ",");
  const php = tarifs.hp === null ? "" : String(tarifs.hp).replace(".", ",");
  const sourceTarifs = tarifs.hc === null ? "" : `<p class="aide">Prix par défaut : ${esc(tarifs.source)}, lus le ${esc(tarifs.date)}.</p>`;

  const titres = new Set();
  for (const p of PAGES) {
    if (titres.has(p.titre)) throw new Error(`Titre en double : ${p.titre}`);
    titres.add(p.titre);
    const gab = p.gabarit === "404"
      ? readFileSync(join(pub, "contenu", "404.html"), "utf8")
      : readFileSync(join(pub, "gabarits", `${p.gabarit}.html`), "utf8");
    const contenu = rendre(gab, { base: p.base, phc: esc(phc), php: esc(php), source_tarifs: sourceTarifs, comment_regler: htmlCommentRegler(offres), liste_attente: htmlListeAttente(offres) }, p.gabarit);
    const canonique = origine + p.chemin;
    const html = rendre(base, {
      titre: esc(p.titre), description: esc(p.description), canonique: esc(canonique),
      image: esc(origine + "/app/partage.svg"), base: p.base,
      robots: indexable && p.indexable ? "" : '<meta name="robots" content="noindex">\n',
      scripts: p.scripts ? `<script type="module" src="${p.base}app/app-public.js"></script>\n` : "",
      contenu,
    }, "base");
    if ((html.match(/<h1[\s>]/g) || []).length !== 1) throw new Error(`${p.fichier} : un seul h1 attendu`);
    writeFileSync(join(s, p.fichier), html);
  }

  writeFileSync(join(s, "robots.txt"), indexable
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origine}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n");
  const urls = PAGES.filter((p) => p.indexable).map((p) => `  <url><loc>${esc(origine + p.chemin)}</loc></url>\n`).join("");
  writeFileSync(join(s, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`);
  return { sortie: s, fichiers: listerFichiers(s), pages: PAGES.map((p) => ({ chemin: p.chemin, fichier: p.fichier })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = construire();
    console.log(`Site public construit dans ${r.sortie} (${r.fichiers.length} fichiers).`);
  } catch (e) { console.error("Échec de la construction : " + e.message); process.exit(1); }
}
