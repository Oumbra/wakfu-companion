import { LootRow } from '../services/stats-store.service';
import { I18nService } from '../services/i18n.service';
import { getWakfuItemRarity, RARITY_SORT_ORDER } from '../data/wakfu-item-rarity.data';
import { CatalogService } from '../api/catalog.service';

export type LootSort = 'name' | 'quantity' | 'rarity';

/**
 * Tri partagé entre toutes les sections "butin" (historique > combat, recap > combat) — voir
 * CLAUDE.md conventions UI transverses. `reverse` inverse l'ordre par défaut de `sort` (reclic sur
 * un switch déjà actif, voir `nextLootSortState` ci-dessous) — appliqué en dernier via
 * `.reverse()` plutôt qu'en inversant chaque comparateur, pour que l'ordre alphabétique de
 * départage (tri par rareté) s'inverse lui aussi de façon cohérente avec le reste.
 */
export function sortLootRows(
  catalog: CatalogService,
  loot: readonly LootRow[],
  sort: LootSort,
  reverse = false,
): LootRow[] {
  let sorted: LootRow[];
  if (sort === 'quantity') {
    sorted = [...loot].sort((a, b) => b.quantity - a.quantity);
  } else if (sort === 'rarity') {
    sorted = [...loot].sort((a, b) => {
      const diff =
        RARITY_SORT_ORDER[getWakfuItemRarity(catalog, b.name, b.catalogId)] -
        RARITY_SORT_ORDER[getWakfuItemRarity(catalog, a.name, a.catalogId)];
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'fr');
    });
  } else {
    sorted = [...loot].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
  return reverse ? sorted.reverse() : sorted;
}

/**
 * Calcule le prochain état (mode + sens) au clic sur une option du switch de tri butin — reclic sur
 * le mode déjà actif inverse le sens, clic sur un autre mode repart de son sens par défaut (comme
 * un tri de tableau classique : changer de colonne ne garde pas le sens inversé de la précédente).
 * Mécanique partagée entre `FightHistoryComponent` et `SessionRecapComponent` (mêmes signaux
 * `lootSort`/`lootSortReverse` dans chacun, header/template volontairement non unifiés — voir
 * CLAUDE.md conventions UI transverses) pour ne pas dupliquer cette logique deux fois.
 */
export function nextLootSortState(
  currentSort: LootSort,
  currentReverse: boolean,
  mode: LootSort,
): { sort: LootSort; reverse: boolean } {
  return currentSort === mode
    ? { sort: mode, reverse: !currentReverse }
    : { sort: mode, reverse: false };
}

const LOOT_SORT_TOOLTIP_KEYS: Record<LootSort, string> = {
  name: 'damageMeter.sortName',
  quantity: 'damageMeter.sortQuantity',
  rarity: 'damageMeter.sortRarity',
};

/** Libellé du switch de tri butin, suffixé d'une flèche ▲/▼ pour le mode actif afin d'indiquer le
 * sens courant (reclic sur ce même mode = inverse, voir `nextLootSortState`). */
export function lootSortTooltip(
  i18n: I18nService,
  activeSort: LootSort,
  activeReverse: boolean,
  mode: LootSort,
): string {
  const label = i18n.t(LOOT_SORT_TOOLTIP_KEYS[mode]);
  return activeSort === mode ? `${label} ${activeReverse ? '▲' : '▼'}` : label;
}

export function lootRarityClass(catalog: CatalogService, name: string, id?: number | null): string {
  return `rarity-${getWakfuItemRarity(catalog, name, id)}`;
}
