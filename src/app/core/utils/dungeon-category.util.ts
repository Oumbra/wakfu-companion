import { WakfuDungeonType } from '../api/catalog.service';

/**
 * Ordre d'affichage fixe des catégories de donjon pour tout système d'en-têtes de section (2/3/4
 * salles, 3 joueurs, boss ultime, brèche, brèche ultime, arcade en dernier faute de consigne dédiée
 * — voir CLAUDE.md) — source commune à `SessionRecapComponent` (mode "Type"/sections du mode "Donjon
 * & Famille") ET `FightHistoryComponent` (regroupement "Donjons & familles", en-têtes de section) :
 * les deux doivent afficher EXACTEMENT le même ordre de catégories (demande explicite de
 * l'utilisateur, 2026-08-30) — un seul tableau évite qu'ils dérivent l'un de l'autre au fil des
 * évolutions futures.
 *
 * Volontairement DIFFÉRENT de `DUNGEON_TYPE_CATEGORY_RANK` (fight-image.util.ts, qui trie les
 * GROUPES individuels du regroupement "Type"/"Donjons & familles" lui-même, pas les en-têtes de
 * section) : ce rang-là place `ARCADE` avant les brèches, cet ordre-ci le place en dernier — deux
 * besoins distincts calibrés séparément, pas une incohérence à corriger.
 */
export const DUNGEON_TYPE_ORDER: readonly WakfuDungeonType[] = [
  'TWO_ROOMS',
  'THREE_ROOMS',
  'FOUR_ROOMS',
  'THREE_PLAYERS',
  'ULTIMATE_BOSS',
  'BREACH',
  'ULTIMATE_BREACH',
  'ARCADE',
];

/** Clé i18n du libellé de chaque catégorie — voir translations.ts (`sessionRecap.period.dungeonType.*`,
 * déjà utilisées par la carte Récap, réutilisées telles quelles ici plutôt que dupliquées). */
export const DUNGEON_TYPE_LABEL_KEY: Record<WakfuDungeonType, string> = {
  TWO_ROOMS: 'sessionRecap.period.dungeonType.twoRooms',
  THREE_ROOMS: 'sessionRecap.period.dungeonType.threeRooms',
  FOUR_ROOMS: 'sessionRecap.period.dungeonType.fourRooms',
  THREE_PLAYERS: 'sessionRecap.period.dungeonType.threePlayers',
  ULTIMATE_BOSS: 'sessionRecap.period.dungeonType.ultimateBoss',
  BREACH: 'sessionRecap.period.dungeonType.breach',
  ULTIMATE_BREACH: 'sessionRecap.period.dungeonType.ultimateBreach',
  ARCADE: 'sessionRecap.period.dungeonType.arcade',
};

/** Clé i18n du libellé de la section "hors donjon" (familles de monstre) — voir translations.ts
 * (`sessionRecap.period.familiesSection`), même réutilisation. */
export const FAMILIES_SECTION_LABEL_KEY = 'sessionRecap.period.familiesSection';
