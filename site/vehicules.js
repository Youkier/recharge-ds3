// Liste des véhicules (marque → modèle → version → capacité utile), sans accès au DOM.
// Données : site/vehicules.json, généré par tools/gen-vehicules.mjs depuis Open EV Data.

// Garde uniquement les lignes bien formées : [marque, modèle, version, capacité en kWh].
export function lignesValides(doc) {
  var v = doc && Array.isArray(doc.v) ? doc.v : [];
  return v.filter(function (r) {
    return Array.isArray(r) && r.length === 4 &&
      typeof r[0] === "string" && r[0] && typeof r[1] === "string" && r[1] && typeof r[2] === "string" && r[2] &&
      typeof r[3] === "number" && isFinite(r[3]) && r[3] > 0 && r[3] <= 250;
  });
}

function uniques(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

export function marques(lignes) {
  return uniques(lignes.map(function (r) { return r[0]; })).sort(function (a, b) { return a.localeCompare(b, "fr"); });
}

// Ordre du fichier conservé (modèles triés, versions les plus récentes d'abord).
export function modeles(lignes, marque) {
  return uniques(lignes.filter(function (r) { return r[0] === marque; }).map(function (r) { return r[1]; }));
}

export function versions(lignes, marque, modele) {
  return lignes.filter(function (r) { return r[0] === marque && r[1] === modele; })
    .map(function (r) { return { libelle: r[2], cap: r[3] }; });
}

export function trouver(lignes, choix) {
  if (!choix) return null;
  for (var i = 0; i < lignes.length; i++) {
    var r = lignes[i];
    if (r[0] === choix.marque && r[1] === choix.modele && r[2] === choix.version) return { marque: r[0], modele: r[1], version: r[2], cap: r[3] };
  }
  return null;
}
