import {
  CatalogDungeonEntry,
  CatalogMonsterEntry,
  CatalogService,
  isDungeonBreach,
} from '../api/catalog.service';

/** Illustration générique wakassets, utilisée aussi bien en repli erreur réseau qu'en cas de trop grande diversité de monstres (voir resolveFightImageUrl). */
export const DEFAULT_FIGHT_IMAGE_URL =
  'https://vertylo.github.io/wakassets/bossIllustrations/default.png';

/**
 * Illustration officielle Ankama d'un monstre (utilisée pour l'illustration de combat, PAS pour
 * l'icône de dégâts/suivi — voir entity-icon.component.ts qui utilise wakassets). Contrairement à
 * l'URL équivalente pour un objet (voir item-icon.component.ts), celle-ci EST intégralement
 * déductible du `gfxId` : vérifié strictement 851/851 sur le référentiel actuel (le segment "42"
 * est constant pour tous les monstres) — c'est pourquoi elle n'est volontairement PAS incluse dans
 * l'index compact du catalogue (voir server/catalog/compact-index.ts).
 */
function monsterPictureUrl(gfxId: string): string {
  return `https://static.ankama.com/wakfu/portal/game/monster/42/${gfxId}.png`;
}

/** Au-delà de ce nombre de familles distinctes parmi les ennemis, le combat est considéré comme une horde hétérogène (pas un donjon/archi/dominant précis) — voir resolveFightImageUrl. */
const DISTINCT_FAMILY_THRESHOLD = 4;

/** Regroupe les monstres sans famille encyclopédie (`family: null`) dans un même repli, plutôt que de les compter comme autant de familles distinctes qu'il y a de monstres sans famille. */
const NO_FAMILY_KEY = 'none';

/** Nom localisé (4 langues, déjà présentes sur les entrées donjon/monstre) de l'entité
 * représentée par l'illustration d'un combat — l'appelant choisit la langue via
 * `I18nService.locale()`. `null` si aucune tooltip ne doit être affichée (illustration de
 * brèche, ou illustration générique de repli — voir resolveFightImageInfo). */
export interface FightImageLocalizedName {
  fr: string;
  en: string;
  es: string;
  pt: string;
}
export type FightImageTooltipSource =
  | { kind: 'dungeon'; names: FightImageLocalizedName }
  | { kind: 'monster'; names: FightImageLocalizedName }
  | null;

export interface FightImageInfo {
  url: string | null;
  tooltipSource: FightImageTooltipSource;
}

/** Donjon dont un boss présent parmi `enemyNames` est le boss attitré, ou `null` (aucun boss
 * reconnu parmi les ennemis, ou boss sans donjon référencé) — première étape de
 * `resolveFightImageInfo` ci-dessous, extraite pour être réutilisée telle quelle par
 * core/utils/dungeon-run-grouping.util.ts (regroupement des combats d'un même donjon dans
 * l'historique, qui a besoin de cette détection indépendamment de la résolution d'illustration). */
export function findDungeonForEnemies(
  catalog: CatalogService,
  enemyNames: readonly string[],
): CatalogDungeonEntry | null {
  for (const name of enemyNames) {
    const entry = catalog.findWakfuMonsterEntry(name);
    if (!entry?.isBoss) continue;
    const dungeon = catalog.findWakfuDungeonByBossMonsterId(entry.id);
    if (dungeon) return dungeon;
  }
  return null;
}

/**
 * Détermine l'illustration à afficher pour une entrée de l'historique des
 * combats, par ordre de priorité :
 * 1. Un ennemi boss (`isBoss`) présent -> illustration du donjon dont il est
 *    le boss (`bossMonsterId` dans repository/dungeons.json), ou à
 *    défaut (aucun donjon référencé pour ce boss) sa propre `pictureUrl`.
 * 2. Plus de ${DISTINCT_FAMILY_THRESHOLD} familles de monstres distinctes parmi les ennemis
 *    (horde hétérogène, pas un combat de donjon/archi/dominant) -> illustration générique.
 * 3. Un archimonstre (`isArchi`) présent -> sa `pictureUrl`.
 * 4. Un dominant (`isDominant`) présent -> sa `pictureUrl`.
 * 5. Sinon, l'ennemi ayant infligé le plus de dégâts -> sa `pictureUrl`.
 *
 * `enemyNames` doit être fourni dans l'ordre de dégâts décroissant (voir
 * FightRecord.rows, déjà trié ainsi) pour que le repli n°5 pointe vers le
 * bon monstre. Les noms sans entrée catalogue connue sont ignorés à
 * chaque étape (aucune image disponible pour eux). `tooltipSource` est
 * `null` pour une illustration de donjon-brèche (`isDungeonBreach`) ou pour
 * l'illustration générique de repli (horde hétérogène/inconnue) — voir
 * feature "tooltip sur les images d'historique de combat".
 *
 * Fonction PARAMÉTRÉE (pas un service) : `catalog` doit être un
 * `CatalogService` déjà injecté par l'appelant (composant), voir
 * getWakfuItemRarity (wakfu-item-rarity.data.ts) pour le même principe.
 *
 * `forceBossOwnImage` (faux par défaut) court-circuite le repli "donjon" de la priorité 1 : utilisé
 * par fight-history.component.ts pour la ligne du combat de boss À L'INTÉRIEUR d'un regroupement de
 * donjon déjà déplié (voir dungeon-run-grouping.util.ts) — l'image du donjon y est déjà portée par
 * l'en-tête du regroupement (`entry.dungeon.pictureUrl`), la ligne du boss doit donc afficher SA
 * propre illustration pour rester distinguable des salles au coup d'œil. Sans effet ailleurs
 * (combat isolé hors regroupement, mode de tri "Type"...) : le comportement par défaut reste
 * inchangé.
 */
export function resolveFightImageInfo(
  catalog: CatalogService,
  enemyNames: readonly string[],
  forceBossOwnImage = false,
): FightImageInfo {
  const entries = enemyNames
    .map((name) => catalog.findWakfuMonsterEntry(name))
    .filter((entry): entry is CatalogMonsterEntry => entry !== undefined);

  const bossEntry = entries.find((entry) => entry.isBoss);
  if (bossEntry) {
    const dungeon = forceBossOwnImage ? null : findDungeonForEnemies(catalog, enemyNames);
    if (dungeon) {
      return {
        url: dungeon.pictureUrl,
        tooltipSource: isDungeonBreach(dungeon) ? null : { kind: 'dungeon', names: dungeon },
      };
    }
    return {
      url: monsterPictureUrl(bossEntry.gfxId),
      tooltipSource: { kind: 'monster', names: bossEntry },
    };
  }

  const distinctFamilies = new Set(entries.map((entry) => entry.family ?? NO_FAMILY_KEY));
  if (distinctFamilies.size > DISTINCT_FAMILY_THRESHOLD) {
    return { url: DEFAULT_FIGHT_IMAGE_URL, tooltipSource: null };
  }

  const archiEntry = entries.find((entry) => entry.isArchi);
  if (archiEntry) {
    return {
      url: monsterPictureUrl(archiEntry.gfxId),
      tooltipSource: { kind: 'monster', names: archiEntry },
    };
  }

  const dominantEntry = entries.find((entry) => entry.isDominant);
  if (dominantEntry) {
    return {
      url: monsterPictureUrl(dominantEntry.gfxId),
      tooltipSource: { kind: 'monster', names: dominantEntry },
    };
  }

  const topDamageEntry = entries[0];
  if (topDamageEntry) {
    return {
      url: monsterPictureUrl(topDamageEntry.gfxId),
      tooltipSource: { kind: 'monster', names: topDamageEntry },
    };
  }

  return { url: null, tooltipSource: null };
}

/** Repli sans métadonnée de tooltip — voir resolveFightImageInfo. */
export function resolveFightImageUrl(
  catalog: CatalogService,
  enemyNames: readonly string[],
): string | null {
  return resolveFightImageInfo(catalog, enemyNames).url;
}
