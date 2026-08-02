---
name: wakfu-items-sync
description: Récupérer ou mettre à jour dans `referentiel/items_wakfu.json` les objets liés aux métiers de Wakfu (ressources récoltées et résultats de recette), à partir du gamedata officiel Ankama. À utiliser quand l'utilisateur demande d'ajouter/actualiser des objets d'un métier, de compléter le référentiel d'objets, ou après une grosse mise à jour du jeu (nouveaux objets de métier).
---

# Synchroniser le référentiel d'objets de métiers Wakfu

## Source de données : gamedata Ankama, pas le scraping HTML

L'encyclopédie officielle (`https://www.wakfu.com/fr/mmorpg/encyclopedie/metiers`) liste 14 métiers :
- 6 métiers de récolte sans page recettes (`paysan`, `forestier`, `herboriste`, `mineur`, `trappeur`, `pêcheur`) — juste des ressources brutes.
- 8 métiers d'artisanat avec une page `/recettes` paginée (`boulanger`, `cuisinier`, `armurier`, `bijoutier`, `tailleur`, `maroquinier`, `ébéniste`, `maître d'armes`).

**Ne pas scraper ces pages HTML** (paginées, nécessitent un cookie jar à cause d'un flux SSO Ankama en boucle si on suit les redirections sans persister les cookies — voir `curl -L -c cookies.txt -b cookies.txt`, sinon boucle infinie de redirections `account.ankama.com/sso-redirect`). Vérifié : le fichier gamedata officiel `jobsItems.json` contient **exactement** les mêmes objets (ressources brutes + résultats de recette confirmés en croisant plusieurs ids extraits des pages `/recettes` : `gfxId` identique à 100% sur l'échantillon vérifié), avec en prime les traductions FR/EN/ES/PT et la rareté déjà prêtes à l'emploi — pas besoin de scraper ni de paginer.

```
https://wakfu.cdn.ankama.com/gamedata/config.json           -> { "version": "X.Y.Z.W" }
https://wakfu.cdn.ankama.com/gamedata/{version}/jobsItems.json -> tableau d'objets { definition, title, description }
```

Chaque entrée :
```json
{
  "definition": { "id": 1718, "level": 15, "rarity": 1, "itemTypeId": 306,
                   "graphicParameters": { "gfxId": 2011718, "femaleGfxId": 2011718 } },
  "title": { "fr": "...", "en": "...", "es": "...", "pt": "..." },
  "description": { "fr": "...", "en": "...", "es": "...", "pt": "..." }
}
```

## Script

```bash
node .claude/skills/wakfu-items-sync/scripts/sync-items.mjs --dry-run   # aperçu, aucune écriture
node .claude/skills/wakfu-items-sync/scripts/sync-items.mjs             # écrit referentiel/items_wakfu.json
```

Le script :
1. Résout la version gamedata courante puis télécharge `jobsItems.json`.
2. Ne garde que les objets dont l'`id` n'est **pas déjà présent** dans `referentiel/items_wakfu.json` (aucune entrée existante n'est jamais modifiée — voir raison ci-dessous).
3. Pour chaque objet manquant, vérifie en HEAD (concurrence réglable, `--concurrency=N`, défaut 20) la disponibilité de l'image sur les deux CDN (`wakassets_available` sur `vertylo.github.io/wakassets/items/{gfxId}.png`, `wakfu_available` sur `static.ankama.com/wakfu/portal/game/item/42/{gfxId}.w40h40.png` — c'est ce 2ᵉ champ, malgré son nom, qui gate l'URL `picture_url` dans `item-icon.component.ts`, pas `wakfu.cdn.ankama.com`).
4. Ajoute les nouvelles entrées triées par `id` à la fin du fichier (le référentiel existant n'est pas globalement trié — c'est une suite de lots ajoutés au fil des sessions — donc ne pas re-trier tout le fichier).

~4800-9600 requêtes HTTP HEAD selon le nombre d'objets manquants : compter 1-3 minutes avec une concurrence de 20. Lancer en arrière-plan si l'agent orchestrateur le permet.

## Mapping de rareté (numérique Ankama -> `WakfuRarity`)

`jobsItems.json`/`items.json` donnent `rarity` en entier (0 à 7), mais `referentiel/items_wakfu.json` attend une des 8 chaînes définies dans `WakfuRarity` (`src/app/core/data/wakfu-item-rarity.data.ts`) : `old`, `common`, `rare`, `mythical`, `legendary`, `memory`, `epic`, `relic`.

| int | libellé brut Ankama | `WakfuRarity` | confiance |
|-----|----------------------|----------------|-----------|
| 0   | "Qualité commune"    | `old`          | **confirmée** (session du 2026-08-02) : les 17 objets du catalogue actif `items.json` avec `rarity:0` sont tous des objets retirés du jeu, affichés "Ancien" sur l'encyclopédie officielle |
| 1   | "Inhabituel"         | `common`       | forte (301/303 correspondances, croisement du 2026-08-01) |
| 2   | "Rare"               | `rare`         | forte (376/424) |
| 3   | "Mythique"           | `mythical`     | forte (1252/1322) |
| 4   | "Légendaire"         | `legendary`    | très forte (1594/1597) |
| 5   | "Relique"            | `relic`        | forte (15/15) |
| 6   | "PVP"                | `memory`       | forte (82/82) — nommé `souvenir` dans le code avant le 2026-08-02, renommé `memory` |
| 7   | "Epique"             | `epic`         | forte (12/12) |

`old` (trad. FR "Ancien") désigne un objet **retiré du jeu** : présent dans `referentiel/items_wakfu.json` (source de vérité complète) mais **exclu** de `src/app/core/data/wakfu-items.data.ts` par `tools/generate-wakfu-items-data.mjs` — jamais résolu par `findWakfuItemEntry`, jamais affiché dans l'UI (tracker/butin), pour ne pas remonter le nom/icône d'un objet historique à la place d'un objet actuel homonyme (voir le piège ci-dessous).

**⚠️ Piège vérifié : un même nom d'objet peut désigner 2 objets totalement différents**, l'un actuel (rareté normale) et l'autre retiré (rareté `old`), avec des `id`/`gfxId` distincts. Exemple confirmé : "Bottes de Javého" existe en id 26250/26251/26252 (niveaux 164/169/170, rare/mythique/légendaire, **toujours actif**) ET en id 26 250-like distinct absent de tout gamedata actuel sous ce même nom niveau 74 (objet historique, pas de trace dans `items.json` ni `jobsItems.json` → impossible à référencer sans son id). **Ne jamais** attribuer `old` à un objet par simple correspondance de nom : toujours vérifier le `level` (`items.json`/`jobsItems.json` par id) contre la source (capture d'écran, encyclopédie) avant d'écraser une rareté existante — sinon un objet bien réel et toujours obtenable perd son entrée dans `wakfu-items.data.ts`.

**Le résidu de désaccord sur 2-7 n'est pas du bruit aléatoire** : ce sont de vrais objets historiques (ex. costumes "du Sage", "Wabbit Rider" : `Coiffe du Sage`, `Amulette du Sage`...) dont la rareté numérique Ankama (souvent 3 = mythique) ne correspond plus à leur palier réellement affiché en jeu (légendaire). C'est pour ça que `sync-items.mjs` **n'écrase jamais une entrée déjà présente** dans le référentiel : une resynchronisation complète re-dériverait une rareté fausse pour ces objets. Si un jour une resynchronisation complète est demandée, croiser d'abord `itemTypeId` + nom pour repérer ces objets légendaires historiques avant d'écraser quoi que ce soit, et faire relire le diff plutôt que de committer en confiance.

## Trouver des objets absents de jobsItems.json (drops de monstres, catégories, métiers)

`jobsItems.json` ne couvre que les objets **de métier**. Beaucoup d'objets existent en dehors de ce périmètre et n'apparaissent dans aucun gamedata téléchargeable en vrac : objets droppés par des monstres sans lien avec un métier (ex. "Bourse du Mulou"), et des catégories entières de l'encyclopédie jamais référencées par un métier ou un monstre (cosmétiques, montures, décorations de Havre-Sac...).

```bash
node .claude/skills/wakfu-items-sync/scripts/discover-items-from-drops.mjs --dry-run --limit=20   # aperçu rapide (limite le nb de monstres phase 1)
node .claude/skills/wakfu-items-sync/scripts/discover-items-from-drops.mjs                         # run complet (checkpoint JSONL, reprenable)
node .claude/skills/wakfu-items-sync/scripts/discover-items-from-drops.mjs --skip-monster-drops --skip-metiers   # catégories uniquement
node .claude/skills/wakfu-items-sync/scripts/discover-items-from-drops.mjs --skip-categories --skip-metiers     # drops de monstres uniquement
```

Le script scrape 3 sources HTML complémentaires, toutes reprenables indépendamment via checkpoint (`checkpoint.monstersDone`/`categoriesDone`/`metiersDone`) :

1. **Drops de monstres** — pour chaque monstre de `referentiel/monsters_wakfu.json`, scrape la page `/butin` paginée (FR) et collecte tout objet droppé absent du référentiel.
2. **Catégories encyclopédie** (`personnalisation`, `armures`, `armes`, `familiers`, `accessoires`, `consommables`, `ressources`, `divers`) — scrape le listing paginé complet de chaque catégorie (FR uniquement ; les noms en/es/pt sont résolus par objet via sa fiche propre + hreflang, pas en re-crawlant chaque listing dans 4 locales). Détection de pagination via `select.ak-select-page` (mêmes options numérotées que la liste des monstres, voir `wakfu-monsters-sync/scripts/scrape-monsters.mjs`), plus fiable qu'une recherche de flèche « » absente de ce gabarit de page.
3. **Recettes de métier** (les 8 métiers d'artisanat) — URLs `.../metiers/{id}-{slug}/recettes` **découvertes dynamiquement** depuis `/encyclopedie/metiers` (jamais codées en dur, robuste à un renommage/ajout de métier), puis scannées avec le même crawler de listing paginé que les catégories. **Attendu : ~0 nouveau candidat** dans l'immense majorité des cas, cette source étant déjà couverte à 100% par `jobsItems.json` (voir plus haut) — gardée en défense en profondeur si Ankama publie un jour un objet de recette sur le site avant sa publication dans le gamedata.

Toutes les sources alimentent un **pool de candidats unique** (dédupliqué par `itemId`, premier trouvé gagnant) résolu par une **phase de résolution commune** : fiche objet propre (catégorie+id+slug extraits du `href` trouvé) + hreflang pour en/es/pt ; repli sur la page de butin du monstre d'origine (uniquement pour les candidats venant d'un drop) si la fiche 404 — cas vécu : catégorie vide dans le `href` (ex. "Fragment de Havre-Gemme Jardin" trouvé sur le monstre Vilenya). Écrit les nouvelles entrées à la fin de `referentiel/items_wakfu.json` (même politique que `sync-items.mjs` : jamais de modification d'une entrée déjà présente).

**Piège vécu sur les tables de listing (catégories/recettes) : le premier `<a>` d'une ligne pointe sur l'icône (texte vide), le second sur le nom.** Un `querySelector` naïf sur "le premier lien de la ligne" capture l'icône et perd silencieusement l'objet (texte vide → filtré) — vérifié en direct sur `/armures` avant d'écrire le parseur définitif. Toujours prendre le premier lien à **texte non vide**, jamais le premier lien tout court. Sur les pages de recettes, ça a aussi l'avantage d'ignorer automatiquement les liens d'ingrédients (texte "x1", "x10"...) qui suivent le nom du résultat dans le DOM.

**Cadence volontairement lente (2s+ entre requêtes, séquentiel, cookie jar + backoff exponentiel sur 403/429)** : contrairement au blocage WAF dur rencontré lors du scraping des ~850 monstres (voir `wakfu-monsters-sync/SKILL.md`, blocage de 45+ minutes après ~200 requêtes rapprochées), un run de référence mené sur un autre poste (Steam Deck/Linux, 2026-08-01/02) a traité ~850 pages monstre + objets en séquentiel avec un délai de ~5s sans jamais déclencher ce blocage — signe que c'est la **cadence**, pas le volume total de requêtes, qui le déclenche. Si ce script se bloque quand même malgré ce throttle, ne pas essayer d'augmenter encore les délais : basculer sur la méthode Playwright MCP (`browser_evaluate`, Firefox) documentée dans `wakfu-monsters-sync/SKILL.md` et dans la section suivante, qui n'a jamais été bloquée.

**Rareté** : le `title` de l'attribut de rareté (`ak-rarity-N`) donne le libellé FR le plus souvent ; sur certaines fiches ce `title` est absent — repli sur l'ordre numérique canonique Ankama (`RARITY_BY_NUMBER` dans le script, même mapping que la table du haut de ce fichier).

**Historique** : run de référence du 2026-08-01/02 (drops de monstres + catégorie `personnalisation` seule, sur l'autre poste) → 148 candidats trouvés, réconciliés et intégrés le 2026-08-02 (75 nouvelles entrées, 71 déjà couvertes par une resynchronisation `jobsItems.json` postérieure, 1 doublon de nom). **Piège corrigé** dans cette réconciliation : le script d'origine sur l'autre poste n'écrivait pas l'`id` Ankama dans ses entrées enrichies (orphelines, récupérables seulement en recroisant un fichier `candidates.json` séparé par `gfxId`) — le script de ce dépôt inclut l'`id` dès la résolution du candidat, jamais à reconstruire après coup. Extension à 6 catégories supplémentaires + métiers le 2026-08-02 (voir demande utilisateur) : validée en dry-run réel contre wakfu.com (catégorie `personnalisation` scannée intégralement en <60s, 103 nouveaux candidats détectés ; découverte des 8 pages de recettes de métier confirmée) — un run complet sur toutes les catégories n'a **pas** été exécuté depuis ce dépôt (`armures`/`armes`/`ressources` notamment sont volumineuses), prévoir plusieurs heures.

## Objets introuvables par scraping systématique (captures d'écran, recherche ciblée, URLs explicites)

Certains objets n'apparaissent dans **aucune** des sources ci-dessus : ni `jobsItems.json`, ni les drops de monstres, ni les 8 catégories, ni les recettes de métier (ex. objets d'événements retirés du jeu = rareté `old`, décorations de Havre-Sac obtenues par un moyen non scrapable comme une quête ou un achat). Seule une capture d'écran fournie par l'utilisateur (inventaire, liste filtrée en jeu...) donne leur nom. Procédure semi-automatisée (agent + Playwright MCP), utilisée et validée les 2026-08-02 sur `assets/old-items/*.png` (132 objets `old`) et `assets/haven-mood/*.png` (21 objets Havre-Ambiance/Pierre d'évolution) :

1. **Extraction des noms** — lister les images du dossier fourni (`assets/<nom>/*.png`, à ajouter au `.gitignore` sur le même modèle que `assets/old-items/*`/`assets/haven-mood/*` : ce sont des artefacts de travail fournis par l'utilisateur, pas des assets du projet) et lire chacune avec l'outil `Read` (sait lire des PNG) pour en extraire nom (+ niveau si visible, utile pour la désambiguïsation `old`).
2. **Filtrage** — ignorer tout nom déjà présent dans `referentiel/items_wakfu.json` (nom normalisé via `normalizeWakfuName`).
3. **Recherche ciblée** — pour chaque nom restant, `wakfu "NOM_EXACT"` (outil `WebSearch`, `allowed_domains: ["wakfu.com"]` recommandé pour réduire le bruit). Ne retenir un résultat que si **son URL commence par `https://www.wakfu.com/fr/mmorpg/encyclopedie/`** ET que son titre correspond bien au même objet — **piège vécu** : la recherche `"Reliquâme Chacha"` a renvoyé des pages de monstres/familiers/ressources "Chacha" sans rapport (aucune ne correspondait à l'objet cherché), confirmé en vérifiant les drops de l'archimonstre réel de la famille (Chuchoteur Chachatophile, id 2489 : ne drop qu'un Archiemblème, pas de Reliquâme). Si aucun résultat ne correspond exactement : **signaler l'objet comme introuvable à l'utilisateur plutôt que d'inventer un id** (voir "Reliquâme Chacha", jamais ajouté au référentiel).
4. **URLs explicites** — si l'utilisateur fournit directement des URLs d'encyclopédie (objets qu'aucune recherche ne remonte, ex. décorations sans lien entrant), sauter les étapes 1-3 et les traiter directement comme des candidats confirmés à l'étape suivante.
5. **Résolution via Playwright MCP** — `browser_navigate` vers n'importe quelle page `wakfu.com` pour établir la session, puis coller `scripts/browser-resolve-urls-template.mjs` dans `mcp__playwright__browser_evaluate` (remplacer `CANDIDATES` par la liste `{key, url}` des étapes 3+4). **`WebFetch` (l'outil standard) ne fonctionne PAS ici** — vérifié en session (2026-08-02) : 403 systématique du WAF wakfu.com, alors que `fetch()` en contexte JS d'une vraie page (`browser_evaluate`) n'est jamais bloqué (même mécanisme que `wakfu-monsters-sync`).
6. **Disponibilité image** — vérifier `wakassets_available`/`wakfu_available` en HEAD côté Node (`vertylo.github.io`/`static.ankama.com` ne sont jamais concernés par le WAF de `wakfu.com`).
7. **Merge** — ajouter au référentiel par `id`, jamais écraser une entrée existante (même politique que partout ailleurs dans ce skill).

**Anomalie de contenu vécue, à ne pas "corriger"** : la fiche ES de l'id 26559 ("Pierre de Savoir") affiche réellement "Piedra de rabia" (texte de la fiche Rage, copié-collé par erreur côté Ankama) — vérifié en revisitant la page en direct, ce n'est pas un bug d'extraction. Garder la donnée telle qu'affichée par le site officiel plutôt que de la "corriger" silencieusement : c'est ce qu'un vrai joueur ES voit aussi.

## Champs générés

Reprend exactement le schéma existant de `referentiel/items_wakfu.json` :
`id`, `fr`, `en`, `es`, `pt`, `rarity`, `gfxId` (string), `picture_url`, `wakassets_available`, `wakfu_available`.

## Après une synchronisation

- `referentiel/items_wakfu.json` n'est PAS consommé directement par l'app au runtime : `src/app/core/data/wakfu-items.data.ts` (table de lookup TS) en est une génération automatique par `tools/generate-wakfu-items-data.mjs`, exécuté avant chaque `npm start`/`npm run build`/`npm run build:standalone:compile` (voir scripts `package.json`) — pas besoin de la lancer à la main après une édition du référentiel, le prochain build/serve s'en charge. Ce générateur exclut les objets `rarity: "old"` de la table.
- Le référentiel contient par ailleurs une anomalie préexistante sans rapport avec ce skill, à ne pas tenter de corriger en passant : 142 entrées sans champ `id` du tout.
- Valider ensuite normalement selon les conventions du projet (`npm run build`, `npm run build:standalone`).
