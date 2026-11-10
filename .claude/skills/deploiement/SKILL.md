---
name: deploiement
description: Publier la page sur GitHub Pages (via GitHub Actions) et déployer le Cloudflare Worker avec ses secrets, sans jamais exposer de secret. À lire avant toute publication ou tout déploiement.
---

# Déploiement

Le chef de projet obtient l'accord de Mathieu **avant** chaque première publication et chaque déploiement en production. Les actions qui demandent les comptes de Mathieu (réglages du dépôt, connexion Cloudflare, saisie des secrets) sont faites par lui : explique-lui la commande exacte.

## Page – GitHub Pages

- Dépôt public `recharge-ds3`. Dossier publié : `site/`.
- Publication par GitHub Actions : `.github/workflows/pages.yml`, déclenché sur `push` vers `main` et à la main (`workflow_dispatch`).
- Le workflow :
  1. récupère le code et installe Node (version LTS) ;
  2. lance `node --test "tests/**/*.test.mjs"` (motif compatible Node 24) : **si un test échoue, rien n'est publié** ;
  3. publie `site/` avec les actions officielles GitHub Pages (`configure-pages`, `upload-pages-artifact`, `deploy-pages`), en utilisant leurs dernières versions majeures (à vérifier sur leur page GitHub au moment d'écrire le workflow) ;
  4. permissions minimales : `contents: read`, `pages: write`, `id-token: write`.
- Réglages à faire par Mathieu : Settings → Pages → Source : **GitHub Actions** ; Settings → Code security → *Secret scanning* et *Push protection* activés ; double authentification sur le compte.
- Épingler les actions tierces sur une version précise (idéalement par empreinte de commit), et donner au workflow les permissions minimales.
- Adresse obtenue : `https://<compte>.github.io/recharge-ds3/`. Tous les chemins de la page, du manifest et du service worker doivent être relatifs à ce sous-chemin.

### Vérifications après publication

- La page répond, le manifest et `sw.js` sont servis (outils de développement de Chrome → Application).
- Chrome sur Android propose l'installation.
- Une modification publiée arrive sur le téléphone (version du cache incrémentée dans `sw.js`).

## Worker – Cloudflare (phase 2b)

- Dossier `worker/` avec `wrangler.toml` : `name`, `main`, `compatibility_date` récente.
- `wrangler` est un outil de développement : `npx wrangler ...`, pas de dépendance d'exécution dans le Worker.
- Développement local : `npx wrangler dev`, secrets lus depuis `worker/.dev.vars` (ignoré par git, créé et rempli par Mathieu).
- Production :
  - connexion par Mathieu : `npx wrangler login` ;
  - secrets saisis par Mathieu, valeur tapée dans le terminal : `npx wrangler secret put TUYA_ACCESS_ID`, puis `TUYA_ACCESS_SECRET`, `TUYA_DEVICE_ID`, `JETON_ACCES` ;
  - variables non secrètes dans `wrangler.toml` : `TUYA_ENDPOINT = "https://openapi.tuyaeu.com"`, `ORIGINE_AUTORISEE = "https://<compte>.github.io"` ;
  - déploiement : `npx wrangler deploy`.
- Limite d'appels et validation stricte des entrées : voir `PLAN.md` phase 2b et `SECURITE.md`. Double authentification sur le compte Cloudflare avant le premier déploiement.
- `JETON_ACCES` : longue chaîne aléatoire générée par Mathieu (par exemple `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`), saisie aussi une fois dans les paramètres de la page sur le Pixel.

## Ce qui ne doit jamais arriver

- Un secret dans un fichier suivi par git, dans un message de commit, dans les journaux du Worker ou dans une réponse renvoyée à la page.
- Une publication de la page alors que les tests échouent.
- Un déploiement du Worker sans jeton obligatoire, sans limite d'appels, ou avec une route qui accepte une commande quelconque.
- Un raisonnement du type « le CORS protège le service » : il ne protège que contre d'autres sites dans un navigateur.

Avant chaque commit : `git status` et `git diff --staged` relus, et recherche de motifs de secrets (`git grep -n -i -E "secret|access_id|token" -- . ':!*.md'`), en vérifiant à la main chaque résultat.
