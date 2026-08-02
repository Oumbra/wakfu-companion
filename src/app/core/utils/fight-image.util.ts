import { findWakfuMonsterEntry, WakfuMonsterEntry } from '../data/wakfu-monsters.data';
import { findWakfuDungeonByBossMonsterId } from '../data/wakfu-dungeons.data';

/** Illustration générique wakassets, utilisée aussi bien en repli erreur réseau qu'en cas de trop grande diversité de monstres (voir resolveFightImageUrl). */
export const DEFAULT_FIGHT_IMAGE_URL =
  'https://vertylo.github.io/wakassets/bossIllustrations/default.png';

/** Au-delà de ce nombre de familles distinctes parmi les ennemis, le combat est considéré comme une horde hétérogène (pas un donjon/archi/dominant précis) — voir resolveFightImageUrl. */
const DISTINCT_FAMILY_THRESHOLD = 4;

/** Regroupe les monstres sans famille encyclopédie (`family: null`) dans un même repli, plutôt que de les compter comme autant de familles distinctes qu'il y a de monstres sans famille. */
const NO_FAMILY_KEY = 'none';

/**
 * Détermine l'illustration à afficher pour une entrée de l'historique des
 * combats, par ordre de priorité :
 * 1. Un ennemi boss (`isBoss`) présent -> illustration du donjon dont il est
 *    le boss (`bossMonsterId` dans referentiel/dungeons_wakfu.json), ou à
 *    défaut (aucun donjon référencé pour ce boss) sa propre `pictureUrl`.
 * 2. Plus de ${DISTINCT_FAMILY_THRESHOLD} familles de monstres distinctes parmi les ennemis
 *    (horde hétérogène, pas un combat de donjon/archi/dominant) -> illustration générique.
 * 3. Un archimonstre (`isArchi`) présent -> sa `pictureUrl`.
 * 4. Un dominant (`isDominant`) présent -> sa `pictureUrl`.
 * 5. Sinon, l'ennemi ayant infligé le plus de dégâts -> sa `pictureUrl`.
 *
 * `enemyNames` doit être fourni dans l'ordre de dégâts décroissant (voir
 * FightRecord.rows, déjà trié ainsi) pour que le repli n°5 pointe vers le
 * bon monstre. Les noms sans entrée référentiel connue sont ignorés à
 * chaque étape (aucune image disponible pour eux).
 */
export function resolveFightImageUrl(enemyNames: readonly string[]): string | null {
  const entries = enemyNames
    .map((name) => findWakfuMonsterEntry(name))
    .filter((entry): entry is WakfuMonsterEntry => entry !== undefined);

  const bossEntry = entries.find((entry) => entry.isBoss);
  if (bossEntry) {
    const dungeon = findWakfuDungeonByBossMonsterId(bossEntry.id);
    return dungeon?.pictureUrl ?? bossEntry.pictureUrl;
  }

  const distinctFamilies = new Set(entries.map((entry) => entry.family ?? NO_FAMILY_KEY));
  if (distinctFamilies.size > DISTINCT_FAMILY_THRESHOLD) {
    return DEFAULT_FIGHT_IMAGE_URL;
  }

  const archiEntry = entries.find((entry) => entry.isArchi);
  if (archiEntry) return archiEntry.pictureUrl;

  const dominantEntry = entries.find((entry) => entry.isDominant);
  if (dominantEntry) return dominantEntry.pictureUrl;

  return entries[0]?.pictureUrl ?? null;
}
