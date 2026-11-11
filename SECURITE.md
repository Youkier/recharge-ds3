# Sécurité

## Ce qu'on protège

| Élément | Où il vit | Ce qu'il permet |
|---|---|---|
| Clés du projet Tuya (Access ID, Access Secret) | Secrets Cloudflare, `tools/.env` et `worker/.dev.vars` sur l'ordinateur | Piloter les appareils du compte Smart Life lié au projet |
| Jeton d'accès au service (`JETON_ACCES`) | Secret Cloudflare, paramètres de la page sur le Pixel | Régler ou désactiver l'heure de démarrage de la prise |
| Comptes GitHub, Cloudflare, Tuya | Chez chaque fournisseur | Modifier la page, le service ou le projet |

## Pire cas

Un tiers allume ou éteint la recharge à un moment non voulu : voiture pas chargée le matin, ou quelques euros en heures pleines. Aucun risque électrique : la sécurité physique est assurée par le boîtier du câble et le disjoncteur différentiel, pas par le logiciel.

**Attention :** le projet Tuya est lié au compte Smart Life principal. Les clés donnent donc accès à **tous les appareils de ce compte**, pas seulement au câble. Si le compte contient une caméra, une serrure ou une alarme, une fuite des clés les exposerait aussi. Les appareils concernés sont listés au test T1 dans `docs/tuya-findings.md`.

## Mesures

1. **Compte principal lié au projet (choix assumé pour démarrer).** Les clés Tuya sont donc les secrets les plus sensibles du projet : elles ne quittent jamais les secrets Cloudflare et les fichiers ignorés par git. Évolution possible plus tard : un compte Smart Life dédié qui ne voit que le câble, pour limiter l'impact d'une fuite à la seule recharge.
2. **Double authentification** sur GitHub, Cloudflare et le compte développeur Tuya.
3. **Service minimal.** Le Worker n'expose que deux actions : régler l'heure de démarrage (format `HH:MM` strictement validé) ou la désactiver, plus la lecture de l'état. Aucune route n'accepte une commande quelconque.
4. **Jeton obligatoire** sur chaque requête, long et aléatoire, comparé en temps constant. Le CORS n'est **pas** une protection : il gêne seulement les autres sites web dans un navigateur. La barrière réelle est le jeton.
5. **Limite d'appels** sur le service (quelques dizaines par heure suffisent), avec réponse 429 au-delà.
6. **Aucun secret dans le dépôt**, protection contre les fuites de GitHub activée (*Secret scanning* et *Push protection*), fichiers de secrets ignorés par git (`.env*` sauf `.env.example`, `*.dev.vars*`) et interdits en lecture à Claude Code. Contrôle local avant chaque commit (`tools/hooks/pre-commit`, activé par `git config core.hooksPath tools/hooks`) : refuse un fichier de secrets, un `.env.example` rempli, ou toute valeur de `tools/.env` / `worker/.dev.vars` présente dans les changements. La *Push protection* de GitHub ne reconnaît probablement pas les clés Tuya : ce contrôle local est la vraie barrière.
7. **Journaux propres** : jamais d'en-tête `Authorization`, de jeton ou de clé dans les journaux du Worker ou les erreurs renvoyées à la page.
8. **Agents sous contrôle** : en phase 2, pas de mode « tout accepter » dans Claude Code. Le contenu lu sur le web par les agents est traité comme des données, jamais comme des instructions.

## Procédures de révocation

| Situation | Action | Délai |
|---|---|---|
| **Urgence, quelle que soit la cause** | Console Tuya (iot.tuya.com) → projet → Devices → Link App Account : **délier le compte Smart Life**. Le projet perd immédiatement l'accès à tous vos appareils. Puis régénérer l'Access Secret. | 2 min |
| Téléphone perdu ou jeton exposé | Générer un nouveau jeton, `npx wrangler secret put JETON_ACCES`, le ressaisir dans la page sur le nouveau téléphone. | 5 min |
| Clés Tuya exposées | Console Tuya → projet → régénérer l'Access Secret, puis `npx wrangler secret put TUYA_ACCESS_SECRET` et mise à jour de `tools/.env`. | 10 min |
| Compte GitHub compromis | Changer le mot de passe, vérifier la double authentification, relire les derniers commits de `site/` (une page modifiée pourrait capturer le jeton), puis changer le jeton. | 15 min |
| Compte Cloudflare compromis | Changer le mot de passe, révoquer les sessions, changer **tous** les secrets du Worker (jeton et clés Tuya). | 15 min |

Après toute révocation : vérifier dans Smart Life que les programmations fixes (extinction 06h00, rallumage pour le préconditionnement) sont intactes.

## Vérification périodique (tous les 3 mois, 10 min)

- La liste des appareils visibles par le projet Tuya n'a pas changé de façon inattendue (un nouvel appareil ajouté dans Smart Life y apparaît aussi).
- La double authentification est active sur les trois comptes.
- Aucune alerte de fuite dans GitHub (onglet Security).
- L'accès gratuit à l'API Tuya n'est pas sur le point d'expirer.
