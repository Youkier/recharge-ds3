// Enregistrement du service worker. Fichier séparé : la page n'a aucun script en ligne (CSP stricte),
// et le service worker s'enregistre même si le module principal échoue.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  });
}
