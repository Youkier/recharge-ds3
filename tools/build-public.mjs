// Construit le site public dans dist/public/ (phase 3a). Node seul, aucune dépendance.
//   node tools/build-public.mjs
// Variables : PUBLIC_INDEXABLE=1 (sinon noindex partout et robots.txt qui interdit tout),
//             PUBLIC_ORIGINE=https://exemple.fr (liens canoniques et plan du site ; défaut neutre https://exemple.invalid).
// Même entrée, même sortie : aucune date du jour dans les fichiers produits.

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lignesValides } from "../site/vehicules.js";
import { fr, fdur, effAuto, plan, fmt } from "../site/calc.js";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SORTIE_PAR_DEFAUT = join(RACINE, "dist", "public");
export const ORIGINE_PAR_DEFAUT = "https://exemple.invalid";
const MARQUEUR = ".build-public";

// Pages fixes. « contenu » : fragment de public/contenu/ ; « gabarit » : gabarit de public/gabarits/.
// « base » : chemin relatif de la racine du site depuis la page (le site peut être servi sous un sous-chemin).
const PAGES = [
  { chemin: "/", fichier: "index.html", gabarit: "accueil", base: "", scripts: true, indexable: true, section: "accueil",
    titre: "Limite de charge à 80 % en heures creuses : l'heure de démarrage, calculée",
    description: "Votre voiture n'a pas de limite de charge à 80 % ? Saisissez la batterie à l'arrivée : le calcul donne l'heure de début de charge pour finir à 80 % en heures creuses." },
  { chemin: "/guides/", fichier: "guides/index.html", contenu: "guides-index", base: "../", indexable: true, section: "guides",
    titre: "Guides : régler la charge de sa voiture électrique en heures creuses",
    description: "Trois guides courts : régler la charge différée de la voiture, régler un câble ou une borne programmable, comprendre pourquoi limiter la charge à 80 %." },
  { chemin: "/guides/charge-differee-de-la-voiture/", fichier: "guides/charge-differee-de-la-voiture/index.html", contenu: "guide-charge-differee", base: "../../", indexable: true, section: "guides",
    titre: "Régler la charge différée de la voiture : quelle heure, quelles limites",
    description: "Où trouver la charge différée, quelle heure régler, et ce qui change si la voiture n'accepte qu'une heure de début sans heure de fin." },
  { chemin: "/guides/cable-ou-borne-programmable/", fichier: "guides/cable-ou-borne-programmable/index.html", contenu: "guide-cable-borne", base: "../../", indexable: true, section: "guides",
    titre: "Câble ou borne programmable : régler une plage horaire de charge",
    description: "Régler l'heure de début de charge dans l'appli d'un câble ou d'une borne connectés, et ce qu'il faut vérifier avant d'en choisir un." },
  { chemin: "/guides/pourquoi-80-pour-cent/", fichier: "guides/pourquoi-80-pour-cent/index.html", contenu: "guide-80-pour-cent", base: "../../", indexable: true, section: "guides",
    titre: "Pourquoi limiter la charge à 80 % : ce qu'on peut en dire",
    description: "Pourquoi certains conducteurs ne chargent pas à 100 % tous les jours, quand charger à 100 %, et ce que ce site n'affirme pas." },
  { chemin: "/financement/", fichier: "financement/index.html", contenu: "financement", base: "../", indexable: true, section: "financement",
    titre: "Financement du site : liens rémunérés et don",
    description: "Comment ce site est financé et la liste de chaque lien rémunéré, signalé comme tel." },
  { chemin: "/confidentialite/", fichier: "confidentialite/index.html", contenu: "confidentialite", base: "../", indexable: true, section: "",
    titre: "Confidentialité : aucune donnée collectée, aucun cookie",
    description: "Ce que ce site fait et ne fait pas de vos données : aucun cookie, réglages gardés dans votre navigateur." },
  { chemin: "/mentions-legales/", fichier: "mentions-legales/index.html", contenu: "mentions-legales", base: "../", indexable: true, section: "",
    titre: "Mentions légales",
    description: "Éditeur, hébergeur et sources des données de ce site." },
  { chemin: "/404.html", fichier: "404.html", contenu: "404", base: "/", scripts: false, indexable: false, section: "",
    titre: "Page introuvable",
    description: "Cette adresse n'existe pas ou a changé. Revenez au calcul de la charge en heures creuses." },
];
// Insensible à la casse et aux accents : « [à compléter », « [A SOURCER » bloquent aussi.
const MARQUEURS = /\[\s*[AÀaà]\s+(?:SOURCER|COMPL[EÉeé]TER)[^\]]*\]?/gi;

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
function lireOffres(dossier, cheminsConnus) {
  const o = JSON.parse(readFileSync(join(dossier, "donnees", "offres.json"), "utf8"));
  const fail = (m) => { throw new Error("offres.json : " + m); };
  if (!o || typeof o !== "object" || !o.liste_attente || !urlVideOuHttps(o.liste_attente.url)) fail("« liste_attente.url » doit être vide ou commencer par https://");
  if (o.don !== undefined && !(o.don && urlVideOuHttps(o.don.url))) fail("« don.url » doit être vide ou commencer par https://");
  if (!Array.isArray(o.encarts) || !Array.isArray(o.reponses)) fail("« encarts » et « reponses » doivent être des listes");
  const encarts = new Map();
  for (const e of o.encarts) {
    if (!e || !ID.test(e.id || "") || encarts.has(e.id)) fail(`identifiant d'encart invalide ou en double (${e && e.id})`);
    if (typeof e.actif !== "boolean") fail(`encart ${e.id} : « actif » doit valoir true ou false`);
    if (!texte(e.titre)) fail(`encart ${e.id} : titre manquant`);
    for (const k of ["paragraphes", "points", "liens"]) if (e[k] !== undefined && !Array.isArray(e[k])) fail(`encart ${e.id} : « ${k} » doit être une liste`);
    if (![...(e.paragraphes || []), ...(e.points || [])].every(texte)) fail(`encart ${e.id} : texte vide`);
    if (e.guide !== undefined) {
      if (!e.guide || !texte(e.guide.texte) || !texte(e.guide.chemin) || !cheminsConnus.has(e.guide.chemin)) fail(`encart ${e.id} : « guide.chemin » doit être une page du site (par exemple guides/…/)`);
    }
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
function htmlEncart(e, masque, base) {
  const h = [`<div class="encart" id="encart-${e.id}"${masque ? " hidden" : ""}>`, `<h3>${esc(e.titre)}</h3>`];
  for (const p of e.paragraphes || []) h.push(`<p>${esc(p)}</p>`);
  if ((e.points || []).length) h.push("<ul>" + e.points.map((p) => `<li>${esc(p)}</li>`).join("") + "</ul>");
  if (e.guide) h.push(`<p><a href="${base}${esc(e.guide.chemin)}">${esc(e.guide.texte)}</a></p>`);
  for (const l of e.liens || []) h.push(htmlLien(l));
  h.push("</div>");
  return h.join("\n");
}
// Seuls les encarts actifs sont écrits. Ceux que désigne une réponse s'affichent à son choix ; les autres, toujours.
function htmlCommentRegler(o, base) {
  const parId = new Map(o.encarts.map((e) => [e.id, e]));
  const reponses = o.reponses.filter((r) => parId.get(r.encart).actif);
  const designes = new Set(o.reponses.map((r) => r.encart));
  const h = ['<section class="bloc" id="comment-regler" aria-labelledby="titre-regler">', '<h2 id="titre-regler">Comment régler ?</h2>'];
  if (reponses.length) {
    h.push('<fieldset class="radios" id="lancement"><legend>Comment lancez-vous la charge ?</legend>', '<p class="aide">Choisissez votre cas pour voir quoi régler et où.</p>');
    for (const r of reponses) h.push(`<label><input type="radio" name="lancement" value="${r.id}" data-encart="encart-${r.encart}"> ${esc(r.libelle)}</label>`);
    h.push("</fieldset>");
    h.push('<div id="encarts-lancement" aria-live="polite">');
    for (const r of reponses) h.push(htmlEncart(parId.get(r.encart), true, base));
    h.push("</div>");
  }
  for (const e of o.encarts) if (e.actif && !designes.has(e.id)) h.push(htmlEncart(e, false, base));
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

// ---------------------------------------------------------------- Pages par modèle (lot S4)
const CHARGE_DIFFEREE = ["debut_seul", "debut_et_fin", "aucune", "inconnu"];
// Date de lecture d'une source : vraie date du calendrier, pas dans le futur.
const DATE = { test(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const d = new Date(t + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === t && d.getTime() <= Date.now();
} };
const normaliser = (t, e) => {
  let x = String(t).toLowerCase();
  for (const nom of [e.marque, e.modele].sort((a, b) => b.length - a.length)) x = x.split(String(nom).toLowerCase()).join("§");
  return x.replace(/\s+/g, " ").trim();
};

// Une entrée « a_verifier » est ignorée. Toute autre entrée doit avoir une source lue, exister dans vehicules.json
// et un texte propre : sinon la construction s'arrête (jamais de page de modèle à moitié fondée).
function lireModeles(dossier, lignes) {
  const doc = JSON.parse(readFileSync(join(dossier, "donnees", "modeles.json"), "utf8"));
  const fail = (m) => { throw new Error("modeles.json : " + m); };
  if (!doc || !Array.isArray(doc.modeles)) fail("« modeles » doit être une liste");
  const publies = [], ignores = [], slugs = new Set();
  for (const e of doc.modeles) {
    if (!e || !ID.test(e.slug || "")) fail(`identifiant invalide (${e && e.slug})`);
    if (slugs.has(e.slug)) fail(`identifiant en double (${e.slug})`);
    slugs.add(e.slug);
    if (e.a_verifier === true) { ignores.push(e.slug); continue; }
    if (e.a_verifier !== undefined && e.a_verifier !== false) fail(`${e.slug} : « a_verifier » doit valoir true ou false`);
    if (!texte(e.marque) || !texte(e.modele)) fail(`${e.slug} : marque ou modèle manquant`);
    const versions = lignes.filter((r) => r[0] === e.marque && r[1] === e.modele);
    if (!versions.length) fail(`${e.slug} : « ${e.marque} ${e.modele} » est absent de vehicules.json`);
    if (![true, false, "inconnu"].includes(e.limite_native)) fail(`${e.slug} : « limite_native » doit valoir true, false ou "inconnu"`);
    if (!CHARGE_DIFFEREE.includes(e.charge_differee)) fail(`${e.slug} : « charge_differee » doit valoir ${CHARGE_DIFFEREE.join(", ")}`);
    if (!Array.isArray(e.sources) || !e.sources.length) fail(`${e.slug} : aucune source lue (une page de modèle exige au moins une source)`);
    for (const so of e.sources) {
      if (!so || !/^https:\/\/[^\s"'<>]+$/.test(so.url || "") || !DATE.test(so.lu_le || "") || !texte(so.ce_que_dit_la_source)) fail(`${e.slug} : chaque source exige « url » (https), « lu_le » (AAAA-MM-JJ) et « ce_que_dit_la_source »`);
    }
    if (!Array.isArray(e.particularites) || !e.particularites.every(texte) || !e.particularites.some((t) => t.trim().length >= 40)) fail(`${e.slug} : « particularites » doit contenir au moins un paragraphe propre au modèle (40 caractères ou plus)`);
    publies.push({ ...e, versions });
  }
  // Deux pages dont le texte ne diffère que par le nom du modèle : refus.
  const vus = new Map();
  for (const e of publies) {
    const cle = normaliser(e.particularites.join(" ") + " " + e.sources.map((x) => x.ce_que_dit_la_source).join(" "), e);
    if (vus.has(cle)) fail(`${e.slug} et ${vus.get(cle)} : textes identiques au nom du modèle près (chaque page doit dire quelque chose de propre à son modèle)`);
    vus.set(cle, e.slug);
  }
  return { publies, ignores };
}

// Durée d'une recharge de 20 à 80 % à 16 A, 230 V, rendement proposé par le site, arrondie aux 5 minutes au-dessus (comme calc.js).
function dureeType(cap) {
  const P = 16 * 230 / 1000;
  const rate = P * effAuto(16, 230) / 100; // rendement proposé par le site (effAuto, calc.js)
  return Math.ceil(0.6 * cap / rate * 60 / 5) * 5;
}
// Exemple chiffré du premier écran : mêmes valeurs par défaut que le résultat provisoire de la page (voiture de 50 kWh utiles,
// batterie à 38 % à l'arrivée, 16 A, 230 V, heures creuses 22:00-06:00, cible 80 %), calculé par calc.js : jamais écrit à la main.
export const EXEMPLE = { cap: 50, soh: 100, soc: 38, target: 80, dep: "07:30", hcStart: "22:00", hcEnd: "06:00", amp: 16, volt: 230 };
export function texteExemple() {
  const p = { ...EXEMPLE, eff: effAuto(EXEMPLE.amp, EXEMPLE.volt), pre: 0, deduct: false, mode: "end", pHC: 0, pHP: 0 };
  const r = plan(p);
  if (r.status !== "ok") throw new Error("Exemple chiffré : le calcul de référence n'est plus « ok »");
  return `Voiture de ${EXEMPLE.cap} kWh utiles, batterie à ${EXEMPLE.soc} % en arrivant, recharge à ${EXEMPLE.amp} A (${fr(r.P, 1)} kW), heures creuses ${EXEMPLE.hcStart}–${EXEMPLE.hcEnd} : démarrer la charge à ${fmt(r.start)} pour finir à ${EXEMPLE.target} % à ${fmt(r.end)}.`;
}
const LIB_LIMITE = { true: "Oui", false: "Non", inconnu: "Nous ne savons pas encore" };
function htmlModele(e, base) {
  const guideCable = `<a href="${base}guides/cable-ou-borne-programmable/">câble ou borne programmable</a>`;
  const intro = {
    true: "<p>D'après les sources lues, ce modèle propose une limite de charge : utilisez-la en priorité. Le calcul ci-dessous reste disponible pour placer la charge en heures creuses.</p>",
    false: "<p>D'après les sources lues, ce modèle ne propose pas de limite de charge réglable. Le calcul ci-dessous donne l'heure à laquelle démarrer la charge pour qu'elle se termine vers 80 % en heures creuses.</p>",
    inconnu: "<p>Nous ne savons pas encore si ce modèle propose une limite de charge. Le calcul ci-dessous fonctionne dans tous les cas.</p>",
  }[e.limite_native];
  const differee = {
    debut_seul: "Heure de début seule : la charge continue ensuite jusqu'à la batterie pleine ou au débranchement",
    debut_et_fin: "Heure de début et heure de fin réglables",
    aucune: `Aucune charge différée : voir un ${guideCable}`,
    inconnu: "Nous ne savons pas encore",
  }[e.charge_differee];
  const caps = e.versions.map((r) => r[3]);
  const lis = e.versions.map((r) => `<li>${esc(r[2])} : environ ${esc(fdur(dureeType(r[3])))} de charge</li>`).join("\n");
  const versions = `<p>Estimation pour une recharge de 20 à 80 % à 16 A (3,7 kW), batterie en pleine santé, d'après la capacité utile de la liste des véhicules du site.</p>\n<ul>\n${lis}\n</ul>`;
  const part = e.particularites.map((t) => `<p>${esc(t)}</p>`).join("\n");
  const sources = "<ul>\n" + e.sources.map((x) => `<li><a href="${esc(x.url)}" rel="noopener">${esc(x.url)}</a> (lue le ${esc(x.lu_le)}) : ${esc(x.ce_que_dit_la_source)}</li>`).join("\n") + "\n</ul>";
  return {
    valeurs: { marque: esc(e.marque), modele: esc(e.modele), intro, limite_native: esc(LIB_LIMITE[e.limite_native]), charge_differee: differee, particularites: part, versions, sources },
    lien: new URLSearchParams({ marque: e.marque, modele: e.modele }).toString(),
    titre: `Limite de charge à 80 % sur ${e.marque} ${e.modele}`,
    description: `${e.marque} ${e.modele} : capacité utile de ${fr(Math.min(...caps), 1)} à ${fr(Math.max(...caps), 1)} kWh selon la version. Calculez l'heure de démarrage pour finir à 80 % en heures creuses.`,
  };
}

function htmlListeRemuneres(o) {
  const items = [];
  for (const e of o.encarts) if (e.actif) for (const l of e.liens || []) if (l.remunere && l.url !== "") {
    items.push(`<li><a href="${esc(l.url)}" rel="${REL_REMUNERE}">${esc(l.texte)}</a> <span class="remunere">lien rémunéré</span> (dans « ${esc(e.titre)} »)</li>`);
  }
  return items.length ? `<ul>\n${items.join("\n")}\n</ul>` : "<p>Aucun lien rémunéré aujourd'hui.</p>";
}
function htmlDon(o) {
  const url = o.don ? o.don.url : "";
  return url ? `<p>Si le site vous a rendu service, vous pouvez le soutenir par un don.</p>\n<p><a class="bouton" href="${esc(url)}" rel="noopener">Faire un don</a></p>`
    : "<p>Le site n'a pas de page de don pour l'instant.</p>";
}

// En-têtes HTTP de Cloudflare Pages (fichier _headers à la racine de la sortie, syntaxe lue le 2026-11-20 sur
// developers.cloudflare.com/pages/configuration/headers/). La CSP reprend celle de la balise du gabarit, plus
// frame-ancestors, que seul l'en-tête permet. Hors mise en ligne indexable, X-Robots-Tag double la balise noindex.
function enTetes(gabaritBase, indexable) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(gabaritBase);
  if (!m) throw new Error("gabarit base : balise Content-Security-Policy introuvable");
  return [
    "/*",
    `  Content-Security-Policy: ${m[1]}; frame-ancestors 'none'`,
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    ...(indexable ? [] : ["  X-Robots-Tag: noindex"]),
    "",
  ].join("\n");
}

// source : dossier à la forme de public/ (les tests y mettent les données de leur choix).
export function construire({ sortie = SORTIE_PAR_DEFAUT, env = process.env, source = join(RACINE, "public") } = {}) {
  const pub = source;
  const indexable = env.PUBLIC_INDEXABLE === "1";
  let origine = (env.PUBLIC_ORIGINE || ORIGINE_PAR_DEFAUT).replace(/\/$/, "");
  if (!/^https?:\/\/[^\s/?#"'<>]+$/.test(origine)) throw new Error("PUBLIC_ORIGINE doit ressembler à https://exemple.fr (sans chemin)");
  const tarifs = lirePrix(pub);
  const lignes = lignesValides(JSON.parse(readFileSync(join(RACINE, "site", "vehicules.json"), "utf8")));
  const modeles = lireModeles(pub, lignes);
  const pagesModeles = modeles.publies.map((e) => ({ chemin: `/limite-de-charge/${e.slug}/`, fichier: `limite-de-charge/${e.slug}/index.html`, gabarit: "modele", base: "../../", scripts: true, indexable: true, section: "", modele: e }));
  const toutes = [...PAGES, ...pagesModeles];
  const offres = lireOffres(pub, new Set(toutes.map((p) => p.chemin.slice(1)).filter((c) => c.endsWith("/"))));
  const s = preparerSortie(sortie);

  // Moteur partagé, copié à l'identique depuis site/ (la licence des données de véhicules suit).
  for (const f of ["calc.js", "vehicules.js", "vehicules.json", "LICENCE-open-ev-data.txt"]) copyFileSync(join(RACINE, "site", f), join(s, f));
  // Interface publique.
  mkdirSync(join(s, "app"), { recursive: true });
  for (const f of readdirSync(join(pub, "app")).sort()) copyFileSync(join(pub, "app", f), join(s, "app", f));

  const gabarit = (n) => readFileSync(join(pub, "gabarits", `${n}.html`), "utf8");
  const base = gabarit("base");
  const phc = tarifs.hc === null ? "" : String(tarifs.hc).replace(".", ",");
  const php = tarifs.hp === null ? "" : String(tarifs.hp).replace(".", ",");
  const sourceTarifs = tarifs.hc === null ? "" : `<p class="aide">Prix par défaut : ${esc(tarifs.source)}, lus le ${esc(tarifs.date)}.</p>`;
  const attenteConfidentialite = offres.liste_attente.url === "" ? ""
    : "<h2>Liste d'attente</h2>\n<p class=\"a-sourcer\">[À COMPLÉTER : prestataire du formulaire (hébergé dans l'Union européenne), usage de l'adresse e-mail, durée de conservation et façon de se désinscrire.]</p>";

  const titres = new Set(), descriptions = new Set(), marqueurs = [], aEcrire = [];
  for (const p of toutes) {
    const m = p.modele ? htmlModele(p.modele, p.base) : null;
    const titre = m ? m.titre : p.titre, description = m ? m.description : p.description;
    if (titres.has(titre)) throw new Error(`Titre en double : ${titre}`);
    if (descriptions.has(description)) throw new Error(`Description en double : ${description}`);
    titres.add(titre); descriptions.add(description);
    const commun = {
      base: p.base, phc: esc(phc), php: esc(php), source_tarifs: sourceTarifs,
      exemple: esc(texteExemple()), comment_regler: htmlCommentRegler(offres, p.base), liste_attente: htmlListeAttente(offres),
      liste_remuneres: htmlListeRemuneres(offres), don: htmlDon(offres), confidentialite_attente: attenteConfidentialite,
      liste_modeles: pagesModeles.length
        ? `<h2>Une page par modèle</h2>\n<ul class="liste-pages">\n${pagesModeles.map((q) => `<li><a href="${p.base}${q.chemin.slice(1)}">${esc(q.modele.marque)} ${esc(q.modele.modele)}</a></li>`).join("\n")}\n</ul>` : "",
      lien_voiture: m ? ` data-lien="${esc(m.lien)}"` : "",
      marque: "", modele: "", intro: "", limite_native: "", charge_differee: "", particularites: "", versions: "", sources: "",
      ...(m ? m.valeurs : {}),
    };
    commun.calcul = rendre(gabarit("calcul"), commun, "calcul");
    commun.partage = rendre(gabarit("partage"), commun, "partage");
    const gab = p.contenu ? readFileSync(join(pub, "contenu", `${p.contenu}.html`), "utf8") : gabarit(p.gabarit);
    const contenu = rendre(gab, commun, p.contenu || p.gabarit);
    const canonique = origine + p.chemin;
    const courant = (n) => (p.section === n ? ' aria-current="page"' : "");
    const html = rendre(base, {
      titre: esc(titre), description: esc(description), canonique: esc(canonique),
      image: esc(origine + "/app/partage.svg"), base: p.base,
      cur_accueil: courant("accueil"), cur_guides: courant("guides"), cur_financement: courant("financement"),
      robots: indexable && p.indexable ? "" : '<meta name="robots" content="noindex">\n',
      scripts: p.scripts ? `<script type="module" src="${p.base}app/app-public.js"></script>\n` : "",
      contenu,
    }, "base");
    if ((html.match(/<h1[\s>]/g) || []).length !== 1) throw new Error(`${p.fichier} : un seul h1 attendu`);
    for (const x of html.match(MARQUEURS) || []) marqueurs.push({ chemin: p.chemin, marqueur: x });
    aEcrire.push([p.fichier, html]);
  }
  // Contrôle avant toute écriture des pages : un refus ne laisse jamais de pages indexables sans robots.txt.
  if (indexable && marqueurs.length) {
    throw new Error(`PUBLIC_INDEXABLE=1 refusé : ${marqueurs.length} marqueur(s) « [À SOURCER » ou « [À COMPLÉTER » restent (${[...new Set(marqueurs.map((x) => x.chemin))].join(", ")})`);
  }
  for (const [fichier, html] of aEcrire) {
    mkdirSync(dirname(join(s, fichier)), { recursive: true });
    writeFileSync(join(s, fichier), html);
  }

  writeFileSync(join(s, "robots.txt"), indexable
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origine}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n");
  writeFileSync(join(s, "_headers"), enTetes(base, indexable));
  const urls = toutes.filter((p) => p.indexable).map((p) => `  <url><loc>${esc(origine + p.chemin)}</loc></url>\n`).join("");
  writeFileSync(join(s, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`);
  return { sortie: s, fichiers: listerFichiers(s), pages: toutes.map((p) => ({ chemin: p.chemin, fichier: p.fichier })), marqueurs, modelesIgnores: modeles.ignores };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = construire();
    console.log(`Site public construit dans ${r.sortie} (${r.fichiers.length} fichiers, ${r.pages.length} pages).`);
    if (r.modelesIgnores.length) console.log(`Pages de modèles ignorées (« a_verifier », sans source lue) : ${r.modelesIgnores.join(", ")}.`);
    if (r.marqueurs.length) console.log(`Marqueurs à lever avant la mise en ligne indexable : ${r.marqueurs.length}.\n` + r.marqueurs.map((x) => `  ${x.chemin} : ${x.marqueur.slice(0, 90)}`).join("\n"));
  } catch (e) { console.error("Échec de la construction : " + e.message); process.exit(1); }
}
