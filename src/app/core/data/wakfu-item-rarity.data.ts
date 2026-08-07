/**
 * Rareté (FR minuscule -> palier) des objets, lue depuis le catalogue distant
 * (voir core/api/catalog.service.ts, remplace depuis le lot 3.1 étape 4 la
 * table embarquée wakfu-items.data.ts). Repli sur "common" pour tout objet
 * absent du catalogue (ex. ajouté manuellement au suivi sous un nom
 * introuvable, ou catalogue pas encore chargé).
 *
 * Correspondance avec la rareté numérique brute d'Ankama (`definition.rarity`
 * dans les gamedata `items.json`/`jobsItems.json`) : 0 "Qualité commune" ->
 * `old`, 1 "Inhabituel" -> `common`, 2 "Rare" -> `rare`, 3 "Mythique" ->
 * `mythical`, 4 "Légendaire" -> `legendary`, 5 "Relique" -> `relic`,
 * 6 "PVP" -> `memory`, 7 "Epique" -> `epic`. `old` (trad. FR "Ancien") désigne
 * des objets historiques retirés du jeu — voir server/import/import-catalog.ts
 * et tools/generate-wakfu-items-data.mjs, qui les excluent tous deux de ce
 * qui est exposé côté client (jamais résolus par findWakfuItemEntry, donc
 * getWakfuItemRarity() ne retourne jamais `old` au runtime ; conservé
 * uniquement pour typer correctement referentiel/items_wakfu.json).
 *
 * Fonction PARAMÉTRÉE (pas injectable elle-même, c'est une fonction libre,
 * pas un service) : l'appelant (déjà dans un contexte d'injection — composant
 * ou classe recevant ses dépendances par constructeur) lui passe son
 * `CatalogService` déjà injecté, plutôt qu'un import statique du référentiel
 * embarqué.
 */
import type { CatalogService } from '../api/catalog.service';

export type WakfuRarity =
  'old' | 'common' | 'rare' | 'mythical' | 'legendary' | 'memory' | 'epic' | 'relic';

export function getWakfuItemRarity(catalog: CatalogService, name: string): WakfuRarity {
  return catalog.findWakfuItemEntry(name)?.rarity ?? 'common';
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

/** Numéro d'icône de rareté Ankama (voir wakassets/rarities/{n}.png) — correspond à la rareté
 * numérique brute d'Ankama, voir le tableau de correspondance en tête de fichier. */
const RARITY_ICON_NUMBER: Readonly<Record<WakfuRarity, number>> = {
  old: 0,
  common: 1,
  rare: 2,
  mythical: 3,
  legendary: 4,
  relic: 5,
  memory: 6,
  epic: 7,
};

/** URL de l'icône de rareté (wakassets, même CDN que les icônes d'objets/monstres). */
export function wakfuRarityIconUrl(rarity: WakfuRarity): string {
  return `https://vertylo.github.io/wakassets/rarities/${RARITY_ICON_NUMBER[rarity]}.png`;
}
