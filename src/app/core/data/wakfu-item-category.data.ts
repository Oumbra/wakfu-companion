/**
 * Catégorie d'un objet (filtre par icône dans l'autocomplétion, voir
 * shared/wakfu-autocomplete), lue depuis le catalogue distant (même principe que
 * wakfu-item-rarity.data.ts — repli sur "misc" pour tout objet absent du catalogue).
 *
 * Correspondance avec `itemTypeId` (gamedata brut Ankama, `baseParameters.itemTypeId` dans
 * items.json/`itemTypeId` dans jobsItems.json) : établie à la main (voir
 * server/import/import-catalog.ts) à partir de l'arbre de filtre "Types" de l'encyclopédie
 * officielle (equipement_1/2.png, ressources.png, recoltes.png, havre-sac.png, cosmetiques.png
 * fournis par l'utilisateur) et de la connaissance du jeu pour les itemTypeId ambigus non
 * documentés visuellement (ex. 811 "Enchantement", proche des sublimations). Tout objet dont
 * l'itemTypeId n'a pas de correspondance connue (notamment les ~9200 objets du référentiel
 * absents de la gamedata Ankama actuelle — objets historiques retirés du jeu, jamais retaggés
 * rareté "old") retombe sur "misc" (catégorie "Divers"), comme demandé.
 *
 * PAS de catégorie "enemy" ici : les monstres ne sont pas des objets (voir
 * WakfuSearchResult.kind côté core/services/wakfu-search.service.ts) — le filtre "Ennemis" de
 * l'autocomplétion (domaine `both`) se base sur `kind === 'enemy'`, pas sur ce champ.
 */
export type WakfuItemCategory =
  | 'equipment'
  | 'resources'
  | 'sublimations'
  | 'harvests'
  | 'havenBag'
  | 'cosmetics'
  | 'misc';

export const WAKFU_ITEM_CATEGORIES: readonly WakfuItemCategory[] = [
  'equipment',
  'resources',
  'sublimations',
  'harvests',
  'havenBag',
  'cosmetics',
  'misc',
];

/** Ordre d'encodage dans le tuple compact de l'index catalogue — DOIT rester la même table que
 * server/catalog/compact-index.ts (CATEGORY_SORT_ORDER). */
export const ITEM_CATEGORY_SORT_ORDER: Readonly<Record<WakfuItemCategory, number>> = {
  equipment: 0,
  resources: 1,
  sublimations: 2,
  harvests: 3,
  havenBag: 4,
  cosmetics: 5,
  misc: 6,
};

/** Numéro d'icône `itemTypes` Ankama (voir wakassets/itemTypes/{n}.png, même CDN que les icônes
 * d'objets/monstres/raretés) représentant la catégorie dans l'arbre de filtre "Types" de
 * l'encyclopédie officielle. */
const ITEM_CATEGORY_ICON_NUMBER: Readonly<Record<WakfuItemCategory, number>> = {
  equipment: 109,
  resources: 226,
  sublimations: 602,
  harvests: 237,
  havenBag: 295,
  cosmetics: 525,
  misc: 385,
};

/** URL de l'icône de catégorie (wakassets, même CDN que wakfuRarityIconUrl). */
export function wakfuItemCategoryIconUrl(category: WakfuItemCategory): string {
  return `https://vertylo.github.io/wakassets/itemTypes/${ITEM_CATEGORY_ICON_NUMBER[category]}.png`;
}

/** Icône de catégorie "Ennemis" (filtre par `kind === 'enemy'`, pas une vraie WakfuItemCategory —
 * voir doc de tête de fichier) — même CDN, id fourni par l'utilisateur à partir de l'arbre de
 * filtre officiel. */
export const WAKFU_ENEMY_CATEGORY_ICON_URL = 'https://vertylo.github.io/wakassets/itemTypes/282.png';
