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
