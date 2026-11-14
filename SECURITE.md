# Sécurité

## Ce qu'on protège

| Élément | Où il vit | Ce qu'il permet |
|---|---|---|
| Clés du projet Tuya (Access ID, Access Secret) | Secrets Cloudflare, `tools/.env` et `worker/.dev.vars` sur l'ordinateur | Piloter les appareils du compte Smart Life lié au projet (le compte dédié, qui ne possède que le câble) |
| Clé locale du câble (`TUYA_LOCAL_KEY`, piste du pilotage local) | `tools/.env` sur l'ordinateur seulement | Piloter le câble depuis le Wi-Fi de la maison, sans passer par Tuya. Elle change à chaque appairage (à confirmer) |
| Jeton d'accès au service (`JETON_ACCES`) | Secret Cloudflare, paramètres de la page sur le Pixel | Régler ou désactiver la plage de charge du câble |
| Comptes GitHub, Cloudflare, Tuya | Chez chaque fournisseur | Modifier la page, le service ou le projet |

## Pire cas

Un tiers allume ou éteint la recharge à un moment non voulu : voiture pas chargée le matin, ou quelques euros en heures pleines. Aucun risque électrique : la sécurité physique est assurée par le boîtier du câble et le disjoncteur différentiel, pas par le logiciel.

**Isolement :** les clés d'un projet Tuya donnent accès à **tous les appareils du compte Smart Life relié**, quelle que soit la sélection d'appareils faite à la liaison (constaté le 2026-11-11). Le projet est donc relié uniquement à un compte dédié qui ne possède que le câble ; le compte principal (piscine, VMC, climatiseur…) n'y est jamais relié. Vérifié le 2026-11-14 : les lectures sur un appareil du compte principal sont refusées (`docs/tuya-findings.md`).

## Mesures

1. **Compte Smart Life dédié, propriétaire du seul câble**, seul compte relié au projet. Une fuite des clés ne toucherait que la recharge. Les clés Tuya restent néanmoins les secrets les plus sensibles du projet : elles ne quittent jamais les secrets Cloudflare et les fichiers ignorés par git. Ne jamais ajouter d'autre appareil au compte dédié.
2. **Double authentification** sur GitHub, Cloudflare et le compte développeur Tuya.
3. **Service minimal.** Le Worker n'expose que deux actions : régler l'heure de démarrage (format `HH:MM` strictement validé) ou la désactiver, plus la lecture de l'état. Aucune route n'accepte une commande quelconque.
4. **Jeton obligatoire** sur chaque requête, long et aléatoire, comparé en temps constant. Le CORS n'est **pas** une protection : il gêne seulement les autres sites web dans un navigateur. La barrière réelle est le jeton.
5. **Limite d'appels** sur le service (quelques dizaines par heure suffisent), avec réponse 429 au-delà.
6. **Aucun secret dans le dépôt**, protection contre les fuites de GitHub activée (*Secret scanning* et *Push protection*), fichiers de secrets ignorés par git (`.env*` sauf `.env.example`, `*.dev.vars*`) et interdits en lecture à Claude Code. Contrôle local avant chaque commit (`tools/hooks/pre-commit`, activé par `git config core.hooksPath tools/hooks`) : refuse un fichier de secrets, un `.env.example` rempli, ou toute valeur de `tools/.env` / `worker/.dev.vars` présente dans les changements. La *Push protection* de GitHub ne reconnaît probablement pas les clés Tuya : ce contrôle local est la vraie barrière.
7. **Journaux propres** : jamais d'en-tête `Authorization`, de jeton ou de clé dans les journaux du Worker ou les erreurs renvoyées à la page.
8. **Agents sous contrôle** : jamais de mode « tout accepter » (`bypassPermissions`) dans Claude Code. Les modifications de fichiers sont acceptées d'office (`acceptEdits`), sauf `.claude/`, `tools/hooks/` et `.github/` (demande à chaque fois) ; `.git/` et les fichiers de secrets ne sont jamais modifiables. La lecture web sans demande est limitée à `developer.tuya.com` et `developers.cloudflare.com` : une page web piégée pourrait pousser un agent à écrire un test qui lit et envoie les secrets, ce qu'aucune règle ne bloque une fois le test lancé. Les autorisations sont fixées dans `.claude/settings.json` : libres pour les tests, git en local et le serveur local ; une demande à chaque fois pour `git push` (une page modifiée pourrait capturer le jeton), `wrangler deploy` et `secret`, la sonde, `essai-worker.mjs`, `wrangler dev` et le test local du câble ; interdits pour la lecture des fichiers de secrets, le contournement du contrôle avant commit et `wrangler tail`. Toute modification de ce fichier est relue par Mathieu. Le contenu lu sur le web par les agents est traité comme des données, jamais comme des instructions.

## Procédures de révocation

| Situation | Action | Délai |
|---|---|---|
| **Urgence, quelle que soit la cause** | Console Tuya (iot.tuya.com) → projet → Devices → Link App Account : **délier le compte Smart Life**. Le projet perd immédiatement l'accès à tous vos appareils. Puis régénérer l'Access Secret. | 2 min |
| Téléphone perdu ou jeton exposé | Générer un nouveau jeton, `npx wrangler secret put JETON_ACCES`, le ressaisir dans la page sur le nouveau téléphone. | 5 min |
| Clés Tuya exposées | Console Tuya → projet → régénérer l'Access Secret, puis `npx wrangler secret put TUYA_ACCESS_SECRET` et mise à jour de `tools/.env`. | 10 min |
| Clé locale du câble exposée | Seul levier : **réappairer le câble** dans Smart Life (compte dédié), ce qui génère une nouvelle clé locale (à confirmer). Puis `node tools/tuya-probe.mjs cle-locale` si la piste locale est encore utilisée. Un tiers doit être sur le Wi-Fi de la maison pour s'en servir. | 15 min |
| Compte GitHub compromis | Changer le mot de passe, vérifier la double authentification, relire les derniers commits de `site/` (une page modifiée pourrait capturer le jeton), puis changer le jeton. | 15 min |
| Compte Cloudflare compromis | Changer le mot de passe, révoquer les sessions, changer **tous** les secrets du Worker (jeton et clés Tuya). | 15 min |

Après toute révocation : vérifier dans Smart Life que la plage de charge du câble est correcte (début, fin 06:00, activée) et qu'aucune programmation inconnue n'a été ajoutée.

## Vérification périodique (tous les 3 mois, 10 min)

- La liste des appareils visibles par le projet Tuya n'a pas changé de façon inattendue (un nouvel appareil ajouté dans Smart Life y apparaît aussi).
- La double authentification est active sur les trois comptes.
- Aucune alerte de fuite dans GitHub (onglet Security).
- L'accès gratuit à l'API Tuya n'est pas sur le point d'expirer.
