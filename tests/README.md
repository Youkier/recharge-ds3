`golden-cases.json` : sorties exactes de la page validée le 08/11/2026, à reproduire par toute réimplémentation. Ne pas modifier les valeurs attendues.

En local, servir la page en HTTP (`python -m http.server -d site 8080` ou `npx serve site`), pas en `file://` : le module `calc.js` et le service worker ne fonctionnent pas en `file://`.

À chaque publication, incrémenter `VERSION` dans `site/sw.js` (et ajouter à `PRECACHE` tout nouveau fichier de la page). Le service worker passe par le réseau d'abord, donc une modification arrive même sans cela, mais la nouvelle version recrée un cache propre et s'active immédiatement. Après modification du motif des icônes : `node tools/gen-icons.mjs`.
