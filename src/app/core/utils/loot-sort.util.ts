import { LootRow } from '../services/stats-store.service';
import { getWakfuItemRarity, RARITY_SORT_ORDER } from '../data/wakfu-item-rarity.data';
import { CatalogService } from '../api/catalog.service';

export type LootSort = 'name' | 'quantity' | 'rarity';

/** Tri partagé entre toutes les sections "butin" (historique > combat, recap > combat) — voir CLAUDE.md conventions UI transverses. */
export function sortLootRows(
  catalog: CatalogService,
  loot: readonly LootRow[],
  sort: LootSort,
): LootRow[] {
  if (sort === 'quantity') return [...loot].sort((a, b) => b.quantity - a.quantity);
  if (sort === 'rarity') {
    return [...loot].sort((a, b) => {
      const diff =
        RARITY_SORT_ORDER[getWakfuItemRarity(catalog, b.name, b.catalogId)] -
        RARITY_SORT_ORDER[getWakfuItemRarity(catalog, a.name, a.catalogId)];
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'fr');
    });
  }
  return [...loot].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function lootRarityClass(catalog: CatalogService, name: string, id?: number | null): string {
  return `rarity-${getWakfuItemRarity(catalog, name, id)}`;
}
