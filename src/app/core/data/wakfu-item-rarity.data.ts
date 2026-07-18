/**
 * Rareté (FR minuscule -> palier) des objets, lue depuis le référentiel
 * complet (voir wakfu-items.data.ts, généré depuis referentiel/items_wakfu.json).
 * Repli sur "common" pour tout objet absent du référentiel (ex. ajouté
 * manuellement au suivi sous un nom introuvable).
 */
import { WAKFU_ITEMS_FR } from './wakfu-items.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';

export type WakfuRarity =
  | 'common'
  | 'rare'
  | 'mythical'
  | 'legendary'
  | 'souvenir'
  | 'epic'
  | 'relic';

export function getWakfuItemRarity(name: string): WakfuRarity {
  return WAKFU_ITEMS_FR[normalizeWakfuName(name)]?.rarity ?? 'common';
}
