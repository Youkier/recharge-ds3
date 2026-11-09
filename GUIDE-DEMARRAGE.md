# Guide de démarrage

Ce guide vous emmène de zéro à la page installée sur votre Pixel (phase 1), puis jusqu'au bouton « Programmer la prise » (phase 2). À chaque étape : ce que **vous** faites, et le message à **coller dans Claude Code**.

Comptez une soirée pour la phase 1, une soirée pour le point d'arrêt Tuya, une à deux soirées pour la suite.

---

## Étape 0 – Préparer l'ordinateur (20 min)

1. **Installer Git** : https://git-scm.com (sous Windows, Git for Windows, qui permet aussi à Claude Code d'utiliser un vrai terminal).
2. **Installer Node.js 20 ou plus** (version LTS) : https://nodejs.org. Il sert aux tests et au Worker.
3. **Installer Claude Code** :
   - Windows (PowerShell) : `irm https://claude.ai/install.ps1 | iex`
   - macOS / Linux : `curl -fsSL https://claude.ai/install.sh | bash`
   - Fermez puis rouvrez le terminal, et vérifiez avec `claude --version`.
4. **Installer GitHub CLI** (facultatif mais pratique) : https://cli.github.com, puis `gh auth login`.
5. **Activer la double authentification** sur votre compte GitHub (Settings → Password and authentication).

## Étape 1 – Créer le dépôt (10 min)

1. Sur github.com : **New repository**, nom `recharge-ds3`, **Public** (nécessaire pour GitHub Pages gratuit ; rien de secret n'y sera stocké).
2. Dans le dépôt : Settings → Code security → activez **Secret scanning** et **Push protection**. GitHub bloquera un envoi qui contiendrait une clé reconnue.
3. Clonez-le sur votre ordinateur, puis copiez **tout le contenu de ce kit** dedans (y compris le dossier caché `.claude`).
4. Ouvrez un terminal dans le dossier et lancez `claude`. Connectez-vous avec votre compte Claude à la première ouverture.

## Étape 2 – Lancer le chef de projet

Collez ce message :

> Lis CLAUDE.md, PLAN.md et GUIDE-DEMARRAGE.md. Tu es le chef de projet. Vérifie que les sous-agents et les skills sont bien chargés (/agents), puis fais la phase 0 : contrôle l'environnement (git, node), fais le premier commit du kit et pousse-le. Ensuite, présente-moi ton découpage de la phase 1 en tâches, avec l'agent prévu pour chacune, et attends mon accord avant de commencer.

Si les agents n'apparaissent pas, quittez Claude Code et relancez-le dans le dossier : ils sont chargés au démarrage.

## Étape 3 – Phase 1 : la page en ligne

Après avoir validé le découpage :

> OK pour ce découpage. Exécute la phase 1 en déléguant aux sous-agents. Après chaque tâche, fais vérifier par testeur-relecteur. Arrête-toi avant d'activer GitHub Pages et dis-moi exactement quoi régler dans les paramètres du dépôt.

**Ce que vous ferez sur GitHub** (le chef de projet vous le confirmera) : Settings → Pages → Source : **GitHub Actions**.

**Sur le Pixel** une fois l'adresse publiée :

1. Ouvrez `https://<votre-compte>.github.io/recharge-ds3/` dans Chrome.
2. Menu ⋮ → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. Ressaisissez vos paramètres une fois s'ils diffèrent des valeurs par défaut.
4. Testez en mode avion.

Puis dans Claude Code :

> J'ai testé sur le Pixel : [ce qui marche / ce qui ne marche pas]. Coche les critères d'acceptation de la phase 1 qui sont validés et propose la suite.

**À ce stade, l'objectif 1 est atteint.** Vous pouvez supprimer le raccourci Shortcut Maker.

## Étape 4 – Phase 2a : le point d'arrêt Tuya

> Passe à la phase 2a. Guide-moi pas à pas pour créer le compte développeur Tuya, le projet cloud et la liaison avec mon compte Smart Life. Pendant ce temps, fais préparer la sonde tools/tuya-probe.mjs par tuya-integrateur. Ne lance aucun appel tant que je n'ai pas rempli tools/.env.

**Ce que vous ferez** (environ 45 min, guidé) :

1. Créer le compte sur iot.tuya.com (avec double authentification) et un projet cloud (centre de données Central Europe).
2. Lier votre compte Smart Life au projet en scannant le QR code depuis l'appli. Les clés du projet auront alors accès à **tous** les appareils de ce compte : c'est pourquoi elles ne doivent jamais sortir des fichiers prévus.
3. Remplir `tools/.env` avec l'Access ID, l'Access Secret et l'identifiant du câble. **Ne collez jamais ces valeurs dans la conversation** : écrivez-les directement dans le fichier.

> tools/.env est rempli. Lance les tests T1 à T3 du point d'arrêt et note les résultats dans docs/tuya-findings.md.

Les tests T4 (internet coupé) et T5 (voiture branchée depuis 2 h) demandent votre présence : le chef de projet vous dira quand et comment.

**Décision :** si un test bloquant échoue, on s'arrête là. Votre page en ligne reste pleinement utilisable avec le réglage manuel.

## Étape 5 – Phases 2b et 2c : le Worker et le bouton

Seulement si la phase 2a est validée :

1. Créez un compte gratuit sur https://dash.cloudflare.com et activez la double authentification.
2. Dans Claude Code :

> Phase 2a validée. Lance les phases 2b puis 2c selon PLAN.md. Arrête-toi avant le premier déploiement du Worker et avant d'ajouter les secrets, et explique-moi les commandes que je dois lancer moi-même.

Vous lancerez vous-même `npx wrangler login` et les commandes `npx wrangler secret put ...`, en tapant les valeurs directement dans le terminal.

Sur le Pixel : Paramètres de la page → adresse du service et jeton d'accès, puis un premier essai de « Programmer la prise », vérifié dans Smart Life.

---

## Bonnes pratiques pendant le projet

- **Gardez la main sur les décisions.** Le chef de projet propose, vous validez. Refusez une proposition qui complique sans raison.
- **Une phase par session.** Ouvrez une nouvelle session Claude Code pour chaque phase : le contexte reste léger, et `CLAUDE.md` + `PLAN.md` suffisent à reprendre.
- **Vérifiez vous-même ce qui compte** : l'heure affichée sur la page pour un cas que vous connaissez, la programmation réelle dans Smart Life.
- **Surveillez votre consommation.** Plusieurs agents consomment plus vite votre quota. Si une tâche tourne en rond, interrompez (Échap) et recadrez.
- **Pas de mode « tout accepter » en phase 2.** Validez vous-même chaque commande qui touche à la prise, aux secrets ou au déploiement.
- **Lisez `SECURITE.md` une fois** et gardez en tête le geste d'urgence : dans la console Tuya, délier votre compte Smart Life du projet coupe tout accès en deux minutes.
- **Le mode manuel reste votre filet de sécurité** : programmation fixe d'extinction à 06h00, rallumage pour le préconditionnement et réglage manuel possible à tout moment dans Smart Life.

## En cas de problème

| Symptôme | Message à donner au chef de projet |
|---|---|
| Un agent invente un endpoint Tuya | « Vérifie cette information dans la documentation officielle ou par un appel réel, et note la source dans docs/tuya-findings.md. » |
| Les tests échouent après une modification | « Fais diagnostiquer par testeur-relecteur sans modifier les cas de référence. » |
| La page ne se met pas à jour sur le téléphone | « Vérifie la version du cache dans sw.js et la stratégie de mise à jour. » |
| Ça part dans tous les sens | « Stop. Résume où on en est par rapport à PLAN.md et propose la prochaine petite étape. » |
