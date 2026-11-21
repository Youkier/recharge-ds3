// Enregistrement du service worker. Fichier séparé : la page n'a aucun script en ligne (CSP stricte),
// et le service worker s'enregistre même si le module principal échoue.
// Dans l'appli Android (pont natif présent), pas de service worker : les fichiers sont embarqués dans l'APK.
if ("serviceWorker" in navigator && !(window.PontLocal && typeof window.PontLocal.postMessage === "function")) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  });
}
