/**
 * Catégorie large d'un objet (filtre par icône dans l'autocomplétion, voir
 * shared/wakfu-autocomplete), lue depuis le catalogue distant (même principe que
 * wakfu-item-rarity.data.ts — repli sur "misc" pour tout objet absent du catalogue).
 *
 * Calculée à l'import (voir server/import/import-catalog.ts, ITEM_SUBCATEGORY_CATALOG) à partir
 * de la sous-catégorie fine de chaque objet (`category` dans repository/items.json — texte
 * français issu de l'arbre de filtre "Types" de l'encyclopédie officielle, stocké côté serveur
 * dans la table `item_categories`, voir server/db/schema.ts et ITEM_SUBCATEGORY_CATALOG dans
 * server/import/import-catalog.ts pour la table de référence des ~45 libellés connus, regroupée
 * depuis les captures fournies par l'utilisateur : equipement_1/2.png, ressources.png,
 * recoltes.png, havre-sac.png, cosmetiques.png). Un objet dont la sous-catégorie ne correspond à
 * aucun de ces libellés connus (notamment la sous-catégorie fourre-tout "Divers" elle-même)
 * retombe sur "craft" s'il a une recette (`hasRecipe`), sinon sur "misc" ("Divers").
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
  | 'craft'
  | 'misc';

export const WAKFU_ITEM_CATEGORIES: readonly WakfuItemCategory[] = [
  'equipment',
  'resources',
  'sublimations',
  'harvests',
  'havenBag',
  'cosmetics',
  'craft',
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
  craft: 6,
  misc: 7,
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
  craft: 761,
  misc: 385,
};

/** URL de l'icône de catégorie (wakassets, même CDN que wakfuRarityIconUrl). */
export function wakfuItemCategoryIconUrl(category: WakfuItemCategory): string {
  return `https://vertylo.github.io/wakassets/itemTypes/${ITEM_CATEGORY_ICON_NUMBER[category]}.png`;
}

/** Icône de catégorie "Monstres" (filtre par `kind === 'enemy'`, pas une vraie WakfuItemCategory —
 * voir doc de tête de fichier) — même CDN, id fourni par l'utilisateur à partir de l'arbre de
 * filtre officiel. */
export const WAKFU_MONSTER_CATEGORY_ICON_URL =
  'https://vertylo.github.io/wakassets/itemTypes/282.png';

/** Icône du filtre "Tout" (réinitialise le filtre par catégorie actif, voir
 * WakfuAutocompleteComponent.toggleCategoryFilter) — même CDN, id -1 (icône générique "tous
 * types" de l'arbre de filtre officiel). */
export const WAKFU_ALL_CATEGORY_ICON_URL = 'https://vertylo.github.io/wakassets/itemTypes/-1.png';

/** Icône d'une récupération de kamas à l'Hôtel de vente dans l'historique des achats (voir
 * StatsStoreService.HDV_KAMAS_SALE_ITEM/PurchasesComponent) — même CDN, id fourni par
 * l'utilisateur. Pas une vraie WakfuItemCategory (aucun objet réel n'y correspond), même principe
 * que WAKFU_MONSTER_CATEGORY_ICON_URL ci-dessus. */
export const WAKFU_HDV_KAMAS_ICON_URL = 'https://vertylo.github.io/wakassets/itemTypes/614.png';
