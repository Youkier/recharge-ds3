# Journal des décisions

| Date | Décision | Raison |
|---|---|---|
| 2026-11-08 | Lecture du SoC à la main dans MyDS, pas d'API Stellantis | API non officielle instable (jetons qui expirent), donnée souvent périmée |
| 2026-11-08 | Prise pilotée par ses propres programmations ; seul le démarrage varie | La nuit, rien ne dépend d'un cloud ni d'un agent |
| 2026-11-08 | Page web plutôt qu'application native | 95 % de l'usage pour 10 % de l'effort ; l'appli native reste une option d'apprentissage |
| 2026-11-09 | Hébergement GitHub Pages, puis Worker Cloudflare pour le pilotage | Gratuit, mises à jour automatiques, secrets hors du téléphone |
| 2026-11-09 | Point d'arrêt Tuya avant tout développement du Worker | Le risque n°1 est un câble non pilotable par l'API |
| 2026-11-09 | Service limité à deux actions, jeton + limite d'appels | Le CORS n'est pas une protection ; limiter ce qu'un jeton volé permet |
| 2026-11-09 | Compte Smart Life principal lié au projet Tuya (pas de compte dédié pour l'instant) | Simplicité de démarrage ; risque accepté : une fuite des clés exposerait tous les appareils du compte. À reconsidérer avant un usage durable |
| 2026-11-09 | Police système à la place de Google Fonts | Hors ligne complet sans fichier de police à embarquer ; validé par Mathieu |
| 2026-11-09 | Défauts de saisie relevés à l'extraction (champ vide → NaN, plan périmé copié, cible non atteinte sans message, prix vide = 0) traités après la phase 1 | Ne pas mêler correction et extraction ; aucun cas de référence concerné |
| 2026-11-09 | Service worker « réseau d'abord, repli sur le cache » (délai 4 s) | Page minuscule ouverte une fois par soir : la fraîcheur prime ; nouvelle version visible dès la 1re ouverture en ligne |
| 2026-11-09 | Publication par GitHub Actions : tests puis déploiement de site/, actions épinglées par empreinte | Rien n'est publié si un cas de référence casse |
| 2026-11-10 | Architecture phase 2 : le service écrit le début de la plage de charge du câble ; le préconditionnement reste une programmation Smart Life fixe | Le câble n'a qu'une plage ; la recharge de nuit repose ainsi sur le mécanisme le plus autonome. **Hypothèse non testée** (test T0 de `PLAN.md`), à confirmer avant la phase 2b |
| 2026-11-10 | T4 en échec = arrêt, sauf dérogation écrite ; ajout de T0 (sans API) et T6 (non-régression) | La règle n°1 ne peut pas être contournée par un simple « à noter » |
| 2026-11-10 | Agents en `model: sonnet` ; tests réels de la phase 2a lancés par la session principale | Coût ; la 2a est un dialogue pas à pas avec Mathieu |
| 2026-11-10 | `.claude/settings.json` : lecture des fichiers de secrets interdite aussi par le terminal ; confirmation imposée pour la sonde, `wrangler deploy`, `wrangler secret` et `git push` | L'interdiction ne couvrait que l'outil de lecture |
| 2026-11-10 | Phase 1bis : vues Paramètres et Aide dans le même `index.html` | Un seul fichier en cache ; prépare les champs de la phase 2c |
| 2026-11-09 | Tests lancés avec le motif `node --test "tests/**/*.test.mjs"` en CI | Node 24 ne parcourt pas un dossier passé en argument (MODULE_NOT_FOUND), Node 26 oui ; le motif marche sur les deux |
| 2026-11-10 | Phase 1bis : navigation par barre d'onglets en bas + ancres (#accueil, #parametres, #aide), saisie invalide = aucun plan ni copie ; clés localStorage inchangées ; SW v2 | Pouce sur Pixel ; retour Android = accueil ; aucune perte de paramètres |
| 2026-11-11 | T0a : la programmation Smart Life « marche à 7h » désactive la plage du câble quand elle se déclenche. Piste à l'essai : plus de programmation à 7h, plage terminée à l'heure du départ. Repli retenu par Mathieu : plage terminée à 06:00, préconditionnement sur la batterie | Un seul mécanisme, rien qui se désactive seul ; le repli ne coûte qu'un peu d'autonomie. **Essai réel et T0b encore à faire** |
| 2026-11-11 | Refonte de l'interface des trois onglets (Ce soir, Paramètres, Aide) ; calcul, valeurs par défaut et clés localStorage inchangés ; placement en boutons radio (mêmes valeurs end/start) ; SW v3 | Lecture en un écran sur le Pixel ; résultats identiques avant/après sur 10 cas ; aucun réglage perdu. Étape Installation 2 de l'aide conservée malgré T0a, à la demande de Mathieu |
