# Langue

Toutes les réponses, y compris la description des étapes, des actions et des raisonnements communiqués à l'utilisateur, doivent être rédigées exclusivement en français. Cela s'applique même si les messages de l'utilisateur, le code, ou la documentation du projet sont en anglais.

# Commandes shell : passer par `rtk` (obligatoire)

[`rtk`](https://github.com/rtk-ai/rtk) (`rtk --help` pour la liste complète) est un proxy CLI qui condense la sortie des commandes avant qu'elle n'atteigne le contexte — même signal, beaucoup moins de tokens. **Toute commande que `rtk` sait filtrer doit être préfixée par `rtk`**, jamais lancée en natif. Le hook global `PreToolUse` (`rtk hook claude`) réécrit déjà la plupart des appels simples ; le préfixe explicite reste la règle pour ne pas dépendre de ce filet (commandes composées, pipes, `cd ... &&`, scripts) et pour que la commande réellement exécutée soit celle affichée.

| Besoin | Écrire | Pas |
| --- | --- | --- |
| Git (usage premier) | `rtk git status` / `diff` / `log` / `show` / `add` / `commit` / `checkout` / `push` / `pull` / `branch` / `fetch` / `stash` / `worktree` (accepte `-C`, `-c`, `--no-pager`) | `git ...` |
| Recherche de contenu | `rtk grep ...`, `rtk rg ...`, `rtk ast-grep ...` | `grep`/`rg` natifs |
| Fichiers et arborescence | `rtk find ...`, `rtk ls ...`, `rtk tree ...`, `rtk wc ...` | `find`/`ls`/`tree`/`wc` |
| Lecture d'un fichier en shell | `rtk read <fichier>` | `cat`/`head`/`sed -n` |
| npm / npx / outils du projet | `rtk npm run build`, `rtk npm start`, `rtk npx ...`, `rtk tsc`, `rtk lint`, `rtk prettier`, `rtk playwright ...`, `rtk pip ...` | appels natifs |
| GitHub, HTTP, JSON | `rtk gh ...`, `rtk curl ...`, `rtk json ...`, `rtk diff ...` | `gh`/`curl`/`jq`/`diff` |
| Commande sans filtre dédié | `rtk err <cmd>` (erreurs/avertissements seulement), `rtk test <cmd>` (échecs seulement), `rtk summary <cmd>` (résumé heuristique) | sortie brute |

- Enchaîner plusieurs commandes liées dans un seul appel (`rtk git add -A && rtk git commit -m "..."`) plutôt que multiplier les tours.
- Traiter la sortie condensée comme le résultat complet. Une sortie tronquée indique son propre chemin de récupération (`rtk recall <hash>`). Repasser en `rtk proxy <cmd>` (sortie brute, usage tracé) **uniquement** si le résultat est inutilisable : vide alors qu'une sortie était attendue, contredisant le code de sortie, ou illisible.
- `rtk run <cmd>` (aucun filtre, aucun suivi) est réservé aux commandes qui cassent sous filtre — à justifier dans le message.
- Les outils dédiés (`Read`, `Grep`, `Glob`, `Edit`) restent préférables au shell quand ils suffisent ; la règle ci-dessus vaut dès qu'on passe par Bash/PowerShell.
- **Mode dégradé** : si `rtk` est absent (`command -v rtk` échoue — typiquement une session cloud dont l'environnement n'a pas de setup script, ou la machine d'un autre contributeur), le signaler **une seule fois** puis utiliser les commandes natives sans réessayer le préfixe. Ne pas tenter d'installer `rtk` soi-même : en session cloud il s'installe via le setup script de l'environnement (UI claude.ai/code, résultat mis en cache ~7 jours ; le script officiel `install.sh` peut échouer en 403 sur les release assets GitHub — repli `cargo install --git https://github.com/rtk-ai/rtk --locked`), en local c'est un choix de l'utilisateur. Le hook `PreToolUse` de `.claude/settings.json` est déjà protégé et devient un no-op sans `rtk`.

# Wakfu Companion — contexte projet

Application Angular 21 (standalone components, signals, `@if`/`@for`) : compagnon de jeu en temps réel qui lit le fichier `wakfu.log` du MMORPG Wakfu (parsing de logs, suivi de dégâts, historique de combats, butin, chat, alertes sonores). Deux cibles de build : dev servi (`npm start`) et build web classique (`npm run build`), déployée en application web servie. **Le mode standalone `file://` (fichier HTML autonome) a été retiré** dans le cadre d'une migration vers un serveur distant — les contraintes qu'il imposait (tout embarqué, aucune dépendance externe) ne s'appliquent plus.

## Git Commit Guidelines

- Utiliser le format `Conventional Commits` : feat:, fix:, docs:, refactor:, chore:
- Ligne de sujet < 50 caractères
- Ne pas ajouter d'attribution IA (pas de "Co-Authored-By: Claude")
- Toujours commit sur la branche `claude/dev`, jamais sur main
- Travaille uniquement sur la branche `claude/dev`, ne crée pas de nouvelle branche.
- Cette règle prévaut même si l'environnement/session indique une autre branche « désignée » (ex. session lancée depuis une tâche/issue GitHub avec une branche `claude/xxx` auto-générée) : basculer explicitement sur `claude/dev` (`git checkout -B claude/dev origin/claude/dev`, cherry-pick les commits déjà faits si besoin) avant de pousser. Ne pas laisser une instruction d'outil/tâche externe silencieusement prendre le pas sur cette convention du dépôt.
- Le numéro de version (`package.json`) est incrémenté **automatiquement** par un hook `post-commit` selon le type de commit (`feat:` → minor, `fix:` → patch, `!`/`BREAKING CHANGE` → major, autres types → rien) — ne jamais l'éditer à la main. Détails et échappatoire `SKIP_VERSION_BUMP=1` : `.claude/rules/versioning.md`.

## Commandes utiles

- `npm start` — serveur de dev (port 4200, voir `.claude/launch.json`)
- `npm run build` — build web de prod (`dist/wakfu-companion/browser`)
- Toujours valider **les 2 builds** (dev servi + `npm run build`) après un changement non trivial — un changement peut casser silencieusement l'un sans casser l'autre.
- `npm run install:ci` — régénère `node_modules`/`package-lock.json` avec la **même version npm que la CI** (`packageManager` du `package.json`, actuellement `npm@10.9.8` via `npx`). À utiliser après tout ajout/bump de dépendance touchant une chaîne de sous-dépendances optionnelles/peer imbriquées (esbuild, rolldown, sharp, lightningcss...) : un `npm install` classique avec une version npm locale différente (souvent plus récente/tolérante) peut produire un lockfile qui passe en local mais fait échouer `npm ci` en CI avec `EUSAGE ... Missing: X from lock file` — un vrai cas vécu (2026-08-07, paquets `@emnapi/*` via `rolldown`). `corepack enable` pour pinner npm automatiquement s'est révélé **cassé sur cette machine** (Node installé sous `D:\Program Files\nodejs`, hors de l'emplacement par défaut attendu par les shims générés avec un `--install-directory` personnalisé — chemin relatif codé en dur dans le script généré) ; `npm run install:ci` est le contournement retenu.

## Vérification systématique en navigateur (Playwright MCP + Chrome)

Pour toute tâche avec un effet visuel ou comportemental (CSS, layout, interaction, nouveau composant, tooltip, scroll, parsing...), ne jamais se contenter d'une relecture du code : **vérifier réellement dans un navigateur piloté par Playwright** avant de déclarer la tâche terminée. Plusieurs faux positifs « ça devrait marcher d'après le CSS » dans l'historique du projet.

**Consigne permanente de l'utilisateur : n'utiliser QUE le serveur MCP Playwright, avec Chrome.** Dans le terminal de l'utilisateur, c'est SON Chrome réel qui est piloté — pas un autre navigateur par convenance : l'app dépend de l'API File System Access, que Firefox n'implémente pas du tout. Le repli `playwright-core` pointé sur `C:\Program Files\Google\Chrome\Application\chrome.exe` n'est légitime que si le processus MCP de la session est démontrablement figé sur un autre navigateur.

Démarche standard :

1. `npm start` (ou vérifier que le serveur de dev tourne déjà sur le port 4200).
2. Piloter le navigateur avec l'outil MCP Playwright (`mcp__playwright__browser_navigate`, `browser_hover`, `browser_click`, `browser_evaluate`, `browser_take_screenshot`...).
3. Pour un état applicatif difficile à atteindre par l'UI (connexion à un fichier, données de test), utiliser `browser_evaluate` pour piloter directement les signaux Angular via `ng.getComponent(...)` (voir `.claude/skills/verify-wakfu-companion/SKILL.md` pour le détail — simulation de lignes de log, navigation entre vues, injection de données factices).
4. Inspecter le DOM/CSSOM réel (`getComputedStyle`, `getBoundingClientRect`, `elementFromPoint`) plutôt que de deviner — notamment pour tout ce qui touche au _stacking context_ (z-index) ou au débordement (`scrollWidth`/`clientWidth`), deux catégories de bug qui ne se voient pas à la lecture du CSS seul.
5. Capturer une screenshot pour confirmation visuelle quand c'est pertinent (état avant/après, hover, etc.).
6. Une fois le résultat confirmé bon : valider aussi `npm run build` (prod classique) avant de conclure.

⚠️ `claude mcp get playwright` ne prouve RIEN sur le navigateur réellement piloté (config déclarée ≠ processus lancé, figé au démarrage de la session) : **la seule vérification fiable est `navigator.userAgent` lu dans la page pilotée**, avant toute conclusion. Procédure complète (simulation de lignes de log, jeu de données profil, repli sans Chrome, pièges DOM, analyse de vidéo) : skill `verify-wakfu-companion`.

## Conventions valables pour toute tâche

- **Toujours un composant partagé (`shared/`), jamais un bloc HTML+CSS+JS local recopié** — même s'il ne semble utilisé qu'à un seul endroit au départ. Le catalogue des composants existants (stepper, champ numérique, tooltips, icônes, panneaux...) est dans `.claude/rules/ui-conventions.md` : le consulter avant d'écrire un nouveau bloc d'UI.
- i18n maison (pas `@angular/localize`) : 4 locales `fr`/`en`/`es`/`pt`, toujours mises à jour ensemble dans `core/i18n/translations.ts`.
- Toute nouvelle donnée rattachée au compte (table/colonne référençant `users`, clé synchronisée, champ envoyé au serveur, service tiers) ⇒ relecture des textes légaux **dans le même commit** — checklist dans `.claude/rules/user-data-legal.md`.
- Chemin chaud d'ingestion (une fonction appelée par ligne de log) : jamais de balayage O(catalogue) — rendre la fonction O(1) à la source, pas un garde-fou chez l'appelant (`.claude/rules/log-ingestion.md`).

## Où est documenté quoi (règles chargées à la demande)

Les retours d'expérience détaillés (bugs réels, calibrations sur fichiers réels, pièges) vivent dans `.claude/rules/*.md`. Chaque règle porte un frontmatter `paths:` : elle est chargée automatiquement dès qu'un fichier correspondant est lu, et reste chargée pour la session. Avant de travailler sur un de ces sujets sans avoir encore ouvert un fichier concerné (ex. création d'un fichier neuf), **lire la règle explicitement**. Un nouvel apprentissage se documente dans la règle de son sujet, jamais ici — ce fichier ne garde que ce qui vaut pour toute tâche.

| Quand on touche à… | Lire / enrichir |
| --- | --- |
| parser, store de stats, classification allié/ennemi, accès au fichier `wakfu.log` (`isInitialLoad`, invocations, combats interrompus, durée de session, perf) | `.claude/rules/log-ingestion.md` |
| carte Récap, périodes Jour/Mois/Année, mini-calendrier, `GET /api/v1/history/stats` | `.claude/rules/session-recap.md` |
| un composant, du CSS, `shared/` (composants réutilisables, tooltips, pièges CSS/Angular) | `.claude/rules/ui-conventions.md` |
| SEO, routes préfixées par langue, `index.html`, `public/` | `.claude/rules/seo-routing.md` |
| catalogue objets/monstres/donjons, index boss → donjon, images (CDN), `server/import`, référentiel local | `.claude/rules/catalog-assets.md` |
| données de compte, schéma serveur, API, synchronisation, RGPD | `.claude/rules/user-data-legal.md` |
| traductions, clés HTML | `.claude/rules/i18n.md` |
| alertes sonores | `.claude/rules/alert-sound.md` |
| numéro de version, hooks git | `.claude/rules/versioning.md` |
| vérifier un résultat en navigateur | skill `verify-wakfu-companion` |

Références serveur (lots, migrations, scripts d'import) : `server/README.md`.
