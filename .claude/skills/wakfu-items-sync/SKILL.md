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

`jobsItems.json` donne `definition.rarity` en entier (0 à 7), mais `referentiel/items_wakfu.json` attend une des 7 chaînes définies dans `WakfuRarity` (`src/app/core/data/wakfu-item-rarity.data.ts`) : `common`, `rare`, `mythical`, `legendary`, `souvenir`, `epic`, `relic`.

Mapping déduit (session du 2026-08-01) en croisant les ~3800 objets de `jobsItems.json` déjà présents dans le référentiel (même `id`, `gfxId` identique à 100% donc bien le même objet) :

| int | string      | confiance |
|-----|-------------|-----------|
| 0   | `common`    | faible (28 objets au total, aucun palier réel en jeu — replié sur `common` faute de mieux) |
| 1   | `common`    | forte (301/303 correspondances) |
| 2   | `rare`      | forte (376/424) |
| 3   | `mythical`  | forte (1252/1322) |
| 4   | `legendary` | très forte (1594/1597) |
| 5   | `relic`     | forte (15/15) |
| 6   | `souvenir`  | forte (82/82) |
| 7   | `epic`      | forte (12/12) |

**Le résidu de désaccord n'est pas du bruit aléatoire** : ce sont de vrais objets historiques (ex. costumes "du Sage", "Wabbit Rider" : `Coiffe du Sage`, `Amulette du Sage`...) dont la rareté numérique Ankama (souvent 3 = mythique) ne correspond plus à leur palier réellement affiché en jeu (légendaire). C'est pour ça que le script **n'écrase jamais une entrée déjà présente** dans le référentiel : une resynchronisation complète re-dériverait une rareté fausse pour ces objets. Si un jour une resynchronisation complète est demandée, croiser d'abord `itemTypeId` + nom pour repérer ces objets légendaires historiques avant d'écraser quoi que ce soit, et faire relire le diff plutôt que de committer en confiance.

## Champs générés

Reprend exactement le schéma existant de `referentiel/items_wakfu.json` :
`id`, `fr`, `en`, `es`, `pt`, `rarity`, `gfxId` (string), `picture_url`, `wakassets_available`, `wakfu_available`.

## Après une synchronisation

- `referentiel/items_wakfu.json` n'est PAS consommé directement par l'app au runtime : `src/app/core/data/wakfu-items.data.ts` (table de lookup TS, ~6200+ entrées) en est une génération figée et manuelle, sans script de génération committé dans le repo à ce jour. Ajouter des objets au référentiel JSON ne les rend donc pas automatiquement disponibles dans l'app (icônes objets, rareté) —à signaler à l'utilisateur si de nouveaux objets ajoutés doivent apparaître dans l'UI immédiatement (ex. tracker de butin) ; la régénération de `wakfu-items.data.ts` est une tâche séparée, plus lourde, non couverte par ce skill.
- Le référentiel contient par ailleurs deux anomalies préexistantes sans rapport avec ce skill, à ne pas tenter de corriger en passant : 142 entrées sans champ `id` du tout, et 11 entrées avec une valeur de `rarity` brute non normalisée (`"Qualité commune"` au lieu de `"common"`).
- Valider ensuite normalement selon les conventions du projet (`npm run build`, `npm run build:standalone` si un fichier consommant le référentiel a été modifié).
