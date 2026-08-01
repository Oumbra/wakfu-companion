/**
 * Rareté (FR minuscule -> palier) des objets, lue depuis le référentiel
 * complet (voir wakfu-items.data.ts, généré depuis referentiel/items_wakfu.json).
 * Repli sur "common" pour tout objet absent du référentiel (ex. ajouté
 * manuellement au suivi sous un nom introuvable).
 *
 * Correspondance avec la rareté numérique brute d'Ankama (`definition.rarity`
 * dans les gamedata `items.json`/`jobsItems.json`) : 0 "Qualité commune" ->
 * `old`, 1 "Inhabituel" -> `common`, 2 "Rare" -> `rare`, 3 "Mythique" ->
 * `mythical`, 4 "Légendaire" -> `legendary`, 5 "Relique" -> `relic`,
 * 6 "PVP" -> `memory`, 7 "Epique" -> `epic`. `old` (trad. FR "Ancien") désigne
 * des objets historiques retirés du jeu — voir tools/generate-wakfu-items-data.mjs,
 * qui les exclut de la table utilisée par l'UI (jamais résolus par
 * findWakfuItemEntry, donc getWakfuItemRarity() ne retourne jamais `old` au
 * runtime ; conservé uniquement pour typer correctement referentiel/items_wakfu.json).
 */
import { findWakfuItemEntry } from './wakfu-items.data';

export type WakfuRarity =
  | 'old'
  | 'common'
  | 'rare'
  | 'mythical'
  | 'legendary'
  | 'memory'
  | 'epic'
  | 'relic';

export function getWakfuItemRarity(name: string): WakfuRarity {
  return findWakfuItemEntry(name)?.rarity ?? 'common';
}

/** Ordre de tri croissant des raretés (pas de rapport avec leur valeur en jeu). */
export const RARITY_SORT_ORDER: Readonly<Record<WakfuRarity, number>> = {
  old: 0,
  common: 1,
  rare: 2,
  mythical: 3,
  legendary: 4,
  memory: 5,
  epic: 6,
  relic: 7,
};
