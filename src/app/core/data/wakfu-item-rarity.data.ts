/**
 * Rareté (FR minuscule -> palier) des objets, lue depuis le référentiel
 * complet (voir wakfu-items.data.ts, généré depuis referentiel/items_wakfu.json).
 * Repli sur "common" pour tout objet absent du référentiel (ex. ajouté
 * manuellement au suivi sous un nom introuvable).
 */
import { findWakfuItemEntry } from './wakfu-items.data';

export type WakfuRarity =
  | 'common'
  | 'rare'
  | 'mythical'
  | 'legendary'
  | 'souvenir'
  | 'epic'
  | 'relic';

export function getWakfuItemRarity(name: string): WakfuRarity {
  return findWakfuItemEntry(name)?.rarity ?? 'common';
}

/** Ordre de tri croissant des raretés (pas de rapport avec leur valeur en jeu). */
export const RARITY_SORT_ORDER: Readonly<Record<WakfuRarity, number>> = {
  common: 0,
  rare: 1,
  mythical: 2,
  legendary: 3,
  souvenir: 4,
  epic: 5,
  relic: 6,
};
