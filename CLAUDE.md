# Langue

Toutes les réponses, y compris la description des étapes, des actions et des raisonnements communiqués à l'utilisateur, doivent être rédigées exclusivement en français. Cela s'applique même si les messages de l'utilisateur, le code, ou la documentation du projet sont en anglais.

# Wakfu Companion — contexte projet

Application Angular 21 (standalone components, signals, `@if`/`@for`) : compagnon de jeu en temps réel qui lit le fichier `wakfu.log` du MMORPG Wakfu (parsing de logs, suivi de dégâts, historique de combats, butin, chat, alertes sonores). Trois cibles de build : dev servi (`npm start`), build web classique (`npm run build`), et **un fichier HTML autonome** (`npm run build:standalone`) ouvrable en `file://` sans serveur — cette 3ᵉ cible impose des contraintes qui reviennent dans presque toutes les tâches (voir plus bas).

## Commandes utiles

- `npm start` — serveur de dev (port 4200, voir `.claude/launch.json`)
- `npm run build` — build web de prod (dist/wakfu-companion)
- `npm run build:standalone` — build `production,standalone` puis inline tout (JS/CSS/favicon) dans `wakfu-companion.standalone.html` à la racine via `tools/build-standalone.mjs`
- Toujours valider les **3 builds** après un changement non trivial (dev, `npm run build`, `npm run build:standalone`) — un changement peut casser silencieusement l'un sans casser les autres (voir gotcha CSS/assets ci-dessous).
- Le fichier `wakfu-companion.standalone.html` est un artefact généré, pas mis à jour automatiquement : après un fix, le régénérer avant de dire à l'utilisateur de retester (il peut tester une copie plus ancienne sans le savoir).

## Principe d'architecture n°1 : rien d'externe ne doit fuiter dans le build standalone

`tools/build-standalone.mjs` n'inline QUE les `<link rel="stylesheet">`, `<script src>` et `<link rel="icon">` présents dans `index.html` — **pas** les images référencées via `url()` en CSS, ni les fetch/CDN runtime. Toute nouvelle image/police/asset doit donc être :
- soit un SVG dessiné à la main directement dans le template du composant (voir `shared/ko-icon`, `shared/flag-icon`),
- soit une image embarquée en base64 dans un fichier `core/data/*.data.ts` (voir `class-icons.data.ts`, `class-breeds.data.ts`, `header-icons.data.ts`) et bindée dynamiquement (`[style.background-image]`), **jamais** mise en dur dans les `styles:` statiques d'un composant (ça fait exploser le budget `anyComponentStyle` d'Angular et bloque le build de prod).

Deux régressions concrètes de ce genre dans l'historique du projet :
- La lib `flag-icons` (drapeaux) référence 250+ SVG externes → collision de build esbuild en dev (`outputHashing` doit être `"media"`, sinon "Two output files share the same path") ET casse silencieusement le rendu en standalone (images jamais inlinées). Solution retenue : drapeaux dessinés à la main dans `shared/flag-icon` (aucune dépendance).
- Les icônes d'objets (`shared/item-icon`) chargent depuis un CDN GitHub en direct (`raw.githubusercontent.com/.../items/{gfxId}.png`) — accepté tel quel (préexistant), mais **ne pas reproduire ce pattern** pour un nouvel asset : privilégier l'embarquement.

## Principe d'architecture n°2 : gating `isInitialLoad`

`LogFileAccessService.newLines$` émet `{ lines, isInitialLoad }` — `isInitialLoad` est vrai uniquement pour le tout premier lot d'une (re)connexion (contenu déjà présent dans le fichier avant l'ouverture). Toute (re)connexion — clic sur "Changer de fichier" puis resélection du même fichier y compris — relit **tout le fichier depuis le début** comme un nouveau `isInitialLoad`.

Deux catégories d'état dans `StatsStoreService`, à traiter différemment à chaque `isInitialLoad` :
1. **Suivi persistant** (`watchlist`, compteurs d'ennemis vaincus/objets ramassés) : ne JAMAIS incrémenter pendant `isInitialLoad` (sinon un contenu déjà compté dans une session précédente regonfle le compteur à chaque reconnexion) — géré dans `registerDefeat`/`registerLoot` via `currentBatchIsInitialLoad`.
2. **État dérivé du fichier** (historique de combats, kamas, xp, combats gagnés/perdus, chat...) : DOIT être réinitialisé (`resetSessionState()`) au début de chaque `isInitialLoad`, sinon une reconnexion ajoute une deuxième copie de tout l'historique déjà reconstruit au lieu de le remplacer (bug réel corrigé en session — vérifier ce point à chaque fois qu'un nouveau signal cumulatif est ajouté à `StatsStoreService`).

Si un nouveau champ cumulatif est ajouté au store, se demander explicitement : persistant (jamais reset) ou dérivé du fichier (reset à chaque `isInitialLoad`, dans `resetSessionState()`) ?

## Gotchas plateforme (navigateur) déjà rencontrés

- **`File.size` est figé pour toujours** à la valeur captée au moment de la sélection via `<input type="file">` — ne reflète JAMAIS la taille réelle sur le disque ensuite, et ne lève **aucune erreur** à la relecture (contrairement à `FileSystemFileHandle.getFile()` qui lève `NotReadableError` si le fichier a changé). Conséquence : impossible de sonder par polling qu'un fichier déjà sélectionné a grossi avec ce mode de sélection classique. Seule solution : un rappel basé sur le temps invitant à ressélectionner (voir `LogFileAccessService.classicFileStale`), pas une vraie détection.
- **File System Access API bloquée sous `%AppData%\Roaming`** (politique navigateur Chromium, `kBlockAllChildren` sur `DIR_ROAMING_APP_DATA`) — le dossier de logs Wakfu par défaut est dedans. D'où le fallback `<input type="file">` classique partout où le sélecteur FSA est proposé.
- **`transform: translateX(-50%)` ≠ `left: -50%`** : le premier se résout par rapport à la largeur de l'élément lui-même, le second par rapport au bloc englobant. Confondre les deux dans le slider deux-panneaux (`app.css` `.view-slider`) a produit un vrai bug de nav (écran coupé en deux en permanence) — toujours utiliser `transform` pour ce genre de translation proportionnelle à un conteneur plus large que son parent.

## Limites de l'environnement de test navigateur (pas des bugs applicatifs)

Rencontré plusieurs fois cette session — avant de conclure à un bug produit sur la base d'une vérification navigateur qui échoue, éliminer ces artefacts d'outil :
- `computer` (screenshot/zoom) **time out systématiquement** dans cet environnement → se rabattre entièrement sur l'inspection DOM (`javascript_tool`, `read_page`, `getComputedStyle`, `elementFromPoint`).
- Un changement de classe/état dynamique (`:hover`, `:focus`, classe ajoutée par un binding Angular) peut ne PAS se refléter dans `getComputedStyle()` — y compris dans un appel `javascript_tool` séparé du précédent — alors que la règle CSS est structurellement correcte (vérifié via lecture du CSSOM) et fonctionne bien chez un vrai utilisateur (confirmé via une vidéo fournie). Ne pas re-déboguer ce point à l'infini ; vérifier la cohérence du CSS par lecture directe des règles (spécificité, sélecteur) plutôt que de s'acharner sur le rendu live.
- Lire un signal/DOM dans le **même** appel `javascript_tool` qui vient de déclencher un changement (clic, `.set()`) peut afficher un état périmé (Angular/zone pas encore flush) → soit `ng.applyChanges(element)`, soit un second appel `javascript_tool` séparé.
- Pour tester une lecture incrémentale de log (nouveau lot de lignes), le fichier synthétique envoyé à `<input type="file">` doit contenir tout le contenu **cumulé depuis la dernière connexion réussie** (pas juste les nouvelles lignes) : `LogFileAccessService` compare `file.size` à `lastOffset`, et un fichier de test plus petit que le précédent déclenche la logique de troncature/reset plutôt que de lire le delta attendu.
- Un fichier `File` créé en mémoire (`new File([...], name)`) n'a **aucun lien avec le disque** : il ne peut jamais reproduire le comportement de péremption d'un vrai fichier sélectionné via la boîte de dialogue native (impossible à automatiser via CDP). Pour ce genre de comportement, s'appuyer sur la doc/le comportement documenté du navigateur plutôt que sur un test automatisé.
- Pas de `ffmpeg` sur la machine : pour analyser une vidéo fournie par l'utilisateur (ex. `.mp4` d'un bug), installer `imageio` + `imageio-ffmpeg` via pip (`/c/Python312/python.exe -m pip install imageio imageio-ffmpeg`) puis extraire des frames à intervalles réguliers avec `imageio.v3.imiter(path, plugin='FFMPEG')` — fonctionne bien, pas besoin d'installer ffmpeg séparément. Attention aux chemins Windows passés à Python depuis Git Bash : utiliser des slashes avant, jamais de backslash suivi de lettre (`\b` devient un caractère backspace).

## Autres conventions

- i18n maison (pas `@angular/localize`) : `I18nService.t(key, params?)` avec interpolation `{{placeholder}}` simple (pas de pluralisation ICU — gérer singulier/pluriel via deux clés distinctes choisies en code). 4 locales : `fr`/`en`/`es`/`pt`, toujours mettre à jour les 4 en même temps dans `core/i18n/translations.ts`.
- `PersistenceService` (localStorage `getJson`/`setJson` + IndexedDB pour le handle de fichier) est la seule abstraction de persistance à utiliser.
- Le log `[_FL_] fightId=... Nom breed : B [id] isControlledByAI=true/false obstacleId : O join the fight` (un par combattant, à chaque combat) est le signal le plus fiable pour classer allié/ennemi — plus fiable que les heuristiques par sorts lancés ou dégâts subis, utilisé en dernier recours dans `EntityClassifierService`. `obstacleId != -1` = décor, pas un combattant.
- Ne jamais toucher aux fichiers sous `prompts/` sans qu'on le demande explicitement.
