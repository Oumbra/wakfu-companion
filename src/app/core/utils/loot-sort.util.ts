import { LootRow } from '../services/stats-store.service';
import { getWakfuItemRarity, RARITY_SORT_ORDER } from '../data/wakfu-item-rarity.data';

export type LootSort = 'name' | 'quantity' | 'rarity';

/** Tri partagé entre toutes les sections "butin" (historique > combat, recap > combat) — voir CLAUDE.md conventions UI transverses. */
export function sortLootRows(loot: readonly LootRow[], sort: LootSort): LootRow[] {
  if (sort === 'quantity') return [...loot].sort((a, b) => b.quantity - a.quantity);
  if (sort === 'rarity') {
    return [...loot].sort((a, b) => {
      const diff =
        RARITY_SORT_ORDER[getWakfuItemRarity(b.name)] - RARITY_SORT_ORDER[getWakfuItemRarity(a.name)];
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'fr');
    });
  }
  return [...loot].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function lootRarityClass(name: string): string {
  return `rarity-${getWakfuItemRarity(name)}`;
}
