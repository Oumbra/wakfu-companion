# Langue

Toutes les réponses, y compris la description des étapes, des actions et des raisonnements communiqués à l'utilisateur, doivent être rédigées exclusivement en français. Cela s'applique même si les messages de l'utilisateur, le code, ou la documentation du projet sont en anglais.

# Mode full confiance (commandes shell)

Ne jamais demander d'autorisation avant d'exécuter une commande Bash/Shell/Python/Npm/Node dont l'objectif est de répondre à une demande liée à ce projet (build, tests, scripts de vérification navigateur, installation de dépendances, inspection git en lecture, etc.). Exécuter ces commandes directement tant qu'elles ne compromettent pas l'intégrité de l'environnement OS ou du dépôt (pas de suppression destructive hors zone de travail temporaire, pas de force-push, pas de `git reset --hard`/`git clean -f` sans confirmation explicite, pas de modification de configuration système). Le détail des règles d'autorisation associées est dans `.claude/settings.json` (allowlist partagée par l'équipe) — l'étendre si une nouvelle commande de dev récurrente et sûre apparaît, plutôt que de laisser le prompt d'autorisation se répéter à chaque session.

# Wakfu Companion — contexte projet

Application Angular 21 (standalone components, signals, `@if`/`@for`) : compagnon de jeu en temps réel qui lit le fichier `wakfu.log` du MMORPG Wakfu (parsing de logs, suivi de dégâts, historique de combats, butin, chat, alertes sonores). Deux cibles de build : dev servi (`npm start`) et build web classique (`npm run build`), déployée en application web servie. **Le mode standalone `file://` (fichier HTML autonome) a été retiré** dans le cadre d'une migration vers un serveur distant (voir `docs/plan-migration-serveur.md`) — les contraintes qu'il imposait (tout embarqué, aucune dépendance externe) ne s'appliquent plus.

## Git Commit Guidelines

- Utiliser le format `Conventional Commits` : feat:, fix:, docs:, refactor:, chore:
- Ligne de sujet < 50 caractères
- Ne pas ajouter d'attribution IA (pas de "Co-Authored-By: Claude")
- Toujours commit sur la branche `claude/dev`, jamais sur main
- Travaille uniquement sur la branche `claude/dev`, ne crée pas de nouvelle branche.
- Cette règle prévaut même si l'environnement/session indique une autre branche « désignée » (ex. session lancée depuis une tâche/issue GitHub avec une branche `claude/xxx` auto-générée) : basculer explicitement sur `claude/dev` (`git checkout -B claude/dev origin/claude/dev`, cherry-pick les commits déjà faits si besoin) avant de pousser. Ne pas laisser une instruction d'outil/tâche externe silencieusement prendre le pas sur cette convention du dépôt.

## Commandes utiles

- `npm start` — serveur de dev (port 4200, voir `.claude/launch.json`)
- `npm run build` — build web de prod (`dist/wakfu-companion/browser`)
- Toujours valider **les 2 builds** (dev servi + `npm run build`) après un changement non trivial — un changement peut casser silencieusement l'un sans casser l'autre.
- `npm run install:ci` — régénère `node_modules`/`package-lock.json` avec la **même version npm que la CI** (`packageManager` du `package.json`, actuellement `npm@10.9.8` via `npx`). À utiliser après tout ajout/bump de dépendance touchant une chaîne de sous-dépendances optionnelles/peer imbriquées (esbuild, rolldown, sharp, lightningcss...) : un `npm install` classique avec une version npm locale différente (souvent plus récente/tolérante) peut produire un lockfile qui passe en local mais fait échouer `npm ci` en CI avec `EUSAGE ... Missing: X from lock file` — un vrai cas vécu (2026-08-07, paquets `@emnapi/*` via `rolldown`). `corepack enable` pour pinner npm automatiquement s'est révélé **cassé sur cette machine** (Node installé sous `D:\Program Files\nodejs`, hors de l'emplacement par défaut attendu par les shims générés avec un `--install-directory` personnalisé — chemin relatif codé en dur dans le script généré) ; `npm run install:ci` est le contournement retenu.

## Vérification systématique des résultats via Playwright (MCP)

Pour toute tâche avec un effet visuel ou comportemental (CSS, layout, interaction, nouveau composant, tooltip, scroll...), ne jamais se contenter d'une relecture du code : **vérifier réellement dans un navigateur piloté par Playwright** avant de déclarer la tâche terminée. La confiance "ça devrait marcher d'après le CSS" a produit plusieurs faux positifs dans l'historique du projet (ex. z-index du header, clipping de grille CSS, tooltip natif invisible).

**Consigne permanente de l'utilisateur : n'utiliser QUE le serveur MCP Playwright, avec Chrome comme navigateur.** Quand la session s'exécute dans le terminal de l'utilisateur (pas un environnement cloud/sandbox distant sans accès à sa machine), c'est SON Chrome réel qui doit être piloté — pas un binaire Playwright isolé, pas un autre navigateur par convenance. Le repli `playwright-core` documenté plus bas (pointé sur `C:\Program Files\Google\Chrome\Application\chrome.exe`, un VRAI Chrome donc toujours conforme à cette consigne) reste légitime uniquement quand le processus MCP de la session est démontrablement figé sur un autre navigateur (voir plus bas) — jamais un choix par défaut ou de confort.

Démarche standard :

1. `npm start` (ou vérifier que le serveur de dev tourne déjà sur le port 4200).
2. Piloter le navigateur avec l'outil MCP Playwright (`mcp__playwright__browser_navigate`, `browser_hover`, `browser_click`, `browser_evaluate`, `browser_take_screenshot`...).
3. Pour un état applicatif difficile à atteindre par l'UI (connexion à un fichier, données de test), utiliser `browser_evaluate` pour piloter directement les signaux Angular via `ng.getComponent(...)` (voir `.claude/skills/verify-wakfu-companion/SKILL.md` pour le détail — simulation de lignes de log, navigation entre vues, injection de données factices).
4. Inspecter le DOM/CSSOM réel (`getComputedStyle`, `getBoundingClientRect`, `elementFromPoint`) plutôt que de deviner — notamment pour tout ce qui touche au _stacking context_ (z-index) ou au débordement (`scrollWidth`/`clientWidth`), deux catégories de bug qui ne se voient pas à la lecture du CSS seul.
5. Capturer une screenshot pour confirmation visuelle quand c'est pertinent (état avant/après, hover, etc.).
6. Une fois le résultat confirmé bon : valider aussi `npm run build` (prod classique) avant de conclure.

**Chrome/Chromium est le navigateur à utiliser en priorité, pas un simple confort** : l'app dépend de l'API File System Access (`showOpenFilePicker`, `getAsFileSystemHandle` — voir gotcha dédié plus bas) pour toute connexion réelle au fichier `wakfu.log`, et **Firefox n'implémente pas du tout cette API** (pas une histoire d'automatisation plus difficile : la fonctionnalité elle-même y est absente). Un test mené sous Firefox ne peut donc JAMAIS exercer un vrai chemin FSA (bouton de connexion, glisser-déposer d'un handle) — seule la voie de contournement « pousser des lignes synthétiques sur `newLines$` » (voir `.claude/skills/verify-wakfu-companion/SKILL.md`) y fonctionne, ce qui suffit pour le parsing/store mais pas pour valider un changement touchant réellement `LogFileAccessService`/le sélecteur de fichier.

⚠️ **`claude mcp get playwright` NE SUFFIT PAS à vérifier le navigateur réellement utilisé** — piège vécu deux fois (2026-08-25 ET 2026-08-26, la seconde fois découverte par l'utilisateur via deux captures d'écran montrant une fenêtre Firefox Nightly, après que la session ait affirmé à tort « Chrome confirmé » sur la seule foi de cette commande). Cette commande lit la **config déclarée**, pas le processus MCP réellement en cours d'exécution pour CETTE session (voir le paragraphe suivant sur le figement au démarrage) — elle peut afficher `--browser chrome` alors que le navigateur effectivement piloté est Firefox depuis le début de la session. **Seule vérification fiable : lire `navigator.userAgent` directement dans la page pilotée** (`browser_evaluate(() => navigator.userAgent)`), à faire systématiquement avant de conclure qu'un test s'est déroulé sous Chrome — jamais se contenter de la sortie de `claude mcp get`.

Le choix de navigateur du serveur MCP est fixé à son démarrage (`claude mcp add playwright -s local -- npx -y @playwright/mcp@latest --browser chrome`, ou `--browser firefox`) : le changer (`claude mcp remove` puis `claude mcp add` avec un autre `--browser`) ne prend effet qu'à la **prochaine session** — aucune commande `claude mcp` ne recharge à chaud le serveur déjà lancé dans la session courante (vérifié le 2026-08-25 : `navigator.userAgent` restait Firefox juste après la reconfiguration, tant que la session n'avait pas redémarré). Si un test sous Chrome est nécessaire MAINTENANT et que le processus MCP de la session est resté figé sur Firefox : ne pas insister via l'outil MCP, utiliser directement `playwright-core` (voir plus bas, section repli sans Chrome — même mécanique) pointé sur `C:\Program Files\Google\Chrome\Application\chrome.exe`, qui lance un VRAI Chrome indépendant du processus MCP figé.

**Chrome absent (cas de repli uniquement, ex. un sandbox Linux sans Chrome installé)** : si `mcp__playwright__browser_navigate` échoue avec `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`, et que `npx playwright install chrome` échoue aussi (sudo indisponible), une vraie installation Chrome n'est pas récupérable dans cet environnement précis — mais ça reste une exception d'environnement, pas la référence : sur une machine où Chrome est installé (ex. ce dépôt cloné sous Windows, `C:\Program Files\Google\Chrome\Application\chrome.exe`), toujours reconfigurer le serveur MCP sur `--browser chrome` plutôt que de rester sur Firefox par défaut. Solution de repli qui fonctionne sans sudo quand Chrome est vraiment absent : installer Firefox via Playwright (`npx playwright install firefox`, ne nécessite pas de droits root) puis piloter le navigateur directement avec le paquet `playwright-core` (déjà présent après un premier `npm install playwright-core` dans le répertoire scratchpad) en pointant l'exécutable :

```js
const { firefox } = require('playwright-core');
const browser = await firefox.launch({
  executablePath: '/home/deck/.cache/ms-playwright/firefox-XXXX/firefox/firefox', // adapter le numéro de version présent sous ~/.cache/ms-playwright
});
```

Écrire ces scripts de vérification dans le dossier scratchpad de la session (jamais dans le repo), et les supprimer une fois la vérification terminée.

**Jeu de données réaliste pour la page profil (comptes/personnages/watchlist...)** : `tests/wakfu-companion-export.json` (fourni par l'utilisateur, à conserver) — un export réel de l'app (profil, watchlist, roster de comptes/personnages...). À utiliser via le vrai système d'import de l'app plutôt qu'en reconstituant des données à la main, dès qu'un test touche à la page profil/roster :

```js
// 1. Se placer sur la page profil (le rail "Personnages" n'existe qu'une fois `fileConnectedGuard`
//    satisfait — voir app.routes.ts — donc simuler `status: 'connected'` avant de naviguer) :
const root = ng.getComponent(document.querySelector('app-root'));
root.logFileAccess.status.set('connected');
root.nav.openProfile();
// 2. Basculer sur l'onglet "Personnages" (bouton du rail, texte traduit selon la langue) :
document.querySelectorAll('.profile-rail-btn')
  .find(b => b.textContent.toLowerCase().includes('personnage'))?.click();
// 3. Importer via le VRAI <input type="file"> (accept="application/json", voir
//    profile-page.component.html) — fonctionne même sans FSA, Playwright peut lui assigner un
//    fichier directement :
// (côté Playwright, pas dans la page) await page.locator('input[type="file"]').setInputFiles(
//   '/chemin/vers/wakfu-companion-export.json'
// );
```

⚠️ **`onImportFileSelected` fait `window.location.reload()` après un import réussi** (réinitialise proprement tout l'état applicatif depuis les nouvelles données, voir le composant) — attendre `page.waitForLoadState('load')` puis **refaire les étapes 1-2** (le rechargement repart de zéro, `status`/`nav` ne sont plus `'connected'`/sur la page profil).

Pour tester un cas de débordement (ex. très nombreux comptes/personnages, qu'aucun jeu de données réel n'atteint confortablement) plutôt que de gonfler le JSON à la main, injecter directement dans `CharacterRosterService` après import (mêmes services accessibles via `ng.getComponent(document.querySelector('app-profile-page'))`) :
```js
const comp = ng.getComponent(document.querySelector('app-profile-page'));
comp.roster.accounts.set([{ id: 'fake', label: 'Compte test', gameServer: null, characters: [...] }]);
```

⚠️ **Piège : plusieurs `.app-page-body`/`.profile-rail` coexistent dans le DOM** (un jeu par vue `AppPageComponent`, la vue `main`/dashboard ET la vue `profile` sont toutes deux montées via `@defer` dans `app.html`) — `document.querySelector('.app-page-body')` peut renvoyer celui de la MAUVAISE vue (silencieusement, sans erreur : juste un élément qui ne scrolle jamais quand on agit dessus). Toujours scoper la recherche à la vue active, ex. `document.querySelector('app-profile-page .app-page-body')` ou `[...document.querySelectorAll(...)].find(el => el.closest('app-profile-page'))`.

⚠️ **Piège CSS proche, à ne pas confondre avec le précédent** : `Element.closest()` cherche parmi les ANCÊTRES (et l'élément lui-même), jamais les descendants. Un composant dont le template englobe entièrement un autre composant partagé (ex. `<app-profile-page>` qui contient `<app-page>`, lequel rend `.app-page-body` plus bas dans SON PROPRE template) a cet élément comme **descendant**, pas ancêtre, dans le DOM final — `hostEl.nativeElement.closest('.app-page-body')` échoue toujours (retourne `null`) dans ce sens-là ; c'est `querySelector('.app-page-body')` (recherche descendante) qu'il faut utiliser depuis le composant hôte. Confondu une fois en session (`ProfilePageComponent` cherchant son propre `.app-page-body` pour y poser un `ResizeObserver`, voir plus bas).

## Sticky (`position: sticky`) : deux pièges CSS qui l'empêchent silencieusement de fonctionner

Rencontrés (et corrigés) sur le rail de navigation desktop de la page profil (`.profile-rail`/`.roster-account-rail`, `profile-page.component.css`) — un `position: sticky; top: 0` posé sur un élément peut être syntaxiquement correct, `getComputedStyle` peut même confirmer `position: sticky`, et pourtant ne produire **aucun** effet visible au scroll, pour deux raisons indépendantes et non évidentes à la lecture du CSS seul (vérifiées uniquement via `getBoundingClientRect()` en boucle pendant un scroll simulé, voir méthode de test ci-dessus) :

1. **Sticky sur le seul enfant d'un conteneur défilant, sans rien d'autre autour** : si l'élément sticky occupe déjà 100% de la zone défilante de son parent (rien à scroller "sous" ou "au-dessus" de lui dans ce même conteneur), le sticky équivaut exactement à `position: static` — il n'y a tout simplement rien pour lui donner l'occasion de "décrocher". Piège rencontré en ajoutant `position: sticky` sur un wrapper qui était le SEUL enfant de son `overflow-y: auto` — inutile, à retirer plutôt qu'à déboguer.
2. **N'importe quel ancêtre avec un `overflow` autre que `visible` — y compris `hidden`, même s'il ne clippe jamais rien en pratique** — devient, au sens CSS, le "conteneur de défilement" de référence pour le calcul du sticky, à la place du vrai conteneur qui scrolle plus loin dans l'arbre. Si cet ancêtre-écran ne scrolle lui-même jamais (`scrollTop` toujours à 0 — cas d'un `overflow: hidden` posé "au cas où" sur un panneau dont le contenu ne dépasse en réalité jamais sa propre boîte), l'élément sticky suit cet ancêtre comme un bloc rigide pendant que celui-ci défile normalement plus haut : aucun effet de collage visible, alors que le sticky est bien actif. Repérer ce cas en listant, dans `getComputedStyle`, l'`overflow`/`overflow-x`/`overflow-y` de CHAQUE ancêtre entre l'élément sticky et le véritable conteneur qui scrolle (`.app-page-body` sur cette page) — le premier qui n'est pas `visible` est le coupable, qu'il ait ou non un rôle visuel évident.

Une 3ᵉ cause, plus générale et déjà documentée ailleurs dans ce fichier (voir `.tool-panel`/`.panel-body`, gating `isInitialLoad`... non — voir plutôt le principe `height: 100%` sous un ancêtre flex à hauteur non définie, section suivante) peut aussi supprimer toute "marge de manœuvre" nécessaire au sticky en stretchant l'élément à la hauteur totale de son bloc englobant (plus de place pour "décrocher") : plafonner sa hauteur (`max-height`, mesuré dynamiquement — `railMaxHeight`/`ResizeObserver` dans `ProfilePageComponent`, jamais une valeur `vh` en dur qui ne défalquerait pas le chrome au-dessus) est alors nécessaire en plus des deux points ci-dessus, pas à leur place.

## Principe d'architecture : gating `isInitialLoad`

`LogFileAccessService.newLines$` émet `{ lines, isInitialLoad }` — `isInitialLoad` est vrai uniquement pour le tout premier lot d'une (re)connexion (contenu déjà présent dans le fichier avant l'ouverture). Toute (re)connexion — clic sur "Changer de fichier" puis resélection du même fichier y compris — relit **tout le fichier depuis le début** comme un nouveau `isInitialLoad`.

Deux catégories d'état dans `StatsStoreService`, à traiter différemment à chaque `isInitialLoad` :

1. **Suivi persistant** (`watchlist`, compteurs d'ennemis vaincus/objets ramassés) : ne JAMAIS incrémenter pendant `isInitialLoad` (sinon un contenu déjà compté dans une session précédente regonfle le compteur à chaque reconnexion) — géré dans `registerDefeat`/`registerLoot` via `currentBatchIsInitialLoad`.
2. **État dérivé du fichier** (historique de combats, kamas, xp, combats gagnés/perdus, chat...) : DOIT être réinitialisé (`resetSessionState()`) au début de chaque `isInitialLoad`, sinon une reconnexion ajoute une deuxième copie de tout l'historique déjà reconstruit au lieu de le remplacer (bug réel corrigé en session — vérifier ce point à chaque fois qu'un nouveau signal cumulatif est ajouté à `StatsStoreService`).

Si un nouveau champ cumulatif est ajouté au store, se demander explicitement : persistant (jamais reset) ou dérivé du fichier (reset à chaque `isInitialLoad`, dans `resetSessionState()`) ?

## Durée de session (carte Récap) : dérivée du fichier, pas de l'horloge murale

Corrigé le 2026-08-26 : l'ancien calcul (`Date.now() - dateDeConnexion`, un simple chrono démarré à
la connexion) grandissait indéfiniment tant que l'onglet restait ouvert — y compris client Wakfu
fermé, PC en veille, ou fichier contenant plusieurs sessions de jeu distinctes (utilisateur
déconnecté puis reconnecté plus tard dans le MÊME `wakfu.log`). La durée affichée doit correspondre
au temps **réellement actif** d'après le contenu du fichier, pas au temps écoulé depuis l'ouverture
de l'app.

Architecture retenue (`StatsStoreService.accumulateSessionDuration`, appelée sur CHAQUE ligne brute
dans `ingest()`, avant même `LogParser.parseLine`) — **deux seuils distincts**, pas un seul partagé
(voir plus bas pourquoi la version initiale à un seul seuil a dû être corrigée) :

- `sessionActiveDurationMs` (signal, reset à 0 dans `resetSessionState()`, donc à chaque
  `isInitialLoad` — état DÉRIVÉ DU FICHIER, voir principe `isInitialLoad` ci-dessus) accumule
  l'écart entre deux lignes horodatées consécutives du fichier, **sauf** si cet écart atteint
  `SESSION_SEGMENT_GAP_THRESHOLD_MS` (5 min, privée à `stats-store.service.ts`) — auquel cas il est
  considéré comme une coupure (fermeture du client, crash, veille...) et n'est PAS ajouté au total.
  Basé sur `peekLineTime` (voir `log-parser.ts`, déjà utilisé par `primeLogDateAnchorFromBatch` pour
  l'ancrage de date) sur la ligne BRUTE, PAS sur `LogEntry`/`apply()` : une ligne purement technique
  sans `LogEntry` associé (ex. `"Stopping cFC..."`, arrêt du client) compte quand même comme une
  preuve d'activité — sinon une période sans combat/butin/chat (navigation de menus, par exemple)
  paraîtrait à tort "coupée".
- Ce seuil de segmentation (5 min) volontairement **générique** (écart entre lignes), pas basé sur la
  détection de la ligne `"Stopping cFC..."` elle-même malgré sa présence dans le fichier de
  calibration (voir ci-dessous) : cette ligne ne signale qu'une fermeture PROPRE, jamais un crash/une
  perte réseau/une mise en veille/un `wakfu.exe` tué depuis le gestionnaire de tâches. Un seuil
  générique couvre tous ces cas uniformément, sans dépendre d'une chaîne de log qu'Ankama pourrait
  faire évoluer.
- Calibré sur un vrai fichier fourni par l'utilisateur (deux sessions de jeu distinctes dans le même
  `wakfu.log`, fermeture complète du client puis reconnexion ~41 min plus tard) : le plus grand écart
  normal À L'INTÉRIEUR de chacune des deux sessions n'y dépassait jamais ~51s (mesuré), très en
  dessous des 5 min retenues pour CE seuil — et l'écart RÉEL entre les deux sessions (41 min 35s) y
  est très largement au-dessus. Résultat vérifié EXACT au diagnostic de l'utilisateur : segments
  `14:13:32,174 → 14:52:25,542` et `15:34:00,974 → 16:52:12,618`, total actif `1h57m05s`.
- `sessionLastIngestAtMs` (signal, horloge MURALE — `Date.now()`, PAS une valeur du fichier — posé à
  la fin de CHAQUE `ingest()`) sert uniquement à `SessionRecapComponent` pour prolonger l'affichage
  "en temps réel" entre deux lots de lignes tant qu'une partie semble en cours, plafonné à
  `SESSION_LIVE_TICK_GRACE_MS` (10s, exportée — voir juste en dessous pourquoi une valeur bien plus
  courte que le seuil de segmentation ci-dessus) : au-delà de ce plafond, la durée cesse d'augmenter
  automatiquement et ne repart QUE lorsque le fichier est de nouveau alimenté (prochain `ingest()`),
  jamais de lui-même — vérifié en navigateur (Chrome piloté directement via `playwright-core`, MCP
  playwright bloqué ce jour-là sur un Firefox qui ne se lançait plus, voir gotcha dédié plus bas) :
  figée à `activeMs + 10s` passé ce délai sans nouveau lot, immobile ensuite, puis reprise exacte dès
  qu'un nouveau lot arrive (le total bondit à la nouvelle valeur confirmée, le tick repart).
- Affichée = `sessionActiveDurationMs + min(max(Date.now() - sessionLastIngestAtMs, 0),
  SESSION_LIVE_TICK_GRACE_MS)` (voir `SessionRecapComponent.updateDuration`).

**Pourquoi deux seuils et pas un seul** (régression corrigée le 2026-08-27, remontée par
l'utilisateur après un test réel sur le fichier de calibration) : la version initiale utilisait UNE
SEULE constante partagée (`SESSION_GAP_THRESHOLD_MS`, 5 min) pour les deux rôles. Ça fonctionnait
pour la segmentation historique (5 min, bien calibré) mais rendait l'affichage "en direct" visiblement
faux : après avoir lu un fichier déjà entièrement statique (plus aucune nouvelle ligne à venir), le
chronomètre continuait à grimper pendant 5 minutes avant de se figer — bien trop long pour un
affichage supposé refléter l'état RÉEL du fichier à chaque instant. Les deux seuils répondent à des
questions différentes : `SESSION_SEGMENT_GAP_THRESHOLD_MS` décide, une fois qu'une ligne confirme la
suite, si le temps DÉJÀ ÉCOULÉ comptait comme actif (large, un vrai écart de jeu normal peut
légitimement atteindre ~50s sans aucune ligne) ; `SESSION_LIVE_TICK_GRACE_MS` décide combien de temps
l'AFFICHAGE peut optimistement continuer à tourner AVANT qu'une telle ligne n'arrive, sans savoir
encore si elle viendra (doit rester court pour ne pas mentir visuellement).

## Switch Session/Jour/Mois/Année (carte Récap) : agrégation SQL serveur, bornes calculées côté client

Ajouté le 2026-08-26 : la carte Récap propose, pour un compte connecté uniquement (aucune donnée
persistante au-delà de la session de fichier courante en mode invité — voir `AuthService`), un
switch qui agrège XP par personnage, kamas détaillés, combats/défis et butin sur une période
calendaire (jour/mois/année **civils**, jamais glissants).

- **`GET /api/v1/history/stats?since=&until=`** (`functions/api/v1/history/stats.ts`) — 5 `SELECT`
  indépendants en parallèle sur `fights`/`fightParticipants`/`fightLoot`/`purchases`/`trades`
  (`GROUP BY`/`SUM`/`count(*) filter (where ...)`), filtrés par `userId` + la plage. Aucune écriture,
  aucune transaction requise (driver `neon-http`, déjà sans transaction interactive).
- **`since`/`until` sont calculés côté CLIENT** (`core/utils/local-period.util.ts` —
  `localDayStart`/`localMonthStart`/`localYearStart`, calendrier LOCAL du navigateur) et envoyés en
  instants ISO explicites — jamais un paramètre `granularity` interprété côté serveur, qui ne connaît
  pas le fuseau horaire de l'utilisateur. Toujours la période EN COURS dans cette itération (pas de
  navigation vers une période passée).
- **Kamas : ventilation détaillée**, volontairement plus riche que la vue Session (`kamasEarned`/
  `kamasLost` simples, inchangée) : combat (`fights.kamas_gained`), ventes HDV vs achats classiques
  (même table `purchases`, distingués par le sentinel `HDV_KAMAS_SALE_ITEM` =
  `'__hdv_kamas_sale__'` — dupliqué côté serveur avec renvoi croisé en commentaire,
  `server/history/stats-query.ts`, `server/` ne dépend jamais de `src/`, même principe que
  `server/settings/keys.ts`), et échanges (`kamasAcquired`/`kamasGiven` + nombre d'échanges).
- Butin de la période : `{itemId, itemName, quantity}` par ligne (mutuellement exclusifs, comme
  partout dans l'historique) — résolu en nom affichable via `resolveItemName` (exportée de
  `history-archive.service.ts`, déjà utilisée pour l'archive de combats), pas recalculé côté
  composant.
- Pas de cache multi-période côté client (`HistoryStatsService` ne garde qu'un seul résultat en
  mémoire, rechargé à chaque changement de switch) : décision délibérée, la requête serveur étant
  déjà agrégée et rapide — une mise en cache multi-clé aurait été une optimisation prématurée.
- **Regroupement par donjon** (ajouté le 2026-08-26, suite logique demandée par l'utilisateur) : 6ᵉ
  requête SQL (`GROUP BY fights.dungeon_id`) — AUCUNE migration requise, `fights.dungeon_id`
  existait déjà (lot 8). Le serveur renvoie l'id Ankama brut (`null` = hors donjon) sans rejoindre
  `dungeons` : le nom localisé est résolu côté client via `CatalogService.findWakfuDungeonEntryById`
  (nouvelle méthode, miroir de `findWakfuItemEntryById` — même raison que pour `itemId`/`itemName`
  du butin : le serveur ne connaît pas la locale d'affichage). "Type de combat" (mentionné dans la
  demande d'origine) volontairement PAS traité comme un axe de regroupement séparé de `dungeonId` —
  chaque donjon a de toute façon un `type` (`WakfuDungeonType`) qui lui est propre, un second niveau
  de regroupement n'apportait pas de valeur claire supplémentaire pour cette itération.
- **Navigation vers une période passée** (même date) : stepper `‹ label ›` (réutilise `app-stepper`,
  déjà existant — voir section "Conventions UI transverses", pas de nouveau composant) au-dessus du
  contenu de période, piloté par un `periodOffset` (0 = période EN COURS, négatif = passé, jamais
  positif — `[max]="0"` sur le stepper). Bornes calculées par `periodBounds`
  (`core/utils/local-period.util.ts`, avec `addLocalDays`/`addLocalMonths`/`addLocalYears` — passage
  par le constructeur `Date(année, mois, jour)`, qui normalise nativement un débordement de
  composant, jamais une arithmétique en millisecondes qui casserait autour du changement d'heure
  été/hiver). **Simplification notable par rapport à l'itération précédente** : `until` est
  maintenant TOUJOURS le début de la période suivante (jamais un "now + marge") — y compris pour la
  période EN COURS, ce qui revient à demander "jusqu'à demain minuit" alors qu'on est encore
  aujourd'hui : aucun combat ne peut avoir un horodatage futur, donc ça ne change rien au résultat
  tout en unifiant la formule pour tous les offsets (plus besoin de `PERIOD_UNTIL_BUFFER_MS`,
  supprimée). Changer de granularité (switch) réinitialise toujours `periodOffset` à `0` — naviguer
  et changer de granularité restent deux gestes distincts, ne jamais hériter d'un offset d'une
  granularité précédente sur une autre.
- **Cache multi-période** (même date, revient sur la décision "pas de cache" de l'itération
  précédente à la demande explicite de l'utilisateur) : `HistoryStatsService` garde désormais un
  `Map<string, PeriodStats>` clé `"{granularité}:{offset}"`, alimenté uniquement pour les périodes
  PASSÉES (`offset !== 0`) — la période EN COURS n'est JAMAIS mise en cache ni servie depuis le
  cache, elle reste par nature susceptible de changer tant qu'elle n'est pas terminée. Un passé déjà
  écoulé, lui, ne change plus (hors correction manuelle d'objet a posteriori, cas limite ignoré).
  Navigation rapide dans le stepper protégée par un compteur de requête (`requestSeq`) : une réponse
  réseau arrivée après une plus récente est silencieusement ignorée plutôt que d'écraser l'affichage
  avec un résultat périmé.
- Vérifié en navigateur (Chromium réel via `playwright-core`, MCP playwright resté figé sur Firefox
  cette session — voir gotcha dédié plus bas) avec un id de donjon RÉEL du référentiel (65 =
  "Larventura") : résolution de nom correcte, `null` → "Hors donjon". Navigation testée sur 3 pas
  (0 → -1 → -2 → -1 → 0) : bornes `since`/`until` exactes à chaque pas, AUCUN appel réseau
  supplémentaire en revenant sur un offset déjà visité (cache), UN appel en revenant sur l'offset 0
  (jamais servi depuis le cache), bouton "suivant" désactivé à l'offset 0 (jamais de période
  future), libellés corrects dans les 3 granularités ("Aujourd'hui"/"Hier" pour jour, "août 2026"
  pour mois, "2026" pour année).
- Comme pour tous les lots serveur précédents (voir `server/README.md`) : seul un déploiement réel
  avec la vraie base Neon permet de valider les requêtes SQL contre de vraies données — ce sandbox ne
  peut atteindre ni Neon ni `*.pages.dev`. Vérifié ici en navigateur (Chromium/playwright-core,
  `ng serve`) avec `/api/v1/history/stats` simulé par interception de `fetch` (les Pages Functions
  n'existent pas sous `ng serve`, même méthode déjà établie pour les lots précédents) : switch masqué
  en invité, apparition une fois authentifié simulé, bornes `since`/`until` correctes pour les 3
  granularités (vérifiées avec le changement d'heure d'été/hiver, `localYearStart` au 1er janvier
  donnant `+1` UTC en hiver contre `+2` en été pour les autres cas testés — cohérent, JS `Date`
  applique le bon décalage pour CHAQUE date, pas un décalage fixe), positions du fond glissant à 4
  arrêts, ventilation kamas/combats/défis/butin (résolution de nom par catalogue incluse) affichée
  correctement, état de chargement et d'erreur réseau.

## Carte Récap : titre dynamique, largeur, regroupement Donjon & Famille/Type, mini calendrier

Ajouté/corrigé le 2026-08-27, suite à 4 retours utilisateur après test réel de la carte Récap :

- **Titre dynamique** — `sessionRecap.title` ("Recap. de la session") en invité,
  `sessionRecap.titleGeneric` ("Récap") une fois connecté, le nom "session" n'ayant plus de sens
  une fois le switch Jour/Mois/Année en place. Propagé aux DEUX autres endroits qui affichent le
  même libellé (`dashboardBodySlotLabel`, `core/services/dashboard-body-slot-label.ts` — fonction
  pure partagée par `DashboardRailComponent` ET `DashboardLayoutPickerComponent`) via un nouveau
  paramètre `isAuthenticated: boolean` passé explicitement (même principe que `historyGroup`, voir
  sa doc de tête) plutôt que lu depuis `AuthService` à l'intérieur de la fonction — les deux
  appelants injectent `AuthService` et lui passent `auth.isAuthenticated()`.
- **Bug de largeur** — `SessionRecapComponent` avait `:host { display: contents }` (copié à tort du
  pattern d'`HistoryComponent`, qui gère lui-même son placement grid) alors que cette carte est un
  panneau UNIQUE placé par `DashboardComponent` via des styles inline (`grid-column`/`grid-row`/
  `order` posés sur le host, voir `dashboard.component.html`) — un host `display: contents` n'a pas
  de boîte propre, ces styles étaient silencieusement ignorés. Passé à `display: flex; height: 100%`
  (même principe que `ChatPanelComponent`) — vérifié : la carte prend maintenant toute la largeur
  disponible quand elle est seule visible (les autres cartes repliées).
- **Regroupement Donjon & Famille/Type** — nouveau switch 3 positions (`detailMode`, réinitialisé à
  `'cumulative'` par `setGranularity`) affiché uniquement hors vue Session : `'cumulative'`
  reproduit exactement l'ancien affichage (XP/Kamas/Combats/Butin globaux, INCHANGÉ) ; `'byGroup'`/
  `'byType'` le REMPLACENT par un accordéon (une section par ligne, repliée par défaut, détail
  XP/butin propre à la ligne).
  - `'byGroup'` ("Donjon & Famille") : une ligne par donjon précis + une ligne par famille de
    monstre représentative pour les combats hors donjon (avant, tous fourrus dans un seul "Hors
    donjon" plat sans détail propre). Deux tableaux distincts côté serveur (`PeriodStats.dungeons`/
    `families`, jamais le même id des deux côtés), simplement concaténés puis triés par nombre de
    combats décroissant côté client.
  - `'byType'` : les 8 `WakfuDungeonType` fusionnés chacun en une seule ligne (peu importe le
    donjon précis) + une ligne "Autres" fusionnant TOUTE `period.families` — calculé côté CLIENT
    (`mergeGroupTotals`, `core/utils/period-group-merge.util.ts`) à partir des mêmes données que
    "Donjon & Famille", aucune requête serveur supplémentaire. Un donjon dont l'id n'est pas
    résolu par `CatalogService.findWakfuDungeonEntryById` (référentiel pas à jour) est simplement
    ignoré ici plutôt que de faire échouer tout le regroupement — vérifié en navigateur en
    patchant temporairement `CatalogService` (le référentiel réel n'est pas accessible dans ce
    sandbox sans base Neon, voir plus bas).
  - Backend (`functions/api/v1/history/stats.ts`) : la requête `dungeons` existante gagne un filtre
    `dungeonId IS NOT NULL` (le hors-donjon part désormais dans `families`, plus dans une ligne
    `dungeonId: null` de cette même requête) et deux nouvelles requêtes (`dungeonLoot`/`dungeonXp`,
    même filtre) rejointes en JS par `dungeonId` (jamais en SQL — une jointure directe aurait
    multiplié les lignes de totaux par le nombre de lignes de butin/XP, faussant les sommes).
    "Famille représentative d'un combat hors donjon" : sous-requête dérivée (`familyPerFight`,
    fragment `sql` interpolé, jamais matérialisé seul) reproduisant la même priorité que
    `resolveFightTypeClassification` (client, `fight-image.util.ts`) : boss > archimonstre >
    dominant > plus gros dégât, via `DISTINCT ON (fight_id)` — pas de support `selectDistinctOn`
    dans la version de drizzle-orm utilisée ici (pg-core), d'où un `db.execute(sql\`...\`)` brut
    (comme `functions/api/v1/health.ts`) plutôt qu'un enchaînement de query builder Drizzle pour
    les 3 requêtes qui en dépendent (`families`/`familyLoot`/`familyXp`). Approximation acceptée
    (voir demande utilisateur) : le repli générique "horde hétérogène >3 familles" de la version
    client n'est pas reproduit côté SQL, ces combats tombent simplement dans la famille du
    participant le mieux classé.
- **Mini calendrier de navigation** (icône 📅, `PeriodPickerService`/`PeriodPickerComponent`,
  `shared/period-picker/`) — complète le stepper `‹ label ›` existant (qui reste en place pour les
  petits pas) : ouvre une grille selon la granularité active (jour → mois de 7 colonnes, mois → 12
  cases d'une année, année → 10 cases d'une décennie), prev/next navigue par page (mois/année/
  décennie) sans changer la sélection tant qu'aucune cellule n'est cliquée. Cellule hors bornes
  `[OFFSET_MIN[g], 0]` désactivée (jamais masquée). Même pattern que `ClassPickerService` (rendu
  une seule fois au niveau racine, `app.html`, hors de tout ancêtre `transform` — voir gotcha dédié
  plus bas) plutôt que niché localement dans `SessionRecapComponent`.
  - `offsetForPeriodStart` (`core/utils/local-period.util.ts`) : inverse de `periodBounds`, convertit
    une date cliquée en pas de stepper. `day` : différence de JOURS CALENDAIRES via `Date.UTC(y,m,d)`
    sur les deux dates plutôt qu'une division de ms directe (casserait autour d'un changement
    d'heure été/hiver, un jour local pouvant durer 23h/25h à ce moment) ; `month`/`year` : simple
    arithmétique sur les composants.
  - Noms de mois/jours de semaine : deux nouvelles méthodes `I18nService.formatMonthShort`/
    `formatWeekdayShort` (`Intl.DateTimeFormat` avec la locale courante), plutôt qu'une locale de
    calendrier maison — `formatWeekdayShort` calculée sur une semaine de référence FIXE (5-11
    janvier 2026, un lundi-dimanche confirmé) puisque le nom d'un jour de semaine ne dépend pas de
    l'année.
- Vérifié en navigateur (Chromium réel, `playwright-core` — pas de serveur MCP `playwright`
  disponible dans CET environnement d'exécution distant/cloud, contrairement au poste local décrit
  plus loin dans ce fichier) avec un compte connecté simulé et `/api/v1/history/stats` intercepté
  (fixture avec 2 donjons + 2 familles) : titre "Récap" une fois authentifié (carte ET rail replié
  ET Profil › Personnalisation), carte prenant toute la largeur seule visible, switch Cumulé/
  Donjon & Famille/Type masqué en session, mode Cumulé visuellement identique à avant, mode Donjon
  & Famille listant les 4 groupes triés par nombre de combats (labels de repli "Hors donjon"/
  "Famille inconnue" tant que `CatalogService` n'a pas résolu les ids — confirmé en patchant
  temporairement le service pour simuler une résolution réussie, seule façon de tester ce chemin
  sans base Neon réelle dans ce sandbox), ligne dépliée montrant XP/butin propres au groupe, mode
  Type fusionnant correctement en 3 buckets ("4 salles"/"2 salles"/"Autres") avec des totaux
  recalculés exacts, calendrier affichant août 2026 en surbrillance avec septembre-décembre
  désactivés (bornes correctes), clic sur "mars" déclenchant bien `since=2026-03-01T00:00:00.000Z&
  until=2026-04-01T00:00:00.000Z`.

## Invocations : traitées comme des sorts de leur invocateur, jamais comme des combattants à part

Deux bugs distincts, découverts et corrigés ensemble le 2026-08-24 sur un vrai `wakfu.log` fourni par
l'utilisateur (donjons variés, Sadida/Osamodas/Sram invoquant abondamment) :

1. **`obstacleId != -1` ne signale PAS du décor** — hypothèse fausse qui existait depuis un vieux fix
   ("Larme d'Ogrest"). Vérifié sur ce fichier réel : **jusqu'à 61% des lignes `[_FL_] ... join the
   fight` de VRAIS monstres** (pas des invocations, pas du décor) ont un `obstacleId` non -1 — sans
   rapport avec leur nature de combattant (probablement leur position de départ sur une case
   elle-même praticable/obstacle). L'ancien filtre `if (join[6] !== '-1') return null;` dans
   `LogParser.parseFighterJoin` faisait donc disparaître silencieusement la MAJORITÉ des ennemis de
   nombreux combats — plus aucune image de combat (voir `resolveFightImageInfo`, `entries` vide car
   aucun ennemi connu du catalogue n'avait pu être enregistré), dégâts infligés/encaissés sous-comptés
   (`isRosterMember` rejette toute ligne dont l'attaquant ou la cible n'a jamais "rejoint" le combat).
   **Filtre retiré entièrement** — aucun signal fiable de substitution trouvé pour distinguer un vrai
   décor (rare, ex. "Rocher"/"Sac à patates" dans ce même fichier — mais ceux-ci avaient en réalité
   `obstacleId : -1`, contredisant encore l'hypothèse d'origine) : ces entités sans image ni monstre
   catalogué restent de toute façon neutralisées par le filtrage catalogue de `resolveFightImageInfo`
   et n'ont aucun autre effet néfaste observé.
2. **Une invocation (`isControlledByAI=true` systématiquement, y compris pour l'invocation d'un
   ALLIÉ) n'était donc pas non plus visible avant ce fix** (même filtre `obstacleId` que ci-dessus).
   Architecture retenue plutôt qu'une simple correction de classification allié/ennemi (demande
   explicite de l'utilisateur) : une invocation n'est **jamais** une ligne séparée du récap — ses
   dégâts/soins/armure DONNÉS sont réattribués à son invocateur, avec le nom de l'invocation comme
   libellé de "sort" (ex. l'Eniripsa "Fayto" apparaît crédité d'un sort nommé "Supra Latino" plutôt
   que "Supra Latino" créditée d'un sort "Mot Ka..."). Les dégâts qu'une invocation ENCAISSE restent
   comptés normalement dans le total de l'ennemi qui les inflige.
   - Séquence log type : `"X lance le sort Y"` → `"X: Invoque un(e)/une créature du Z"` (`Z` **pas
     fiable** comme nom réel — le sort "Invocation" de l'Osamodas annonce une créature "du" thème
     invoqué, ex. "Invoque une créature du Gobgob", mais le combattant qui rejoint peut s'appeler
     "Chafer Elite") → ligne technique sans crochets `"(eXG:...) - Instanciation d'une nouvelle
     invocation avec un id de N"` ou `"(eXM:...) - New summon with id N"` (comptage total DIFFÉRENT du
     nombre d'annonces "Invoque" sur ce fichier — glyphes/décor/transformations en produisent aussi —
     **volontairement pas exploitée** pour corréler, corrélation par id essayée puis abandonnée :
     l'écart entre les deux comptages cause de faux appariements) → `"[_FL_] ... Z ... join the
     fight"`.
   - Corrélation retenue (`LogParser`, `FightParseState.pendingSummonCasters`/`summonOwners`, voir
     `SUMMON_ANNOUNCE_RE`) : chaque annonce "Invoque" empile son invocateur (+ horodatage) dans une
     file PAR COMBAT ; le PROCHAIN combattant au `fighterId` encore jamais vu de ce combat (voir
     `seenFighterIds` — crucial : une simple resynchronisation, très fréquente, ne doit jamais
     consommer la file) dépile cette file **à condition de survenir dans `SUMMON_JOIN_WINDOW_MS`
     (500ms) suivant l'annonce** — voir `SUMMON_JOIN_WINDOW_MS`. Hypothèse initiale FAUSSE, corrigée
     le 2026-08-24 après un 2ᵉ passage de bugs signalés par l'utilisateur : "un tout nouveau
     `fighterId` en cours de combat ne peut être qu'une invocation" ne tient pas — un combat long
     (boss à plusieurs phases type combat ultime, vague d'une brèche où des ennemis rejoignent au fil
     de l'eau, ou même un monstre qui invoque un autre monstre comme mécanique de jeu légitime) voit
     de VRAIS nouveaux combattants rejoindre en cours de combat sans rapport avec une invocation ;
     sans fenêtre, une annonce laissée en attente capturait à tort N'IMPORTE QUEL combattant suivant,
     même des dizaines de secondes/minutes plus tard (bug réel constaté : dans un combat ultime à
     plusieurs boss, TOUS les boss successifs finissaient classés comme des invocations d'un allié
     n'ayant invoqué qu'un simple familier des dizaines de secondes plus tôt — combat affiché avec 0
     ennemi). Fenêtre calibrée sur le fichier réel : les 186 annonces "Invoque" y sont TOUJOURS
     suivies de leur propre jointure en 0 à 8ms (log quasi synchrone), largement sous les 500ms
     retenus — et très en-dessous du moindre écart observé entre deux combattants réels distincts
     (secondes à minutes). Une annonce dont la fenêtre expire sans jointure est abandonnée (retirée de
     la file) plutôt que laissée bloquer indéfiniment toute jointure future sans rapport.
   - Une transformation (`"X: transformé(e) en Y !"`, ex. Poupée Lapino du Sadida qui évolue) ne
     réémet PAS d'annonce "Invoque" pour `Y` : `TRANSFORM_RE` propage directement `summonOwners.get(X)`
     vers `Y` avant que la ligne `_FL_` de `Y` n'arrive.
   - Une invocation homonyme d'un vrai ennemi PEUT coexister dans le MÊME combat (vérifié : donjon
     avec 2 "Chimère veilleuse" ennemies + 1 "Chimère veilleuse" invoquée par un Osamodas via le sort
     aléatoire "Invocation") — seule l'instance réellement invoquée (bon `fighterId`) porte
     `summonedBy`, les deux autres restent classées normalement. Limite acceptée (architecture
     name-only préexistante, voir `EntityClassifierService`) : l'affichage final (`classify(name)`)
     reste par NOM, pas par instance — un nom qui serait À LA FOIS invocation alliée dans un combat ET
     vrai ennemi dans un combat CONCURRENT (deux combats actifs en même temps, multi-compte) peut
     encore se tromper d'un côté ; non rencontré en pratique.
   - Réattribution effective dans `LogParser.resolveEffectTail` (dernière étape, commune
     dégâts/soins/armure) : si l'`attacker` résolu est un nom présent dans `state.summonOwners`,
     `spell = attacker` puis `attacker = summonOwners.get(attacker)`. Couvre tous les cas (sort propre
     de l'invocation, statut qu'elle porte/applique, riposte, passif auto) car c'est un unique point de
     sortie commun à `resolveEffectTail`.
   - Côté `StatsStoreService` (`FightWorking.summonNames`) : une invocation identifiée n'est jamais
     poussée dans `fight.enemies`/`fight.allies` ni dans `attackerMap` (`ensurePresent` s'y refuse
     explicitement) — sinon elle resterait une ligne fantôme à 0 dégât dans le récap malgré la
     réattribution. Reste dans `memberNames` (les dégâts qu'elle encaisse doivent compter pour
     l'ennemi qui frappe) et son camp est déterminé via `EntityClassifierService.registerSummonJoin`
     (`classify(casterName)`, PAS le flag `isControlledByAI` brut, toujours `true` pour une
     invocation). `registerFightDefeat` ignore aussi silencieusement les invocations (marqueurs
     "hors-combat" répétés d'une invocation qui meurt/se retransforme ne doivent jamais alimenter la
     watchlist "ennemis vaincus").

## Gotchas plateforme (navigateur) déjà rencontrés

- **`File.size` est figé pour toujours** à la valeur captée au moment de la sélection (`<input type="file">` classique, aujourd'hui supprimé de l'app) — ne reflète JAMAIS la taille réelle sur le disque ensuite, et ne lève **aucune erreur** à la relecture (contrairement à `FileSystemFileHandle.getFile()` qui lève `NotReadableError` si le fichier a changé). C'est précisément pour cette raison que le sélecteur classique a été retiré entièrement : seule l'API File System Access (bouton = `showOpenFilePicker()`, glisser-déposer = `getAsFileSystemHandle()`) permet une vraie lecture continue.
- **`showOpenFilePicker()` (bouton/clic) est bloqué sous `%AppData%\Roaming`** (politique navigateur Chromium, `kBlockAllChildren` sur `DIR_ROAMING_APP_DATA`) — le dossier de logs Wakfu par défaut est dedans. **Mais le glisser-déposer (`DataTransfer.items[i].getAsFileSystemHandle()`) N'EST PAS bloqué** pour ce même dossier (confirmé par test réel de l'utilisateur, contredisant une hypothèse initiale plus large) — c'est la voie de secours à recommander quand le sélecteur échoue, pas un `<input type="file">` classique (supprimé, voir plus haut). Si `showOpenFilePicker` n'existe pas du tout sur le navigateur (`LogFileAccessService.isSupported()` → `false`), l'app affiche un message + la liste des navigateurs compatibles (`setup.component.html`, cas `'unsupported'`) plutôt qu'un fallback dégradé.
- **`transform: translateX(-50%)` ≠ `left: -50%`** : le premier se résout par rapport à la largeur de l'élément lui-même, le second par rapport au bloc englobant. Confondre les deux dans le slider deux-panneaux (`app.css` `.view-slider`) a produit un vrai bug de nav (écran coupé en deux en permanence) — toujours utiliser `transform` pour ce genre de translation proportionnelle à un conteneur plus large que son parent.
- **`static.ankama.com` bloque les requêtes d'image portant un en-tête `Referer` d'un domaine tiers** (protection anti-hotlink) — un `<img src="https://static.ankama.com/...">` chargé normalement échoue silencieusement (pas d'erreur réseau visible autrement que l'event `error` de l'`<img>`), alors que la même URL fonctionne très bien ouverte directement ou via `curl` (qui n'envoie pas de Referer). Solution : `referrerpolicy="no-referrer"` sur la balise `<img>` (voir `item-icon.component.ts`) — supprime l'en-tête, débloque le chargement. Vérifié avec 3 URLs réelles (`Jeton Brut`, `Eclat`, `Mimicroquettes`).
- **`wakassets` répartit les monstres sur DEUX dossiers d'images distincts** : `monsters/{imgId}.png` (icônes carrées standard, ~200x200) ET `monsterIllustrations/{imgId}.png` (bannières rectangulaires ~132x41, souvent pour des boss/monstres spéciaux type "Troolk Hoogan"/"The Undertroolker"/"Rey Mystroolrio" — absents de `monsters/` mais présents dans `monsterIllustrations/`). Un même `imgId` ne se trouve jamais dans les deux. Vérifié : ajouter `monsterIllustrations/` en repli dans `entity-icon.component.ts` résout 34 des 61 monstres du référentiel (`wakfu-monster-catalog.data.ts`) qui n'avaient aucune image sous `monsters/` seul.
- **Le `gfxId` Ankama est la clé stable reliant les JSON officiels au CDN d'images tiers** (`vertylo.github.io/wakassets/items/{gfxId}.png`) — vérifié sur plusieurs objets. Utile pour toute extension future du référentiel d'objets (voir `repository/items.json` et `core/api/catalog.service.ts` — le catalogue est servi par l'API distante depuis le lot 3.1, plus de table embarquée côté client).
- **Planche `class-portraits.data.ts` (`class-portraits-v2-*.png`, 320x1458, 4 colonnes x 18 lignes de cases 80x81 : [mâle coloré, mâle mat, femelle coloré, femelle mat])** : portraits "grand format" par classe ET par sexe, bien plus détaillés que `class-breeds.data.ts` (35x35). Reconstruite le 2026-08-15 à partir de DEUX sources officielles Ankama :
  - `static.ankama.com/.../breeds/assets/icons/big.png` (planche d'origine, 2 colonnes x 18 lignes) : 1 SEUL portrait par classe (pas les 2 sexes) — colonne 0 nettement plus saturée que la colonne 1 (vérifié : saturation HSV moyenne ~30-40% plus basse), utilisées pour le crossfade "mat au repos, coloré au survol" (voir `ClassPortraitComponent`, pas de filtre CSS). **L'ordre des 18 lignes N'EST PAS l'id interne Ankama** (hypothèse initiale fausse, seule la 1ère ligne — Féca, id 1 — coïncidait par hasard) : `feca, sadida, sacrier, pandawa, rogue, zobal, foggernaut, osamodas, enutrof, sram, xelor, ecaflip, eniripsa, iop, cra, eliotrope, huppermage, ouginak`. Se fier UNIQUEMENT à une source objective pour ce genre d'ordre (ici : les `background-position` CSS réellement utilisés par le site officiel pour sa barre de sélection de classe, `.ak-breed-icon-big.breed{id}_0` sur une page `.../encyclopedie/classes/{id}-{slug}`, `ligne = |offsetY| / 81`, lisible via `getComputedStyle` en Playwright) plutôt que déduire "à l'œil" depuis un ordre voisin (slugs, id...) qui n'a pas de raison de correspondre.
  - `static.ankama.com/.../breeds/assets/bg/breed-{id}.jpg` (fond de la page encyclopédie d'une classe, ex. `breed-4.jpg` = Sram) : contient en fait les DEUX illustrations complètes (mâle ET femelle) de la classe, côte à côte, l'une mise en avant et l'autre en silhouette fantôme derrière — mais les deux sont bien présentes en pleine qualité dans le même fichier. A servi à recadrer à la main les 18 portraits manquants (un sexe par classe), en repérant le personnage à l'œil (position très variable d'une classe à l'autre, taille de canvas différente aussi : 988 à 2252px de haut).
  - Recadrage calé sur le traitement colorimétrique de la planche d'origine par régression linéaire par canal RGB (`muted = a*colored + b`, coefficients quasi identiques R/G/B, RMSE ~7/255 sur les 18 lignes déjà fournies par Ankama) plutôt qu'un filtre CSS approximatif — nécessaire car `breed-{id}.jpg` a des couleurs sensiblement différentes (plus froides/saturées) de la planche `big.png` déjà en place.
  - Un `url(...)` de cette planche écrit en dur dans le tableau `styles` d'un composant (plutôt que posé via `[style.background-image]`, voir `ClassPortraitComponent`) fait échouer le build : esbuild (plugin `angular-css-resource`) tente de la résoudre comme une ressource à bundler au lieu d'un chemin public servi au runtime.

## Limites de l'environnement de test navigateur (pas des bugs applicatifs)

Rencontré plusieurs fois cette session — avant de conclure à un bug produit sur la base d'une vérification navigateur qui échoue, éliminer ces artefacts d'outil :

- `computer` (screenshot/zoom) **time out systématiquement** dans cet environnement → se rabattre entièrement sur l'inspection DOM (`javascript_tool`, `read_page`, `getComputedStyle`, `elementFromPoint`).
- Un changement de classe/état dynamique (`:hover`, `:focus`, classe ajoutée par un binding Angular) peut ne PAS se refléter dans `getComputedStyle()` — y compris dans un appel `javascript_tool` séparé du précédent — alors que la règle CSS est structurellement correcte (vérifié via lecture du CSSOM) et fonctionne bien chez un vrai utilisateur (confirmé via une vidéo fournie). Ne pas re-déboguer ce point à l'infini ; vérifier la cohérence du CSS par lecture directe des règles (spécificité, sélecteur) plutôt que de s'acharner sur le rendu live.
- Lire un signal/DOM dans le **même** appel `javascript_tool` qui vient de déclencher un changement (clic, `.set()`) peut afficher un état périmé (Angular/zone pas encore flush) → soit `ng.applyChanges(element)`, soit un second appel `javascript_tool` séparé.
- Sans `<input type="file">` (supprimé, l'app n'utilise plus que FSA), le plus simple pour tester le parsing/store en navigateur est de pousser directement des lignes synthétiques sur `LogFileAccessService.newLines$` (voir `.claude/skills/verify-wakfu-companion/SKILL.md`) plutôt que de simuler un vrai fichier — un `FileSystemFileHandle` n'est de toute façon pas synthétisable depuis la console.
- Un vrai `FileSystemFileHandle`/`File` lié au disque ne peut pas être reproduit par un objet créé en mémoire (impossible à automatiser via CDP) : pour tester un comportement de péremption/permission FSA, s'appuyer sur la doc/le comportement documenté du navigateur plutôt que sur un test automatisé.
- Pas de `ffmpeg` sur la machine : pour analyser une vidéo fournie par l'utilisateur (ex. `.mp4` d'un bug), installer `imageio` + `imageio-ffmpeg` via pip (`/c/Python312/python.exe -m pip install imageio imageio-ffmpeg`) puis extraire des frames à intervalles réguliers avec `imageio.v3.imiter(path, plugin='FFMPEG')` — fonctionne bien, pas besoin d'installer ffmpeg séparément. Attention aux chemins Windows passés à Python depuis Git Bash : utiliser des slashes avant, jamais de backslash suivi de lettre (`\b` devient un caractère backspace).

## Référencement (SEO / recherche IA)

Objectif explicite : être trouvé aussi bien par les moteurs de recherche classiques (Google, Bing)
que par les assistants/agents IA (ChatGPT, Claude, Perplexity...), sur des requêtes type « wakfu
tracker », « wakfu companion », « wakfu historique » et toute variante plausible dans les 4 langues
de l'app (fr/en/es/pt).

- **Domaine canonique en dur, à plusieurs endroits.** L'app n'a pas de rendu serveur (SPA pure, voir
  plus haut) : `src/index.html`, `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt` et
  `core/services/seo.service.ts` (constante `SITE_ORIGIN`) contiennent chacun l'URL canonique de prod
  (`https://oumbra.github.io/wakfu-companion`, GitHub Pages — hébergement de prod actuel) codée en
  dur, faute de templating au build sur `public/` (et pour `seo.service.ts`, par cohérence avec les
  fichiers statiques plutôt que déduite de `location.origin` — voir raison juste après). **Le jour où
  la prod bascule sur Cloudflare/un domaine personnalisé (voir `docs/plan-migration-serveur.md`),
  mettre à jour les 5 endroits ensemble** — un grep sur `oumbra.github.io/wakfu-companion` les
  retrouve tous. Ce même domaine figure aussi en canonical/`og:url`/`hreflang` sur les déploiements de
  preview (`*.pages.dev`) : volontaire, ça dit aux moteurs de ne pas indexer la preview séparément
  (doublon de la prod) sans avoir besoin de config par environnement.
  - **GitHub Pages vs Cloudflare Pages, un état transitoire à garder en tête.** La prod (branche
    `master`) reste sur GitHub Pages (`--base-href /wakfu-companion/`, voir `deploy-main.yml`), sans
    fallback SPA côté serveur : un accès direct à une URL de page (`/fr/profile`, `/en`...) y répond
    404 aujourd'hui, seule `/` (qui redirige côté client une fois le JS chargé) fonctionne vraiment
    en lien direct. La preview (branche `claude/dev`, déployée automatiquement sur Cloudflare Pages —
    voir `deploy-preview.yml`, base href racine) a bien `public/_redirects` (`/* /index.html 200`),
    donc toutes les URLs de page y répondent 200 en lien direct, y compris `/fr/profile`. Le sitemap
    liste les 4 accueils par langue (`/fr`, `/en`, `/es`, `/pt`) en ciblant néanmoins toujours le
    domaine GH Pages canonique (voir point ci-dessus) — cohérent avec le reste du fichier, pas une
    incohérence à corriger : la bascule finale sur Cloudflare changera ce domaine partout d'un coup,
    pas seulement dans le sitemap.
- **Deux couches de meta/title distinctes, à ne pas confondre.** (1) Le `<head>` statique de
  `src/index.html` (meta description, Open Graph, Twitter Card, JSON-LD `WebApplication` +
  `FAQPage`, bloc `<noscript>` multilingue, alternates `hreflang` statiques — voir point suivant) est
  ce que voient les crawlers qui **n'exécutent pas de JavaScript** (GPTBot, ClaudeBot,
  PerplexityBot, CCBot...) — la seule chose qu'ils indexent. (2) `SeoService`
  (`core/services/seo.service.ts`, injecté une fois dans `app.ts` comme `RouteSyncService`) met à
  jour `<title>`/meta description/`<html lang>`/canonical/alternates `hreflang`
  **dynamiquement** une fois l'app démarrée, par page (`NavigationService.view()`) et par langue
  (`I18nService.locale()`), via les clés `seo.title.*`/`seo.description.*` de `translations.ts` (4
  locales, à mettre à jour ensemble comme toute clé i18n — voir plus bas). Ne sert qu'aux
  utilisateurs réels, à Google/Bing (qui rendent le JS) et aux aperçus de partage générés après
  exécution — **jamais** vu par un crawler non-JS, d'où l'importance que (1) reste correct et
  suffisant à lui seul.
- **URLs préfixées par langue (`/fr`, `/en`, `/es`, `/pt`) et balises `hreflang`.** L'app propose
  désormais une URL distincte par langue (`app.routes.ts` : route `:lang`, validée par
  `localeGuard`) plutôt qu'un simple changement de langue côté client sur une URL unique — ce qui
  rend `hreflang` pertinent (Google ne le documente que pour des URLs distinctes par langue).
  Mécanique complète :
  - `LocaleRouteComponent` (`core/routes/`) traduit le segment `:lang` de l'URL en
    `I18nService.setLocale()` (sens URL → état, pendant de `RouteBridgeComponent` pour la page) ;
    contrairement à `RouteBridgeComponent`, il doit rester réactif au changement de paramètre après
    coup (`/fr/profile` → `/en/profile` réutilise la même instance de composant, Angular ne la
    détruit/recrée pas puisque seul `:lang` change).
  - `RouteSyncService` fait le sens inverse (état → URL) : préfixe désormais chaque chemin de page
    par `i18n.locale()` — `LanguageSwitcherComponent` n'a donc rien de spécial à faire, il continue
    d'appeler `i18n.setLocale()` comme avant, la navigation suit automatiquement.
  - `pagePathFor()` (`navigation.service.ts`) centralise le chemin par vue (sans préfixe de langue),
    partagé entre `RouteSyncService` et `SeoService` pour ne pas dupliquer ce mapping.
  - Les anciennes URLs sans préfixe (`/`, `/profile`...) restent résolues mais redirigent (`redirectTo`
    en fonction, pas une chaîne — la cible dépend de la détection ci-dessous) vers leur équivalent
    préfixé, via `detectPreferredLocale()` (`i18n.service.ts` : préférence mémorisée, sinon
    `navigator.language`, sinon français) — ce qui sert aussi de valeur initiale à `I18nService` au
    tout premier rendu, avant que le Router n'ait résolu l'URL.
  - `SeoService` pose canonical + alternates `hreflang` (+ `x-default` → français) vers l'**accueil**
    de chaque langue uniquement (`SITE_ORIGIN/{locale}`), jamais vers la sous-page courante — même
    logique que `public/sitemap.xml`, qui ne liste lui aussi que les 4 accueils (les sous-pages
    n'ont toujours aucune valeur de recherche propre, voir plus bas). `SITE_ORIGIN` y est dupliqué en
    dur (même valeur, même raison qu'ailleurs — voir le point suivant), à garder synchronisé.
  - Un `:lang` hors des 4 locales supportées (lien mort, faute de frappe) est intercepté par
    `localeGuard` (redirige vers `/`, qui redétecte) plutôt que d'être silencieusement ignoré par
    `LocaleRouteComponent`.
- **`public/llms.txt`** : convention émergente (pas encore un standard formel) pour donner aux
  agents/LLM un résumé structuré du site en Markdown, séparé du HTML. Même règle de mise à jour que
  le reste (contenu/fonctionnalités à synchroniser si l'app évolue significativement).
- Si une nouvelle page/route est ajoutée à `app.routes.ts`, se demander explicitement si elle a une
  valeur de référencement propre (sinon, ne pas l'ajouter au sitemap) et lui donner des clés
  `seo.title.*`/`seo.description.*` dans les 4 locales pour que `SeoService` la couvre.

## Liens de référence

- [wakfu-companion.nexuswow.workers.dev](https://wakfu-companion.nexuswow.workers.dev/) — site de référence Nexus-Hub (même nom de projet, sans lien de code avec cette app) : point de comparaison fonctionnel utile.
- [github.com/Nexus-Hub/Wakfu-Companion/tree/master/public/](https://github.com/Nexus-Hub/Wakfu-Companion/tree/master/public/) — dépôt d'origine du site de référence (extraction ponctuelle de données statiques : `wakfu-monster-names.data.ts`, `wakfu-enemy-families.data.ts`, `wakfu-ally-summons.data.ts`, `wakfu-class-spells.data.ts`). N'est PLUS la source des images (voir ci-dessous).
- [github.com/Vertylo/wakassets](https://github.com/Vertylo/wakassetvs/tree/main) — dépôt communautaire exposant la quasi-totalité des images du jeu (objets, monstres, illustrations...), utilisé comme CDN principal via GitHub Pages : `vertylo.github.io/wakassets/{items,monsters}/{gfxId ou imgId}.png` (voir `shared/item-icon`, `shared/entity-icon`, `wakfu-monster-images.data.ts`). Cloné localement pour l'audit de couverture (`wakfu-item-catalog.data.ts`, `wakfu-monster-catalog.data.ts`) — remplace l'ancien fork `oumbra/wakfu-companion-asset`, qui n'est plus utilisé.
- [static.ankama.com/wakfu/portal/game/item/](https://static.ankama.com/wakfu/portal/game/item/) — CDN officiel Ankama, utilisé uniquement pour les recours manuels (`wakfu-item-image-overrides.data.ts`) sur des objets absents des JSON publics. Nécessite `referrerpolicy="no-referrer"` sur l'`<img>` (protection anti-hotlink, voir gotcha ci-dessus).
- [wakfu.com/fr/forum/590-outils/416762-donnee-json](https://www.wakfu.com/fr/forum/590-outils/416762-donnee-json) — fil du forum officiel expliquant comment récupérer et interpréter les fichiers JSON de gamedata Ankama (`wakfu.cdn.ankama.com/gamedata/{version}/{type}.json`, version courante dans `gamedata/config.json`) : source des données fusionnées dans `repository/items.json` (`items.json` + `jobsItems.json`) par le skill externe `wakfu-items-sync` (voir server/README.md).

## Conventions UI transverses (réutiliser, ne pas recréer)

- **Toujours un composant, jamais un bloc HTML+CSS+JS local recopié.** Dès qu'un morceau d'UI a un
  comportement propre (état interne, gestion clavier, options de configuration) — même s'il ne
  semble utilisé qu'à un seul endroit au départ — l'extraire en composant partagé (`shared/`)
  plutôt que de le garder inline dans le template/CSS/TS du composant parent. Un composant partagé
  se teste, se documente et évolue (nouvelles options/flags) indépendamment de son ou ses
  appelants ; un bloc local complexifie le parent et finit tôt ou tard copié-collé ailleurs (cas
  réel : `.kpi-target-stepper` était dupliqué à l'identique dans `tracker.component.html` ET
  `tracker-strip.component.html`, plus 4 variantes proches ailleurs dans l'app — voir
  `app-input-number` ci-dessous). Concevoir le composant pour la réutilisation dès le départ
  (inputs/options plutôt que valeurs figées) plutôt que de le généraliser seulement au 2ᵉ appelant.
- **Pas-à-pas numérique (`app-stepper`, `shared/stepper/`)** : `‹ label ›` générique — `[label]`
  (texte déjà traduit/interpolé par l'appelant, ce composant ne connaît pas l'i18n), `[value]`,
  `[min]`, `[max]`, `[step]` (pas de l'incrément, défaut 1), `[prevTooltip]`/`[nextTooltip]`
  (optionnels), `(valueChange)` (déjà borné à `[min, max]`). Un seul tabstop (`role="spinbutton"`
  sur le conteneur, boutons en `tabindex="-1"`) : `Tab` cible le composant comme un champ de
  saisie, flèche gauche/droite pour reculer/avancer au clavier, en plus du clic sur les boutons.
  Utilisé par `DamageViewSwitchComponent` pour le pas-à-pas de tour (‹ Tour N ›). Non éditable au
  clavier (`label` est un texte affiché, pas une saisie) — voir `app-input-number` ci-dessous pour
  un vrai champ numérique éditable.
- **Champ numérique éditable (`app-input-number`, `shared/input-number/`)** : un vrai `<input
  type="number">` (ciblable au `Tab`, chiffres tapables directement) entouré de boutons +/-
  optionnels — `[value]` (valeur de départ/affichée, composant contrôlé, même principe que
  `app-stepper`), `[min]`/`[max]` (optionnels, `null` = pas de borne), `[step]` (défaut 1),
  `[showButtons]` (défaut `true` — `false` pour un champ compact sans place pour des boutons, ex.
  tuile KPI repliée), `[prevTooltip]`/`[nextTooltip]`/`[fieldTooltip]`, `(valueChange)`. Les 4
  flèches clavier pilotent la valeur (← et ↓ diminuent, → et ↑ augmentent — **pas** le déplacement
  de curseur standard ni le stepper natif du navigateur), en plus du clic sur les boutons et de la
  molette. Habillage visuel (tailles/couleurs, qui différaient légèrement selon l'appelant d'origine)
  personnalisable via des variables CSS `--input-number-*` posées sur la balise `<app-input-number>`
  depuis le CSS de l'appelant (héritées à travers `:host{display:contents}`, voir
  `input-number.component.css` pour la liste complète et les valeurs par défaut) — jamais en
  essayant d'atteindre `.input-number-field` depuis l'extérieur (encapsulation de vue, voir
  `IconComponent.size`). A remplacé 6 implémentations quasi identiques dispersées dans l'app
  (`.kpi-target-stepper` ×2, `.item-picker-qty-stepper`, `.kpi-card-value-input`,
  `.kpi-countdown-current-input`, `.recipe-modal-qty-input`) et l'utilitaire `resolveNumericKeyAction`
  qui les pilotait (supprimé, plus aucun appelant) — à réutiliser pour tout futur champ numérique
  plutôt qu'un nouveau bloc dédié.
- **Tooltips** : directive générique `TooltipDirective` (`[appTooltip]`, `shared/tooltip/tooltip.directive.ts`) — ne JAMAIS écrire un bloc CSS `::after` local dans un composant, ni utiliser `[title]`/`[attr.data-tooltip]` (ancien système CSS, retiré). Mettre le texte dans `[appTooltip]="'xxx' | t"` (statique) ou `[appTooltip]="expression()"` (texte dynamique/calculé, ex. `manualCloseTooltip()`) sur l'élément — quel que soit son type (bouton, span, label...). Rendu via `TooltipService`/`<app-tooltip />` (un seul exemplaire, rendu au niveau racine dans `app.html`, comme `ClassPickerService`) : le tooltip est un `position: fixed` calculé depuis `getBoundingClientRect()` au survol/focus, **jamais un descendant DOM de l'élément survolé**. Conséquence directe : totalement insensible à tout `overflow: hidden`/`auto` ancestral (conteneur à défilement horizontal ou vertical) ET à tout contexte d'empilement local (`z-index`, `position: sticky`) — la catégorie de bug qui justifiait cette migration (tooltip invisible/rogné dans un `.tool-panel`, une bande de scroll horizontal comme `app-tab-bar`, un rail replié...) ne peut plus se produire, quel que soit l'endroit où l'élément vit dans l'arbre DOM.
  - `[tooltipPosition]` (défaut `'top'`, centré au-dessus) : `'top' | 'top-left' | 'top-right' | 'bottom' | 'bottom-left' | 'bottom-right' | 'left' | 'right'`.
    - `bottom*` : en dessous au lieu d'au-dessus — réservé (1) aux éléments situés dans un header (`.app-header` principal ou `.profile-page-header`), qui n'ont pas de place au-dessus (bord haut de l'écran/de la vue) ; (2) au **premier élément (ou 1ère ligne) d'une liste/grille à défilement** dans un `.tool-panel`, par cohérence visuelle avec le reste de la liste (plus une nécessité de clipping depuis cette migration, mais toujours la bonne position pour ne pas coller le tooltip du 1er élément au bord haut du panneau).
      - Liste à une colonne : `[tooltipPosition]="first ? 'bottom' : 'top'"` (ou `i === 0 ? ... : ...`) dans la boucle `@for` (voir `tracker.component.html`, `damage-meter.component.html`) — jamais figé pour toute la liste.
      - Grille à plusieurs colonnes ET responsive (ex. `sound-item-grid` dans `profile-page.component.html`, `repeat(auto-fill, minmax(...))`) : `first`/`i === 0` ne suffit pas (il faut toute la 1ère ligne), et un nombre de colonnes figé en CSS (`:nth-child(-n + N)`) non plus — le nombre réel de colonnes varie avec la largeur du conteneur (fenêtre redimensionnée, sidebar, etc.). Solution appliquée : un `ResizeObserver` sur l'élément grille (`viewChild` + `effect`, voir `profile-page.component.ts` `soundGridColumns`/`updateSoundGridColumns`) recalcule le nombre de colonnes réellement rendues à chaque redimensionnement (même formule que le CSS : `floor((largeurConteneur+gap)/(minColonne+gap))`, valeurs dupliquées en constantes `SOUND_GRID_GAP`/`SOUND_GRID_MIN_COL` à garder synchronisées avec le CSS de la grille), exposé en signal et utilisé côté template via `[tooltipPosition]="i < soundGridColumns.columns() ? 'bottom-left' : 'top-left'"`. Ne pas cleanup l'observer dans `OnDestroy` serait une fuite mémoire.
    - `*-left` / `*-right` : ancré à gauche/droite au lieu de centré (éléments proches d'un bord gauche/droit — ex. bouton "Retour", bouton profil en haut à droite, boutons × en bord de ligne/tuile). Combinable avec `bottom`/`top` (ex. `'bottom-right'`).
    - `left` / `right` : sur le côté au lieu d'au-dessus, centré verticalement — élément collé au bord haut/bas de l'écran où même `top`/`bottom` manquerait de place (ex. `.combat-edge-tab`, onglet replié collé au bord gauche).
  - `[tooltipMultiline]="true"` : largeur max + retour à la ligne (libellés longs/dynamiques, ex. `manual-close-switch`).
  - `[tooltipOnlyIfTruncated]="true"` : n'affiche le tooltip que si le texte de l'élément est réellement tronqué (`scrollWidth > clientWidth`, ex. nom de personnage/objet coupé par un `text-overflow: ellipsis`) — remplace tout mécanisme JS maison de détection de troncature (signal + handler `mouseenter` dédié) qui existait avant cette directive.
  - `[tooltipDisabled]="true"` : désactive le tooltip sans retirer le binding `[appTooltip]` (pratique quand le texte lui-même dépend déjà d'une condition, ex. `variant() === 'header' ? (...) : null` — dans ce cas `tooltipDisabled` n'est même pas nécessaire, `appTooltip` à `null` suffit déjà à ne rien afficher).
  - Le tooltip natif du navigateur (délai ~1s, rendu OS) reste affiché en parallèle de celui-ci — comportement accepté, aucun moyen CSS de le désactiver ; `TooltipDirective` ne pose pas d'attribut `title` natif (contrairement à l'ancien système), donc ce doublon a disparu de fait pour tout ce qui a été migré vers `[appTooltip]`.
  - Accessibilité : la directive pose `aria-describedby` sur l'élément survolé/focus (retiré à la fermeture), pointant vers l'élément `role="tooltip"` rendu par `<app-tooltip />` — pas besoin d'y penser manuellement par appelant.
  - Déclenchement clavier : `:focus-visible` uniquement (pas tout `focus`), pour ne pas afficher le tooltip sur un focus obtenu par clic souris — réplique le comportement de l'ancien système CSS.
- **Boutons icône** : classe globale `.icon-btn` (`styles.css`) pour tout bouton carré contenant uniquement une icône/glyphe (reset, suppression, fermeture...). Variante `.reset-btn` pour l'état rouge au survol (action destructive). Toujours accompagner d'un `[appTooltip]` (voir tooltips ci-dessus) — un bouton icône seul sans libellé visible doit systématiquement en avoir un.
- **Icônes SVG génériques** : sprite `public/assets/icons-*.svg` (nom hashé, régénérer le hash si le contenu change), servi via `<app-icon name="..." [size]="..." [strokeWidth]="..." />` (`shared/icon`, liste des noms dans `AppIconName`) plutôt qu'un `<svg>` inline recopié. Un pictogramme rejoint le sprite dès qu'il est **répété** (plusieurs appelants, y compris dans un `@for`/`@if`-`@else` à fort volume comme une grille) — ne pas y mettre un SVG petit et strictement contextuel à un seul endroit (ex. `shared/ko-icon`, `shared/flag-icon`, l'icône "main" de `manual-close-switch` dans `profile-page`) : le sortir n'apporterait rien. Toujours passer `[size]` explicitement si la taille voulue diffère du défaut (20px) — une règle CSS externe du type `.mon-bouton svg { width: Npx }` ne peut plus atteindre le `<svg>` interne du composant (il vit dans le template de `IconComponent`, pas celui de l'appelant), elle deviendrait silencieusement morte.
- **Panneaux d'outils** (Combat/Suivi/Chat, page profil...) : classe globale `.tool-panel` (`styles.css`) — fond, bordure, radius, ombre, `overflow: hidden` déjà gérés. Structure attendue à l'intérieur : `.panel-header` (classe globale) puis le contenu scrollable propre au composant.
- **Header applicatif** (`app.css` `.app-header`) : porte explicitement `position: relative; z-index: 10;`. Nécessaire car c'est un flex-item de `.view-panel` sans quoi son contenu perd le duel d'empilement face au contenu principal (`.app-main`) qui vient après lui dans le DOM et repeint par-dessus au moindre chevauchement — bug réel corrigé en session (tooltip "Profil" à moitié caché par le panneau Chat, à l'époque du `::after` local ; `TooltipDirective` n'y est plus exposée, voir plus haut, mais le reste du contenu du header l'est toujours). Si un nouvel élément fixe/sticky est ajouté ailleurs dans l'app et se retrouve caché par du contenu qui le suit dans le DOM, suspecter le même mécanisme (stacking context manquant sur un ancêtre flex/grid-item) avant de chercher une autre cause.
- **`[value]` sur un `<select>` dont les `<option>` viennent d'un `@for` ne prend jamais** : Angular applique les propriétés de l'élément hôte AVANT de rendre son contenu embarqué, donc `select.value = 'x'` s'exécute alors qu'aucune `<option>` n'existe encore — le navigateur ignore l'affectation et le select retombe sur sa première option. Bug réel : le serveur de jeu d'un compte du roster était bien enregistré (localStorage ET compte serveur) mais s'affichait « Serveur ? » au changement d'onglet de compte comme au rechargement. Poser la sélection sur les options (`[selected]="option === valeur"`), jamais `[value]` sur le select — voir le `ng-template #gameServerSelect` de `profile-page.component.html`.
- **Un conteneur `overflow-x: auto` rogne AUSSI verticalement** : dès qu'un axe vaut `auto`/`hidden`/`scroll`, l'autre ne peut plus valoir `visible` (CSS Overflow §3). Bug réel d'origine sur `app-tab-bar` (onglets, bouton « tous les onglets », « ? » d'aide, croix de suppression) : leurs tooltips, alors rendus en `::after` local, disparaissaient entièrement dans `.tab-bar-scroll`. Corrigé à l'époque par un padding compensatoire (`--tab-bar-tooltip-room`, réservait la hauteur du tooltip puis l'annulait par une marge négative) — **retiré depuis**, `TooltipDirective` (voir plus haut) rend le tooltip au niveau racine en `position: fixed`, donc plus jamais affecté par l'`overflow` d'un ancêtre. Ce point CSS (l'un des deux axes ne peut plus valoir `visible` dès que l'autre est contraint) reste vrai et utile à connaître pour tout AUTRE contenu (pas les tooltips) qui déborderait d'un tel conteneur.
- **Signal d'index nullable (`number | null`)** : ne jamais tester `@if (signal(); as x)` sur un signal qui peut légitimement valoir `0` (ex. `avatarIndex`) — `0` est falsy en JS/Angular et le bloc `@else` se déclenche à tort. Toujours écrire `@if (signal() !== null)` explicitement dans ce cas (bug réel corrigé en session : le tout premier avatar de la liste ne s'affichait jamais).
- **`position: fixed` niché dans un ancêtre `transform`** : n'importe quelle valeur de `transform` autre que `none` sur un ANCÊTRE — même une matrice identité (`translateX(0)`) — crée un nouveau _containing block_ pour tout descendant `position: fixed`, qui se positionne alors relativement à CET ancêtre plutôt qu'au viewport. Piège réel rencontré : `app-class-picker` niché dans `.recap-panel` (centré via `transform: translate(-50%,-50%)`) atterrissait à des centaines de pixels du point de clic réel. **Solution retenue : rendre `<app-class-picker>` une seule fois au niveau racine** (`app.html`, sibling de `.view-slider`/`.app-shell`, aucun ancêtre `transform`), piloté par un petit service partagé (`ClassPickerService`, `core/services/class-picker.service.ts`) plutôt que dupliqué localement dans chaque composant appelant (`entity-damage-list`, `session-recap`) — tout composant qui a besoin d'ouvrir le picker appelle `classPickerService.open(name, x, y, onChosen)`. Réutiliser ce service pour tout futur menu contextuel `position: fixed` plutôt que de le nicher localement. `TooltipService`/`TooltipDirective` (voir plus haut) applique exactement le même principe pour les tooltips.
- **Ajouter un 3ᵉ enfant à un conteneur `justify-content: space-between` déplace le 2ᵉ enfant existant** (il n'est plus flush-right, il se retrouve au milieu) — piège rencontré en ajoutant un caret de repli à `.loot-header-row` (2 enfants → 3), qui a déplacé les boutons de tri du bord droit vers le centre. Si l'agencement des enfants EXISTANTS doit rester identique à l'ajout d'un nouvel élément (ex. caret/badge), isoler les enfants d'origine dans un wrapper dédié (`flex-grow:1; display:flex; justify-content:space-between;` reproduisant EXACTEMENT l'ancien conteneur) et n'ajouter le nouvel élément qu'en sibling de ce wrapper — voir `.loot-header-main` dans `damage-meter.component.css`.
- **Mesurer un élément (`offsetWidth`/`offsetHeight`) dans un `effect()` juste après qu'un `viewChild` se résout peut donner une taille transitoire, pas la taille finale** — le contenu interne (ex. grille CSS avec `@for`) peut ne pas avoir fini son layout au moment de cette toute première lecture (mesuré : ~52px au lieu des ~256px réels pour `class-picker`, faussant tout calcul de bord d'écran basé dessus). Ne jamais faire confiance à une lecture ponctuelle de taille dans un `effect()` déclenché par `viewChild()` ; toujours passer par un `ResizeObserver` sur l'élément (comme pour `soundGridColumns` dans `profile-page.component.ts`), qui se redéclenche automatiquement une fois la taille réelle atteinte et corrige la valeur.

## Autres conventions

- i18n maison (pas `@angular/localize`) : `I18nService.t(key, params?)` avec interpolation `{{placeholder}}` simple (pas de pluralisation ICU — gérer singulier/pluriel via deux clés distinctes choisies en code). 4 locales : `fr`/`en`/`es`/`pt`, toujours mettre à jour les 4 en même temps dans `core/i18n/translations.ts`.
- **Mise en forme dans une traduction : HTML uniquement, jamais de Markdown.** Une clé de `translations.ts` qui a besoin de mise en forme (gras, italique...) l'écrit directement en HTML (`<b>`, `<i>`, `<u>`...) — jamais de pattern Markdown type `**texte**`, qui ne serait jamais interprété (rendu tel quel par l'interpolation `{{ }}` par défaut). Pour afficher une clé HTML de ce type dans un template, utiliser le pipe dédié `TranslateHtmlPipe` (`| tHtml`, `shared/translate-html.pipe.ts`) avec `[innerHTML]` — jamais `{{ 'clé' | t }}` en interpolation classique, qui échapperait le balisage au lieu de le rendre. `tHtml` sanitize via `DomSanitizer.bypassSecurityTrustHtml` (contenu venant exclusivement de notre dictionnaire de traductions, jamais d'une saisie utilisateur). Voir `LegalPageComponent`/`legal-page.component.html` pour un exemple concret (texte découpé en paragraphes eux-mêmes sanitizés individuellement, faute de clé unique à passer au pipe).
- **Données utilisateur : passer par `UserDataService`** (`core/data-access/`), pas par `PersistenceService` directement, dès qu'il s'agit d'une des six données synchronisables avec le compte (profil, watchlist, réattributions de dégâts, roster, canaux et filtres de chat — voir `user-data.keys.ts`). C'est ce qui les fait remonter automatiquement sur le compte quand l'utilisateur est connecté (lot 6, voir `server/README.md`). `read`/`write` sont **synchrones** dans les deux modes, et doivent le rester : plusieurs consommateurs lisent dans leur constructeur ou en plein chemin chaud de parsing. Ajouter une donnée synchronisable = l'ajouter dans `user-data.keys.ts` **et** dans `server/settings/keys.ts` (liste blanche fermée côté serveur), sans oublier de se demander si elle doit être rechargeable à chaud (`onExternalChange`) quand un autre appareil la modifie.
- `PersistenceService` (localStorage `getJson`/`setJson` + IndexedDB pour le handle de fichier et le cache catalogue) reste la brique de stockage local sous-jacente, à utiliser directement uniquement pour ce qui n'est PAS synchronisé (locale, préférences d'affichage locales, classifications détectées, handle de fichier...).
- Le log `[_FL_] fightId=... Nom breed : B [id] isControlledByAI=true/false obstacleId : O join the fight` (un par combattant, à chaque combat) est le signal le plus fiable pour classer allié/ennemi — plus fiable que les heuristiques par sorts lancés ou dégâts subis, utilisé en dernier recours dans `EntityClassifierService`. `obstacleId != -1` = décor, pas un combattant.
- Ne jamais toucher aux fichiers sous `prompts/` sans qu'on le demande explicitement.
- **Numéro de version** (`package.json` "version", semver) : affiché dans le pied de page (`app-footer`, clé i18n `footer.build`) via `src/app/core/data/build-info.data.ts`, généré à chaque build par `tools/generate-build-info.mjs` (fichier gitignored, comme les autres tables générées — ne pas l'éditer à la main). Départ à `1.0.0` (2026-08-07).
  - **Le bump est automatique, ne jamais l'éditer à la main.** Un hook Git `post-commit` (`.husky/post-commit` → `tools/bump-version-from-commit.mjs`, installé via `"prepare": "husky"` au premier `npm install`) lit le type Conventional Commits du commit qui vient d'être créé, incrémente `package.json`/`package-lock.json` via `npm version <niveau> --no-git-tag-version` (garde `package-lock.json` synchronisé — une dérive y casserait `npm ci` en CI, voir mémoire "npm-version-drift-lockfile"), puis amende ce même commit pour y inclure le bump (garde anti-récursion via la variable d'env `WAKFU_VERSION_BUMP_AMEND`). Un hook `commit-msg` semblait plus naturel mais ne fonctionne pas : Git construit l'arbre du commit à partir de l'index AVANT d'appeler `commit-msg`, donc un `git add` fait depuis ce hook ne rentre jamais dans le commit en cours (vérifié empiriquement).
  - Correspondance type → niveau : `feat:` → minor, `fix:` → patch, `feat!:`/`fix!:`/tout type suivi de `!` ou footer `BREAKING CHANGE:` → major (prioritaire). Tout autre type (`docs`, `chore`, `refactor`, `style`, `test`, `ci`, `build`...) ou message non conforme (merge, revert) → aucun bump.
  - Échappatoire ponctuelle : `SKIP_VERSION_BUMP=1 git commit ...` (fonctionne aussi devant `git rebase --continue`/`git commit --amend`). Cas non gérés automatiquement, à surveiller : un `git commit --amend` manuel répété re-bump à chaque fois (pas de détection d'amend), et un `git rebase` qui rejoue un commit déjà bumpé après résolution de conflit re-déclenche `post-commit` et re-bump une deuxième fois (vécu en session : 1.1.0 → 1.2.0 au lieu de rester 1.1.0, corrigé manuellement avec `SKIP_VERSION_BUMP=1` avant l'amend correctif) — utiliser l'échappatoire dans ces deux cas.
  - Comme tout hook Git, ne s'exécute que sur un commit créé en local avec les hooks installés (pas sur un commit fait via l'UI GitHub, un merge, ou un clone sans `npm install` préalable) — cas non rencontrés dans le flux de travail actuel (tout est committé localement sur `claude/dev`).
