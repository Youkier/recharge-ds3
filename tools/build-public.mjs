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

export function construire({ sortie = SORTIE_PAR_DEFAUT, env = process.env } = {}) {
  const pub = join(RACINE, "public");
  const indexable = env.PUBLIC_INDEXABLE === "1";
  let origine = (env.PUBLIC_ORIGINE || ORIGINE_PAR_DEFAUT).replace(/\/$/, "");
  if (!/^https?:\/\/[^\s/?#"'<>]+$/.test(origine)) throw new Error("PUBLIC_ORIGINE doit ressembler à https://exemple.fr (sans chemin)");
  const tarifs = lirePrix(pub);
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
    const contenu = rendre(gab, { base: p.base, phc: esc(phc), php: esc(php), source_tarifs: sourceTarifs }, p.gabarit);
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
