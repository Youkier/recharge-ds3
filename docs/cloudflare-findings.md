# Résultats vérifiés sur Cloudflare Workers

Source unique : documentation officielle developers.cloudflare.com. Aucun appel réel, aucun compte touché.

## Limite d'appels (lu le 2026-11-14)

Source : https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

- Binding « Rate Limiting » : dans `wrangler.toml`, `[[ratelimits]]` avec `name` (nom du binding, ici `LIMITEUR`), `namespace_id` (entier positif en chaîne, unique dans le compte) et `[ratelimits.simple]` avec `limit` et `period`. `period` ne peut valoir que **10 ou 60** secondes. Wrangler >= 4.36.0 requis.
- Appel : `const { success } = await env.LIMITEUR.limit({ key })` ; `success: false` -> répondre 429.
- Limites propres au mécanisme : compteur **par emplacement Cloudflare** (pas global), approximatif et à cohérence différée. Pour une limite stricte globale, la page recommande un Durable Object (écarté : trop lourd pour ce besoin).
- **Non confirmé : disponibilité sur le plan gratuit.** La page ne le dit pas, et la page des limites des Workers (https://developers.cloudflare.com/workers/platform/limits/) ne mentionne pas ce binding. À vérifier au premier déploiement ; si le binding est refusé, retirer le bloc `[[ratelimits]]` (le Worker retombe sur son repli) ou utiliser une règle de limitation de débit WAF de la zone (non étudiée ici, nécessite un domaine).

Choix : 10 appels par période de 60 s, clé fixe (`service`), après contrôle du jeton. C'est plus large que « quelques dizaines par heure » (la période est limitée à 60 s) mais borne un client abusif ; l'usage normal est de quelques appels par soir.

Repli sans binding (`wrangler dev` local, ou binding absent) : fenêtre glissante en mémoire, 30 appels par heure par instance, avec un `console.warn` unique (`limiteur_absent`). Approximatif (chaque instance a son compteur) : **ne pas compter dessus en production**.

## Limites du plan gratuit (lu le 2026-11-14)

Source : https://developers.cloudflare.com/workers/platform/limits/ : 100 000 requêtes par jour, 10 ms de CPU par requête HTTP, 50 sous-requêtes par requête. Une programmation fait au plus 1 (jeton) + 1 lecture + 1 écriture + 3 relectures = 6 sous-requêtes ; le temps d'attente de Tuya n'est pas du temps CPU (à confirmer en réel : la signature HMAC et la lecture JSON restent très en deçà de 10 ms en principe).
