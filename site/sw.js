// Service worker de Recharge DS 3.
//
// Stratégie : réseau d'abord, repli sur le cache.
// - À l'installation, tous les fichiers de la page sont mis en cache (précache).
// - À chaque requête GET de même origine, on interroge d'abord le réseau en
//   forçant la revalidation du cache HTTP (cache: "no-cache"), puis on met la
//   réponse en cache. Sans réseau (mode avion) ou si le réseau ne répond pas
//   en 4 s, on sert la copie en cache.
// Pourquoi : la page est minuscule et ouverte une fois par soir ; la fraîcheur
// compte plus que quelques centaines de millisecondes. Avec le réseau d'abord,
// une version publiée apparaît dès la première ouverture en ligne, même si
// VERSION n'a pas été incrémentée. Incrémenter VERSION reste la règle à chaque
// publication : cela recrée un cache propre (fichiers retirés, liste du
// précache modifiée) et active immédiatement le nouveau service worker
// (skipWaiting + clients.claim), donc au plus deux ouvertures dans tous les cas.

const VERSION = "v3";
const CACHE = "recharge-ds3-" + VERSION;
const TIMEOUT_MS = 4000;

// Chemins relatifs à l'emplacement de sw.js (donc au scope, local ou /recharge-ds3/).
const PRECACHE = [
  "./",
  "./index.html",
  "./calc.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("recharge-ds3-") && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("délai dépassé")), TIMEOUT_MS);
    fetch(request, { cache: "no-cache" }).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fromNetwork(request)
      .then((response) => {
        if (response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          );
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          // Navigation hors ligne vers une adresse inconnue : on sert la page.
          if (request.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
      )
  );
});
