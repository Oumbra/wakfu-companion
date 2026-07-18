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

- **`File.size` est figé pour toujours** à la valeur captée au moment de la sélection (`<input type="file">` classique, aujourd'hui supprimé de l'app) — ne reflète JAMAIS la taille réelle sur le disque ensuite, et ne lève **aucune erreur** à la relecture (contrairement à `FileSystemFileHandle.getFile()` qui lève `NotReadableError` si le fichier a changé). C'est précisément pour cette raison que le sélecteur classique a été retiré entièrement : seule l'API File System Access (bouton = `showOpenFilePicker()`, glisser-déposer = `getAsFileSystemHandle()`) permet une vraie lecture continue.
- **`showOpenFilePicker()` (bouton/clic) est bloqué sous `%AppData%\Roaming`** (politique navigateur Chromium, `kBlockAllChildren` sur `DIR_ROAMING_APP_DATA`) — le dossier de logs Wakfu par défaut est dedans. **Mais le glisser-déposer (`DataTransfer.items[i].getAsFileSystemHandle()`) N'EST PAS bloqué** pour ce même dossier (confirmé par test réel de l'utilisateur, contredisant une hypothèse initiale plus large) — c'est la voie de secours à recommander quand le sélecteur échoue, pas un `<input type="file">` classique (supprimé, voir plus haut). Si `showOpenFilePicker` n'existe pas du tout sur le navigateur (`LogFileAccessService.isSupported()` → `false`), l'app affiche un message + la liste des navigateurs compatibles (`setup.component.html`, cas `'unsupported'`) plutôt qu'un fallback dégradé.
- **`transform: translateX(-50%)` ≠ `left: -50%`** : le premier se résout par rapport à la largeur de l'élément lui-même, le second par rapport au bloc englobant. Confondre les deux dans le slider deux-panneaux (`app.css` `.view-slider`) a produit un vrai bug de nav (écran coupé en deux en permanence) — toujours utiliser `transform` pour ce genre de translation proportionnelle à un conteneur plus large que son parent.
- **`static.ankama.com` bloque les requêtes d'image portant un en-tête `Referer` d'un domaine tiers** (protection anti-hotlink) — un `<img src="https://static.ankama.com/...">` chargé normalement échoue silencieusement (pas d'erreur réseau visible autrement que l'event `error` de l'`<img>`), alors que la même URL fonctionne très bien ouverte directement ou via `curl` (qui n'envoie pas de Referer). Solution : `referrerpolicy="no-referrer"` sur la balise `<img>` (voir `item-icon.component.ts`) — supprime l'en-tête, débloque le chargement. Vérifié avec 3 URLs réelles (`Jeton Brut`, `Eclat`, `Mimicroquettes`).
- **`wakassets` répartit les monstres sur DEUX dossiers d'images distincts** : `monsters/{imgId}.png` (icônes carrées standard, ~200x200) ET `monsterIllustrations/{imgId}.png` (bannières rectangulaires ~132x41, souvent pour des boss/monstres spéciaux type "Troolk Hoogan"/"The Undertroolker"/"Rey Mystroolrio" — absents de `monsters/` mais présents dans `monsterIllustrations/`). Un même `imgId` ne se trouve jamais dans les deux. Vérifié : ajouter `monsterIllustrations/` en repli dans `entity-icon.component.ts` résout 34 des 61 monstres du référentiel (`wakfu-monster-catalog.data.ts`) qui n'avaient aucune image sous `monsters/` seul.
- **Le `gfxId` Ankama est la clé stable reliant les JSON officiels aux CDN d'images tiers** (`vertylo.github.io/wakassets/items/{gfxId}.png`, `cdn.wakfuli.com/items/{gfxId}.webp`) — les deux indexent par ce même id, vérifié sur plusieurs objets. Utile pour toute extension future du référentiel d'objets (voir `wakfu-items.data.ts`, `wakfu-item-catalog.data.ts`).

## Limites de l'environnement de test navigateur (pas des bugs applicatifs)

Rencontré plusieurs fois cette session — avant de conclure à un bug produit sur la base d'une vérification navigateur qui échoue, éliminer ces artefacts d'outil :
- `computer` (screenshot/zoom) **time out systématiquement** dans cet environnement → se rabattre entièrement sur l'inspection DOM (`javascript_tool`, `read_page`, `getComputedStyle`, `elementFromPoint`).
- Un changement de classe/état dynamique (`:hover`, `:focus`, classe ajoutée par un binding Angular) peut ne PAS se refléter dans `getComputedStyle()` — y compris dans un appel `javascript_tool` séparé du précédent — alors que la règle CSS est structurellement correcte (vérifié via lecture du CSSOM) et fonctionne bien chez un vrai utilisateur (confirmé via une vidéo fournie). Ne pas re-déboguer ce point à l'infini ; vérifier la cohérence du CSS par lecture directe des règles (spécificité, sélecteur) plutôt que de s'acharner sur le rendu live.
- Lire un signal/DOM dans le **même** appel `javascript_tool` qui vient de déclencher un changement (clic, `.set()`) peut afficher un état périmé (Angular/zone pas encore flush) → soit `ng.applyChanges(element)`, soit un second appel `javascript_tool` séparé.
- Sans `<input type="file">` (supprimé, l'app n'utilise plus que FSA), le plus simple pour tester le parsing/store en navigateur est de pousser directement des lignes synthétiques sur `LogFileAccessService.newLines$` (voir `.claude/skills/verify-wakfu-companion/SKILL.md`) plutôt que de simuler un vrai fichier — un `FileSystemFileHandle` n'est de toute façon pas synthétisable depuis la console.
- Un vrai `FileSystemFileHandle`/`File` lié au disque ne peut pas être reproduit par un objet créé en mémoire (impossible à automatiser via CDP) : pour tester un comportement de péremption/permission FSA, s'appuyer sur la doc/le comportement documenté du navigateur plutôt que sur un test automatisé.
- Pas de `ffmpeg` sur la machine : pour analyser une vidéo fournie par l'utilisateur (ex. `.mp4` d'un bug), installer `imageio` + `imageio-ffmpeg` via pip (`/c/Python312/python.exe -m pip install imageio imageio-ffmpeg`) puis extraire des frames à intervalles réguliers avec `imageio.v3.imiter(path, plugin='FFMPEG')` — fonctionne bien, pas besoin d'installer ffmpeg séparément. Attention aux chemins Windows passés à Python depuis Git Bash : utiliser des slashes avant, jamais de backslash suivi de lettre (`\b` devient un caractère backspace).

## Liens de référence

- [wakfu-companion.nexuswow.workers.dev](https://wakfu-companion.nexuswow.workers.dev/) — site de référence Nexus-Hub (même nom de projet, sans lien de code avec cette app) : point de comparaison fonctionnel utile.
- [github.com/Nexus-Hub/Wakfu-Companion/tree/master/public/](https://github.com/Nexus-Hub/Wakfu-Companion/tree/master/public/) — dépôt d'origine du site de référence (extraction ponctuelle de données statiques : `wakfu-monster-names.data.ts`, `wakfu-enemy-families.data.ts`, `wakfu-ally-summons.data.ts`, `wakfu-class-spells.data.ts`). N'est PLUS la source des images (voir ci-dessous).
- [github.com/Vertylo/wakassets](https://github.com/Vertylo/wakassetvs/tree/main) — dépôt communautaire exposant la quasi-totalité des images du jeu (objets, monstres, illustrations...), utilisé comme CDN principal via GitHub Pages : `vertylo.github.io/wakassets/{items,monsters}/{gfxId ou imgId}.png` (voir `shared/item-icon`, `shared/entity-icon`, `wakfu-monster-images.data.ts`). Cloné localement pour l'audit de couverture (`wakfu-item-catalog.data.ts`, `wakfu-monster-catalog.data.ts`) — remplace l'ancien fork `oumbra/wakfu-companion-asset`, qui n'est plus utilisé.
- [static.ankama.com/wakfu/portal/game/item/](https://static.ankama.com/wakfu/portal/game/item/) — CDN officiel Ankama, utilisé uniquement pour les recours manuels (`wakfu-item-image-overrides.data.ts`) sur des objets absents des JSON publics. Nécessite `referrerpolicy="no-referrer"` sur l'`<img>` (protection anti-hotlink, voir gotcha ci-dessus).
- [cdn.wakfuli.com/items/](https://cdn.wakfuli.com/items/) — CDN alternatif indexant aussi par `gfxId` (`.webp`), utilisé comme 2ᵉ source de repli dans `item-icon.component.ts`.
- [wakfu.com/fr/forum/590-outils/416762-donnee-json](https://www.wakfu.com/fr/forum/590-outils/416762-donnee-json) — fil du forum officiel expliquant comment récupérer et interpréter les fichiers JSON de gamedata Ankama (`wakfu.cdn.ankama.com/gamedata/{version}/{type}.json`, version courante dans `gamedata/config.json`) : source des données fusionnées dans `wakfu-items.data.ts` (`items.json` + `jobsItems.json`).

## Autres conventions

- i18n maison (pas `@angular/localize`) : `I18nService.t(key, params?)` avec interpolation `{{placeholder}}` simple (pas de pluralisation ICU — gérer singulier/pluriel via deux clés distinctes choisies en code). 4 locales : `fr`/`en`/`es`/`pt`, toujours mettre à jour les 4 en même temps dans `core/i18n/translations.ts`.
- `PersistenceService` (localStorage `getJson`/`setJson` + IndexedDB pour le handle de fichier) est la seule abstraction de persistance à utiliser.
- Le log `[_FL_] fightId=... Nom breed : B [id] isControlledByAI=true/false obstacleId : O join the fight` (un par combattant, à chaque combat) est le signal le plus fiable pour classer allié/ennemi — plus fiable que les heuristiques par sorts lancés ou dégâts subis, utilisé en dernier recours dans `EntityClassifierService`. `obstacleId != -1` = décor, pas un combattant.
- Ne jamais toucher aux fichiers sous `prompts/` sans qu'on le demande explicitement.
