---
paths:
  - "src/app/core/api/catalog.service*.ts"
  - "src/app/core/utils/dungeon-boss-index.util*.ts"
  - "src/app/core/utils/fight-image.util.ts"
  - "src/app/shared/{item-icon,entity-icon,class-portrait}/**"
  - "src/app/core/data/*.data.ts"
  - "server/catalog/**"
  - "server/import/**"
---

# catalog-assets

Portée : référentiel objets/monstres/donjons (`CatalogService`, `server/catalog`, scripts `server/import`), résolution boss → donjon, et sources d'images (CDN wakassets, Ankama, planches embarquées). Rappel : le référentiel JSON lu par `server/import` est local et ignoré par git — toute modification y reste locale, à signaler explicitement ; ne jamais le décrire (origine, chemin, contenu) dans le code ou la documentation.

## Index « boss → donjon » : donjon classique toujours prioritaire sur une brèche

Corrigé le 2026-09-13 (fichier utilisateur, Donjon Flaqueux — combat de boss affiché avec l'image
générique de brèche, sans regroupement des salles, `dungeon_id`=170 « Brèche dimensionnelle de
Frigost » en base pour 57 combats prod). Les 27 boss des 3 brèches ultimes (`ULTIMATE_BREACH`,
référentiel des donjons) sont TOUS aussi boss d'un donjon classique ; l'index
`dungeonsByBossMonsterId` était construit « premier arrivé gagne » sur l'ordre BRUT des entrées —
ordre du JSON pour le script de rattrapage, mais ordre PHYSIQUE des lignes de la table `dungeons`
(aucun `ORDER BY`, `db.select().from(dungeons)`/`GET /api/v1/dungeons`) pour le serveur live ET le
client : n'importe lequel de ces 27 boss pouvait retomber sur la brèche selon l'environnement (dev :
Hammamamoule ; prod : Flaqueux, Cacterre, Smarrante, Mont Zinit, Shukrute...). Une brèche ultime ne
se reconnaît JAMAIS par un boss seul (plusieurs boss distincts, priorité 0 de
`findDungeonForEnemies`) — l'index par boss unique doit donc préférer le donjon classique, quel que
soit l'ordre d'entrée : `indexDungeonsByBossMonsterId` (`core/utils/dungeon-boss-index.util.ts`),
partagé par les 3 constructeurs d'index (client `CatalogService.applyDungeons`, serveur
`loadCatalogFromDb`, script `backfill-dungeon-runs.ts::loadCatalog`). Ne jamais reconstruire cet
index à la main ailleurs.

- **Rattrapage en base** : `server/import/fix-breach-dungeon-ids.ts` (dry-run par défaut,
  `--apply`) — re-résout les combats rattachés à une brèche ultime, rattache leurs salles, recalcule
  `fight_type`. Nécessaire car aucun mécanisme existant ne corrige un `dungeon_id` déjà posé
  (`applyDungeonRunUpdates` n'écrit que `WHERE dungeon_id IS NULL`, le POST fait `COALESCE`).
- **2ᵉ trou découvert au passage** : dans `POST /api/v1/history/fights`, `recomputeDungeonRunsForBatch`
  peut rattacher des salles HORS du lot courant (fenêtre de lookback, envoyées par un POST
  antérieur), mais le recalcul de `fight_type` ne portait que sur le lot → ~155 combats prod avec
  `dungeon_id` posé et `fight_type` encore `FAMILY_*`/`null`. La fonction renvoie maintenant les
  ids rattachés, inclus dans le scope du recalcul ; rattrapage global via `backfill-fight-type
  --apply` (recalcul complet, idempotent). Règle : tout code qui pose `dungeon_id` doit recalculer
  `fight_type` pour LES MÊMES ids, jamais pour un sous-ensemble.

## Gotchas images et référentiels

- **`static.ankama.com` bloque les requêtes d'image portant un en-tête `Referer` d'un domaine tiers** (protection anti-hotlink) — un `<img src="https://static.ankama.com/...">` chargé normalement échoue silencieusement (pas d'erreur réseau visible autrement que l'event `error` de l'`<img>`), alors que la même URL fonctionne très bien ouverte directement ou via `curl` (qui n'envoie pas de Referer). Revérifié le 2026-09-20 : 403 avec `Referer: https://wakfu-companion.com/` sur `/web-test/*.png` (avatars) comme sur `/wakfu/portal/game/item/*` ; les images `/wakfu/portal/game/monster/42/*` renvoient 403 même sans Referer. **Ne plus contourner** avec `referrerpolicy="no-referrer"` : c'est un contournement délibéré d'une mesure technique d'Ankama (`docs/analyse-cgu.md`, § 3.7 et recommandation 5). Les recours objets (`wakfu-item-image-overrides.data.ts`) et l'illustration de combat (`fight-image.util.ts`) sont passés sur wakassets ce jour-là ; seules les galeries d'avatars fan-art (`avatar-fanart-galleries.data.ts`, page profil) hotlinkent encore `static.ankama.com`, décision en suspens (retirer la fonctionnalité ou assumer l'attribut sur ces seules balises).
- **`wakassets` répartit les monstres sur DEUX dossiers d'images distincts** : `monsters/{imgId}.png` (icônes carrées standard, ~200x200) ET `monsterIllustrations/{imgId}.png` (bannières rectangulaires ~132x41, souvent pour des boss/monstres spéciaux type "Troolk Hoogan"/"The Undertroolker"/"Rey Mystroolrio" — absents de `monsters/` mais présents dans `monsterIllustrations/`). Un même `imgId` ne se trouve jamais dans les deux. Vérifié : ajouter `monsterIllustrations/` en repli dans `entity-icon.component.ts` résout 34 des 61 monstres du référentiel (`wakfu-monster-catalog.data.ts`) qui n'avaient aucune image sous `monsters/` seul.
- **Le `gfxId` est la clé stable reliant le référentiel au CDN d'images tiers** (`vertylo.github.io/wakassets/items/{gfxId}.png`) — vérifié sur plusieurs objets (voir `core/api/catalog.service.ts` — le catalogue est servi par l'API distante depuis le lot 3.1, plus de table embarquée côté client).
- **Planche `class-portraits.data.ts` (`class-portraits-v2-*.png`, 320x1458, 4 colonnes x 18 lignes de cases 80x81 : [mâle coloré, mâle mat, femelle coloré, femelle mat])** : portraits "grand format" par classe ET par sexe, bien plus détaillés que `class-breeds.data.ts` (35x35). Colonnes "mat" et "coloré" utilisées pour le crossfade "mat au repos, coloré au survol" (voir `ClassPortraitComponent`, pas de filtre CSS). **L'ordre des 18 lignes N'EST PAS l'id interne de classe** (hypothèse initiale fausse, seule la 1ère ligne — Féca, id 1 — coïncidait par hasard) : `feca, sadida, sacrier, pandawa, rogue, zobal, foggernaut, osamodas, enutrof, sram, xelor, ecaflip, eniripsa, iop, cra, eliotrope, huppermage, ouginak`. Se fier UNIQUEMENT à une source objective pour ce genre d'ordre plutôt que déduire "à l'œil" depuis un ordre voisin (slugs, id...) qui n'a pas de raison de correspondre.
  - Un `url(...)` de cette planche écrit en dur dans le tableau `styles` d'un composant (plutôt que posé via `[style.background-image]`, voir `ClassPortraitComponent`) fait échouer le build : esbuild (plugin `angular-css-resource`) tente de la résoudre comme une ressource à bundler au lieu d'un chemin public servi au runtime.

## Liens de référence

- [wakfu-companion.nexuswow.workers.dev](https://wakfu-companion.nexuswow.workers.dev/) — site de référence Nexus-Hub (même nom de projet, sans lien de code avec cette app) : point de comparaison fonctionnel utile.
- [github.com/Vertylo/wakassets](https://github.com/Vertylo/wakassetvs/tree/main) — dépôt communautaire exposant la quasi-totalité des images du jeu (objets, monstres, illustrations...), utilisé comme CDN principal via GitHub Pages : `vertylo.github.io/wakassets/{items,monsters}/{gfxId ou imgId}.png` (voir `shared/item-icon`, `shared/entity-icon`). Cloné localement à l'époque pour un audit de couverture des tables embarquées (depuis remplacées par le catalogue distant) — remplace l'ancien fork `oumbra/wakfu-companion-asset`, qui n'est plus utilisé.
- [static.ankama.com/wakfu/portal/game/item/](https://static.ankama.com/wakfu/portal/game/item/) — CDN officiel Ankama, plus utilisé pour les objets depuis le 2026-09-20 (recours manuels `wakfu-item-image-overrides.data.ts` passés sur wakassets, voir les gotchas images ci-dessus).
