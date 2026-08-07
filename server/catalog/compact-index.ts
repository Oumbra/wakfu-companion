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
  en: string;
  es: string;
  pt: string;
  gfxId: number;
  rarity: WakfuRarityCode;
  hasRecipe: boolean;
}

export interface CompactIndexMonsterInput {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  gfxId: string;
  family: number | null;
  isBoss: boolean;
  isArchi: boolean;
  isDominant: boolean;
}

/**
 * Construit l'index compact servi par GET /api/v1/catalog/ (PAS
 * /api/v1/catalog/index — segment "index" réservé par Cloudflare Pages
 * Functions, voir functions/api/v1/catalog/index.ts) — tuples
 * plutôt qu'objets (pas de clés répétées ~11 700 fois) pour rester aussi
 * compact que possible (voir server/README.md pour le détail des mesures
 * réelles ~1,14 Mo bruts / ~348 Ko gzip). Ordre des champs :
 *   items    : [id, fr, en, es, pt, gfxId, raritySortOrder, hasRecipe(0|1)]
 *   monsters : [id, fr, en, es, pt, gfxId, family(-1 si null), isBoss(0|1), isArchi(0|1), isDominant(0|1)]
 * Triés par id croissant pour un résultat déterministe (empreinte stable
 * tant que le contenu ne change pas — voir catalogMeta.indexHash). Les
 * objets sans id Ankama (~142 entrées historiques, voir schema.ts) sont
 * exclus : ils ne peuvent de toute façon pas être résolus par
 * GET /api/v1/items/{id}, seul débouché prévu de cet index.
 *
 * v2 (lot 3.1) — les 4 langues sont nécessaires : findWakfuItemEntry côté
 * client doit reconnaître un objet quel que soit le nom lu dans wakfu.log
 * (client Wakfu de l'utilisateur pas forcément en français), contrainte
 * découverte en démarrant le lot 3.1 (le v1 du lot 2.2, FR seul, ne le
 * permettait pas). `wakassetsAvailable`/`pictureUrl`/`wakfuAvailable`
 * (résolution d'icône, voir item-icon/entity-icon) restent volontairement
 * hors de l'index : `pictureUrl` n'est pas déductible du gfxId et
 * alourdirait significativement l'index pour un gain marginal (mesuré :
 * seuls 1 objet sur 10 890 et 9 monstres sur 851 n'ont PAS wakassets comme
 * source d'image valide — le client essaie wakassets puis un CDN de repli
 * inconditionnellement, sans avoir besoin du flag).
 *
 * v3 (lot 3.1, étape 4) — ajoute family/isBoss/isArchi/isDominant aux
 * monstres : nécessaires à resolveFightImageInfo (fight-image.util.ts,
 * illustration d'un combat dans l'historique) pour rester synchrone. `family`
 * encodé en `-1` quand `null` (28 monstres sur 851 — pas de famille
 * encyclopédie). Impact mesuré sur le référentiel actuel (mêmes règles
 * d'extraction que server/import/import-catalog.ts, gzip niveau 9) :
 * +7 559 octets bruts / +1 301 octets gzip pour les 851 monstres — négligeable
 * par rapport au total (voir server/README.md pour la mesure v2 de référence).
 * PAS de pictureUrl monstre dans l'index (contrairement à ce qui a été
 * envisagé pour les objets) : contrairement à ceux-ci, l'URL est
 * intégralement déductible de gfxId
 * (`https://static.ankama.com/wakfu/portal/game/monster/42/{gfxId}.png`,
 * vérifié strictement 851/851 sur le référentiel actuel — voir
 * fight-image.util.ts).
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
      item.en,
      item.es,
      item.pt,
      item.gfxId,
      RARITY_SORT_ORDER[item.rarity],
      item.hasRecipe ? 1 : 0,
    ]);
  const compactMonsters = monsterRows
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((monster) => [
      monster.id,
      monster.fr,
      monster.en,
      monster.es,
      monster.pt,
      monster.gfxId,
      monster.family ?? -1,
      monster.isBoss ? 1 : 0,
      monster.isArchi ? 1 : 0,
      monster.isDominant ? 1 : 0,
    ]);
  return { items: compactItems, monsters: compactMonsters };
}
