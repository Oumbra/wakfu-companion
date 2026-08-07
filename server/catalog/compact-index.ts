import type { WakfuRarityCode } from '../db/schema';

/** Doit rester identique à src/app/core/data/wakfu-item-rarity.data.ts (RARITY_SORT_ORDER). */
export const RARITY_SORT_ORDER: Record<WakfuRarityCode, number> = {
  old: 0,
  common: 1,
  rare: 2,
  mythical: 3,
  legendary: 4,
  memory: 5,
  epic: 6,
  relic: 7,
};

export interface CompactIndexItemInput {
  ankamaId: number | null;
  fr: string;
  gfxId: number;
  rarity: WakfuRarityCode;
  hasRecipe: boolean;
}

export interface CompactIndexMonsterInput {
  id: number;
  fr: string;
  gfxId: string;
}

/**
 * Construit l'index compact servi par GET /api/v1/catalog/index — tuples
 * plutôt qu'objets (pas de clés répétées ~11 700 fois) pour rester sous la
 * cible de taille du prompt 2.2 (voir server/README.md pour le détail des
 * mesures réelles ~463 Ko bruts / ~149 Ko gzip). Ordre des champs :
 *   items    : [id, nomFr, gfxId, raritySortOrder, hasRecipe(0|1)]
 *   monsters : [id, nomFr, gfxId]
 * Triés par id croissant pour un résultat déterministe (empreinte stable
 * tant que le contenu ne change pas — voir catalogMeta.indexHash). Les
 * objets sans id Ankama (~142 entrées historiques, voir schema.ts) sont
 * exclus : ils ne peuvent de toute façon pas être résolus par
 * GET /api/v1/items/{id}, seul débouché prévu de cet index.
 *
 * Module PARTAGÉ entre server/import/import-catalog.ts (calcul de
 * l'empreinte au moment de l'import) et functions/api/v1/catalog/index.ts
 * (réponse servie) : les deux DOIVENT produire des octets strictement
 * identiques pour que indexHash reste une empreinte fiable de ce qui est
 * réellement servi.
 */
export function buildCompactIndex(
  itemRows: readonly CompactIndexItemInput[],
  monsterRows: readonly CompactIndexMonsterInput[],
): { items: (number | string)[][]; monsters: (number | string)[][] } {
  const compactItems = itemRows
    .filter((item): item is CompactIndexItemInput & { ankamaId: number } => item.ankamaId !== null)
    .slice()
    .sort((a, b) => a.ankamaId - b.ankamaId)
    .map((item) => [
      item.ankamaId,
      item.fr,
      item.gfxId,
      RARITY_SORT_ORDER[item.rarity],
      item.hasRecipe ? 1 : 0,
    ]);
  const compactMonsters = monsterRows
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((monster) => [monster.id, monster.fr, monster.gfxId]);
  return { items: compactItems, monsters: compactMonsters };
}
