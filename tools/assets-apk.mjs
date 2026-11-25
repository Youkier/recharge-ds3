// Copie les fichiers embarqués dans l'APK vers dist/apk-assets/ (lot C3.1 de la phase 3b). Node seul, aucune dépendance.
//   node tools/assets-apk.mjs                                   copie, puis affiche le nombre de fichiers
//   node tools/assets-apk.mjs --liste [--variante=debug|release]  affiche seulement la liste attendue dans l'APK de cette
//                                                               variante (chemins relatifs à assets/ ; debug par défaut)
//
// Deux sous-dossiers (2026-11-25) : dist/apk-assets/main (toutes les variantes) et dist/apk-assets/debug (version de mise
// au point seulement, ajouté au jeu de sources « debug » par android/build.gradle.kts). La page d'essai n'est donc plus du
// tout dans l'APK publié, au lieu d'y être seulement non servie.
//
// LISTE BLANCHE EXPLICITE (décision du 2026-11-18 : jamais la racine du dépôt, elle contient tools/.env) :
//   - site/**, sauf site/sw.js (pas de service worker dans l'APK : risque d'ancien code en cache) ;
//   - aucun fichier de local/ (le protocole local est en Kotlin depuis le lot E2) ;
//   - android/essai/** (page d'essai de la coque) : version de mise au point SEULEMENT (absente de l'APK publié).
// Les chemins sont conservés tels quels : l'APK sert https://appassets.androidplatform.net/assets/<chemin>.
//
// Garde-fous : seules des extensions de fichiers web connues sont copiées (un fichier inattendu dans un dossier de la
// liste fait échouer la copie au lieu d'être embarqué) ; les liens symboliques sont refusés ; le dossier de sortie doit
// s'appeler « apk-assets » (il est vidé avant la copie). Même entrée, même sortie : liste triée, aucune date.

import { readdirSync, lstatSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SORTIE_PAR_DEFAUT = join(RACINE, "dist", "apk-assets");

// Dossiers copiés en entier, fichiers copiés un à un, fichiers retirés des dossiers.
export const DOSSIERS = ["site"];
export const DOSSIERS_DEBUG = ["android/essai"]; // jamais dans l'APK publié
export const VARIANTES = ["debug", "release"];
export const FICHIERS = []; // plus de protocole en JavaScript dans l'APK depuis le lot E2 : il tourne dans le code natif
export const EXCLUS = ["site/sw.js"];
// Extensions que la WebView sait servir (voir PontAssets.kt : même liste, type MIME fixé par extension).
export const EXTENSIONS = [".html", ".js", ".mjs", ".css", ".json", ".png", ".webmanifest", ".txt", ".svg", ".ico"];

function aPlat(rel) { return rel.split(sep).join("/"); }

function parcourir(racine, dossier, sortie) {
  for (const nom of readdirSync(join(racine, dossier)).sort()) {
    const rel = `${dossier}/${nom}`;
    const st = lstatSync(join(racine, rel));
    if (st.isSymbolicLink()) throw new Error(`Lien symbolique refusé : ${rel}`);
    if (st.isDirectory()) parcourir(racine, rel, sortie);
    else if (st.isFile()) sortie.push(rel);
    else throw new Error(`Type de fichier refusé : ${rel}`);
  }
}

function verifierExtension(rel) {
  const point = rel.lastIndexOf(".");
  const ext = point > rel.lastIndexOf("/") ? rel.slice(point) : "";
  if (!EXTENSIONS.includes(ext)) throw new Error(`Fichier inattendu dans la liste blanche (extension refusée) : ${rel}`);
}

// Vrai si le fichier n'est embarqué que dans la version de mise au point.
export function seulementDebug(rel) { return DOSSIERS_DEBUG.some((d) => rel.startsWith(`${d}/`)); }

// Liste triée des chemins relatifs (séparateur « / ») embarqués dans l'APK de la variante (debug : tout ; release : sans la
// page d'essai).
export function listerFichiers(racine = RACINE, { variante = "debug" } = {}) {
  if (!VARIANTES.includes(variante)) throw new Error(`Variante inconnue : ${variante}`);
  const liste = [];
  for (const d of variante === "debug" ? [...DOSSIERS, ...DOSSIERS_DEBUG] : DOSSIERS) {
    if (!existsSync(join(racine, d))) throw new Error(`Dossier absent : ${d}`);
    parcourir(racine, d, liste);
  }
  for (const f of FICHIERS) {
    if (!existsSync(join(racine, f))) throw new Error(`Fichier absent : ${f}`);
    if (!lstatSync(join(racine, f)).isFile()) throw new Error(`Type de fichier refusé : ${f}`);
    liste.push(f);
  }
  const retenus = liste.filter((f) => !EXCLUS.includes(f));
  for (const f of retenus) verifierExtension(f);
  return [...new Set(retenus)].sort();
}

export function copierAssets({ racine = RACINE, sortie = SORTIE_PAR_DEFAUT } = {}) {
  const dest = resolve(sortie);
  if (basename(dest) !== "apk-assets") throw new Error("Le dossier de sortie doit s'appeler « apk-assets ».");
  const rel = relative(dest, resolve(racine));
  if (rel === "" || !rel.startsWith("..")) throw new Error("Le dossier de sortie ne peut pas contenir le dépôt.");
  const liste = listerFichiers(racine, { variante: "debug" }); // tout : chaque fichier va dans main/ ou debug/
  rmSync(dest, { recursive: true, force: true });
  for (const f of liste) {
    const cible = join(dest, seulementDebug(f) ? "debug" : "main", ...f.split("/"));
    mkdirSync(dirname(cible), { recursive: true });
    copyFileSync(join(racine, ...f.split("/")), cible);
  }
  return liste;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--liste")) {
      const opt = process.argv.find((a) => a.startsWith("--variante="));
      for (const f of listerFichiers(RACINE, { variante: opt ? opt.slice("--variante=".length) : "debug" })) console.log(f);
    } else {
      const liste = copierAssets();
      console.log(`${liste.length} fichiers copiés vers ${aPlat(relative(RACINE, SORTIE_PAR_DEFAUT))}`);
    }
  } catch (e) {
    console.error(`assets-apk : ${e.message}`);
    process.exit(1);
  }
}
