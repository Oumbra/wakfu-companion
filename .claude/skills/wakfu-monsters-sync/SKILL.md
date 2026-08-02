---
name: wakfu-monsters-sync
description: Récupérer ou mettre à jour dans `referentiel/monsters_wakfu.json` et `referentiel/monster-families_wakfu.json` les monstres de Wakfu (identité, famille, image, statut boss/archimonstre/dominant), en scrapant l'encyclopédie officielle wakfu.com — aucun gamedata JSON public n'existe pour les monstres. À utiliser quand l'utilisateur demande de compléter/actualiser le référentiel de monstres, ou après une mise à jour du jeu ajoutant de nouveaux monstres/donjons.
---

# Synchroniser le référentiel de monstres Wakfu

## Pourquoi scraper l'encyclopédie (pas de gamedata JSON, contrairement aux objets)

Pour les objets, `wakfu.cdn.ankama.com/gamedata/{version}/items.json` (et `jobsItems.json`) suffisent (voir skill `wakfu-items-sync`). **Pour les monstres, ce n'est pas possible** : tous les noms de fichiers plausibles (`monsters.json`, `monsterRaces.json`, `creatures.json`...) renvoient un `403` — sur ce bucket S3, un `403` signifie "fichier inexistant" (vérifié : un vrai `items.json` renvoie `200`, un nom bidon renvoie `403`, jamais `404`). Une recherche communautaire confirme qu'Ankama **refuse volontairement** de publier les données de monstres, contrairement aux objets. Donc : scraping HTML de `www.wakfu.com/{locale}/mmorpg/encyclopedie/monstres`, seule source possible.

## ⚠️ Le blocage anti-bot est réel et dur — utiliser Playwright MCP (Firefox), pas `curl`/`fetch` Node direct

**Constaté en session (2026-08-02)** : un scraping direct (`curl`/Node `fetch`, même avec cookie jar correct, même à faible concurrence) déclenche après ~200 requêtes un blocage qui renvoie `403` sur **tout `wakfu.com`, y compris la page d'accueil**, pas seulement l'encyclopédie. Le blocage a persisté **plus de 45 minutes** malgré des vérifications espacées (30s, puis toutes les 12 min) — ce n'est pas un rate-limit à fenêtre courte. Pendant ce temps, l'utilisateur pouvait accéder au même site sans problème depuis son propre navigateur, ce qui a permis de confirmer que le blocage cible la **signature de la requête** (client HTTP simple, pas de JS, fingerprint TLS non-navigateur) plutôt que l'IP seule.

**Solution qui fonctionne, vérifiée en conditions réelles sur les ~850 monstres** : piloter un vrai navigateur via le MCP Playwright et faire les requêtes avec `fetch()` **depuis le contexte JS de la page** (`browser_evaluate`), pas depuis Node. Toutes les requêtes passent alors par le vrai moteur réseau du navigateur (cookies, TLS, headers, JS) et n'ont jamais été bloquées, y compris sur un monstre qui avait explicitement provoqué le blocage lors de la tentative `curl` précédente (`bouflaquette-chevelu`, id 4371).

Mise en place (si le serveur MCP `playwright` n'est pas déjà configuré) :
```bash
claude mcp add playwright -- npx -y @playwright/mcp@latest --browser firefox
npx @playwright/mcp install-browser firefox   # télécharge Firefox dans le cache Playwright du serveur MCP (révision propre au package, distincte d'un éventuel `npx playwright install firefox` fait à côté)
```
**Pourquoi Firefox et pas Chrome** : Chrome nécessite `npx playwright install chrome` qui échoue sans droits admin sur Windows (`ERROR: Failed to install Google Chrome`). Le Chromium bundled (`npx playwright install chromium`, sans admin) fonctionne mais le serveur `@playwright/mcp` ne le détecte pas nativement (il cherche un channel `chrome` par défaut, réglable via `--executable-path` en dernier recours). Firefox (`--browser firefox`) s'installe sans droits admin et est directement supporté comme browser à part entière — pas de contournement nécessaire.

**Piège vécu : une config MCP ajoutée via `claude mcp add` (Bash tool, cwd résolu en minuscules `d:/...`) peut atterrir sous une entrée de projet différente de celle que lit la session interactive (`D:/...`, casse différente)** — deux entrées de projet distinctes coexistent dans `~/.claude.json` pour le même dossier. Si après un `claude mcp add`/`remove` la session ne voit toujours pas le changement même après redémarrage, comparer les clés sous `projects` dans `~/.claude.json` (toutes les variantes de casse/slashes du même chemin) et appliquer la config à toutes les variantes trouvées, pas seulement celle où `claude mcp add` semblait écrire.

**Autre piège** : un changement de config MCP (`claude mcp add`/`remove`, y compris juste changer les flags d'une commande déjà enregistrée) ne se propage **jamais** à une connexion déjà établie dans la session en cours — il faut redémarrer la session (`claude --continue` depuis le même dossier restaure tout l'historique/contexte de conversation, la config MCP locale étant elle aussi persistée par dossier donc reprise automatiquement).

## Méthode de scraping via `browser_evaluate` (chunks)

Le scraping se fait en 2 étapes, chacune via `mcp__playwright__browser_evaluate` (après un `browser_navigate` initial vers n'importe quelle page `wakfu.com` pour établir une session/cookies) :

**Étape 1 — liste des monstres (4 locales, ~36 pages chacune)** : une seule fonction `fetch()`-boucle qui parcourt `?page=1..N` pour `fr`/`en`/`es`/`pt` (slugs différents : `monstres`/`monsters`/`monstruos`/`monstros`, voir constante `LOCALES` dans `scripts/scrape-monsters.mjs` pour les URLs exactes), parse chaque page HTML via `new DOMParser().parseFromString(html, 'text/html')` (équivalent navigateur de `jsdom`), extrait par ligne : id (regex sur le slug du `href`), nom, **famille** (colonne `td.item-type`, vide → `null` pour la plupart des monstres de terrain — normal, pas un manque de données), gfxId (regex sur l'URL de la vignette). Passer `filename: 'monsters-list-raw.json'` à `browser_evaluate` pour écrire directement sur disque (le retour texte inondrait le contexte sinon — 851 monstres × 4 locales ≈ 540 Ko). Tenu en **un seul appel** `browser_evaluate` sans problème (144 requêtes, complété sans blocage).

**Étape 2 — butin par monstre (classification isBoss/isArchi/isDominant)** : FR uniquement. Pour ~850 monstres, **découper en lots de ~150** (un appel `browser_evaluate` par lot, `filename: 'monsters-drops-chunkN.json'`) plutôt qu'un seul appel géant — pas de blocage réseau observé sur un lot de 150, mais un appel couvrant les 850 d'un coup n'a pas été tenté (risque de timeout d'outil non mesuré). Générer les lots depuis `monsters-list-raw.json` (id + slug par monstre) avec un petit script (voir `scripts/split-chunks.mjs`), puis coller le contenu de chaque lot dans le template `scripts/browser-butin-template.mjs` (chaîne `CHUNK = [...]` à remplacer) pour construire le code à passer à `browser_evaluate`.

**Vécu en session** : le contexte du navigateur (`browserBackend.callTool: Target page, context or browser has been closed`) a lâché une fois sur ~6 appels — un simple `browser_navigate` de récupération suffit à relancer une session propre avant de retenter le lot en échec (aucune perte de données : les lots précédents déjà écrits sur disque restent valides).

**Étape 3 — disponibilité des images** : `vertylo.github.io`/`static.ankama.com` n'ont **jamais** été concernés par le blocage (seul `wakfu.com` l'était) — les vérifier normalement via `fetch`/HEAD **côté Node** (pas besoin du navigateur), voir `scripts/scrape-monsters.mjs` (`headOk`) ou un petit script d'assemblage dédié qui combine liste + drops + disponibilité image pour écrire les 2 référentiels finaux.

## Règles de classification (vérifiées sur cas réels, 2026-08-02)

- `isBoss` : au moins un drop dont le nom **commence par** `Jeton`, OU un drop nommé exactement `Pierre d'équilibre` / `Pierre de vitesse` / `Pierre d'aventure` / `Pierre d'entourage` / `Pierre ultime`. Vérifié sur Milkar le Meulou (boss de donjon, id 1987, `bossMonsterId` de `referentiel/dungeons_wakfu.json` id 3) : drop confirmé "Pierre ultime".
- `isArchi` : au moins un drop dont le nom commence par `Reliquâme` ou `Archiemblème`. Vérifié sur Griffu l'Acéré (id 4101) : drops "Reliquâme Tofu" et "Archiemblème - Griffu l'Acéré".
- `isDominant` : au moins un drop nommé exactement `Masque {Tier}` pour un des 15 paliers (Grossier, Rudimentaire, Imparfait, Fragile, Rustique, Brut, Solide, Durable, Raffiné, Précieux, Exquis, Mystique, Eternel, Divin, Infernal). **Confirmé** sur Pichon Dominant (id 2114, nom explicite) et cohérent sur l'ensemble du run complet (88/851 `true`, très corrélé aux noms de monstres contenant "dominant"/"dominante" dans le référentiel).

**Piège évité** : un item comme "Jeton Grossier"/"Jeton Rudimentaire"/... existe aussi comme item de craft générique (voir `referentiel/items_wakfu.json`) sans rapport avec un boss de donjon — mais le critère porte sur les **drops du monstre**, pas sur l'existence de l'item dans l'absolu, donc pas de faux positif.

## `referentiel/monster-families_wakfu.json` (nouveau fichier)

N'existait pas avant ce skill. Structure : `{ id, fr, en, es, pt }`, un id incrémental par nom de famille FR distinct rencontré (en parcourant les monstres par id croissant). Run complet du 2026-08-02 : **93 familles distinctes** sur 851 monstres. La plupart des monstres de terrain n'ont pas de famille (`family: null`) — état normal, pas un manque de données.

## Champs générés (`monsters_wakfu.json`)

`id`, `fr`, `en`, `es`, `pt`, `family` (id numérique ou `null`), `gfxId`, `picture_url` (`https://static.ankama.com/wakfu/portal/game/monster/42/{gfxId}.png`), `wakassets_available`, `wakfu_available`, `isBoss`, `isArchi`, `isDominant`.

`wakassets_available` vrai si l'image existe sur `vertylo.github.io/wakassets/monsters/{gfxId}.png` **OU** `.../monsterIllustrations/{gfxId}.png` (voir gotcha CLAUDE.md : certains boss n'ont qu'une bannière rectangulaire dans le 2ᵉ dossier — les deux sont vérifiés, `true` si au moins un existe).

Run complet du 2026-08-02 : 851 monstres, 127 `isBoss`, 76 `isArchi`, 88 `isDominant`, 93 familles.

## Script Node `scripts/scrape-monsters.mjs` (fallback, si le blocage ne s'est pas encore déclenché)

Écrit et validé fonctionnellement (parsing, classification) avant la découverte du blocage — reste utilisable pour un petit run (`--limit=N`) ou si un run précédent n'a pas encore atteint le seuil de blocage (~200 requêtes). Inclut déjà : contournement SSO (`CookieJar`/`warmUp`), throttle global + backoff exponentiel sur 403, **checkpoint JSONL** (reprise automatique si interrompu), et un **compteur de progression sur une seule ligne** (`\r`, jamais de nouvelle ligne tant que le run n'est pas terminé — voir `printProgress()`, demandé explicitement en session). Concurrence par défaut basse (`--concurrency=2`) — ne pas l'augmenter, c'est très probablement ce qui a déclenché le blocage en session à concurrence 4.

```bash
node .claude/skills/wakfu-monsters-sync/scripts/scrape-monsters.mjs --dry-run --limit=20
node .claude/skills/wakfu-monsters-sync/scripts/scrape-monsters.mjs
```

Si ce script se bloque (403 généralisé sur `wakfu.com` constaté même sur la page d'accueil), **basculer sur la méthode Playwright MCP ci-dessus** plutôt que d'insister — le blocage a duré plus de 45 minutes en session et rien n'indique qu'attendre plus longtemps le lève plus vite qu'un simple changement de méthode.

## Après une synchronisation

- Comme pour les objets, `referentiel/monsters_wakfu.json` n'est pas consommé directement par l'app : `src/app/core/data/wakfu-monsters.data.ts` en est une génération automatique par `tools/generate-wakfu-monsters-data.mjs` (miroir exact de `tools/generate-wakfu-items-data.mjs` pour les objets — dédoublonnage par nom normalisé, index inverse EN/ES/PT, `findWakfuMonsterEntry`/`isKnownWakfuMonsterName`), exécuté avant chaque `npm start`/`npm run build`/`npm run build:standalone:compile` via le script `generate` combiné (`generate:items && generate:monsters`, voir `package.json`) — pas besoin de la lancer à la main après une édition du référentiel, le prochain build/serve s'en charge. Adapté le 2026-08-02 d'un script équivalent trouvé sur un autre poste (`generate-monsters-data.mjs`, environnement Steam Deck/Linux) qui n'avait pas encore été porté sur ce dépôt — avant ce script, `wakfu-monsters.data.ts` était un fichier généré à la main et resté périmé (827 monstres au lieu de 851, sans les champs `family`/`isDominant`).
- Les champs `family` (id numérique ou `null`) et `isDominant` sont désormais portés par `WakfuMonsterEntry` dans `wakfu-monsters.data.ts`, au même titre que `isBoss`/`isArchi`.
- Nettoyer les fichiers intermédiaires (`monsters-list-raw.json`, `monsters-drops-chunk*.json` à la racine du repo, dossier `.playwright-mcp/`) une fois les référentiels finaux écrits et validés — ce sont des artefacts de travail, pas des fichiers du projet.
- Valider les 3 builds (`npm start` en visuel, `npm run build`, `npm run build:standalone`) après régénération — le générateur touche un fichier consommé par plusieurs services (`wakfu-search.service.ts`, `entity-classifier.service.ts`, `entity-icon.component.ts`, `i18n.service.ts`).
