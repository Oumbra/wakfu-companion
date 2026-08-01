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

## Repérer manuellement des objets "old" (pas dans jobsItems.json)

Beaucoup d'objets `old` ne sont pas des objets de métier (decos, pochettes, jetons d'événement...) et n'apparaissent donc dans aucun gamedata téléchargeable en vrac — seule l'encyclopédie officielle ou une capture d'écran fournie par l'utilisateur donne leur nom. Démarche suivie (session du 2026-08-02, voir `assets/old-items/*.png`) :
1. Lire les captures d'écran (`Read` sait lire des PNG) pour extraire nom + niveau de chaque objet listé.
2. Chercher chaque `(nom, niveau)` dans `referentiel/items_wakfu.json` (nom normalisé via `normalizeWakfuName`) **et** dans `items.json`/`jobsItems.json` téléchargés depuis le gamedata Ankama courant (voir URLs plus haut) pour récupérer le `level` réel de chaque `id` candidat.
3. Ne marquer `rarity: "old"` que si le niveau correspond exactement (désambiguïsation anti-collision de nom, voir piège ci-dessus) — ou si l'`id` est absent des deux gamedata actuels ET qu'il n'y a qu'un seul candidat du même nom dans le référentiel (pas de risque de collision).
4. Pour un nom absent à la fois du référentiel et des deux gamedata (pochettes/décos/jetons d'événement notamment) : impossible d'ajouter l'objet sans son `id` Ankama — le signaler à l'utilisateur plutôt que d'inventer un id.

## Champs générés

Reprend exactement le schéma existant de `referentiel/items_wakfu.json` :
`id`, `fr`, `en`, `es`, `pt`, `rarity`, `gfxId` (string), `picture_url`, `wakassets_available`, `wakfu_available`.

## Après une synchronisation

- `referentiel/items_wakfu.json` n'est PAS consommé directement par l'app au runtime : `src/app/core/data/wakfu-items.data.ts` (table de lookup TS) en est une génération automatique par `tools/generate-wakfu-items-data.mjs`, exécuté avant chaque `npm start`/`npm run build`/`npm run build:standalone:compile` (voir scripts `package.json`) — pas besoin de la lancer à la main après une édition du référentiel, le prochain build/serve s'en charge. Ce générateur exclut les objets `rarity: "old"` de la table.
- Le référentiel contient par ailleurs une anomalie préexistante sans rapport avec ce skill, à ne pas tenter de corriger en passant : 142 entrées sans champ `id` du tout.
- Valider ensuite normalement selon les conventions du projet (`npm run build`, `npm run build:standalone`).
