import {
  CatalogDungeonEntry,
  CatalogMonsterEntry,
  CatalogService,
  WakfuDungeonType,
  isDungeonBreach,
} from '../api/catalog.service';
import { normalizeWakfuName } from './wakfu-name.util';
import { BREACH_IMAGE_URL } from '../data/breach-icon.data';

/** Illustration générique wakassets, utilisée en repli erreur réseau (voir onFightImageError dans
 * fight-history.component.ts) quand même les replis wakassets d'un monstre échouent. Depuis le
 * 2026-08-24, n'est PLUS utilisée pour le cas "horde hétérogène" (voir BREACH_IMAGE_URL ci-dessous,
 * plus précis). */
export const DEFAULT_FIGHT_IMAGE_URL =
  'https://vertylo.github.io/wakassets/bossIllustrations/default.png';

/**
 * Illustration officielle Ankama d'un monstre (utilisée pour l'illustration de combat, PAS pour
 * l'icône de dégâts/suivi — voir entity-icon.component.ts qui utilise wakassets). Contrairement à
 * l'URL équivalente pour un objet (voir item-icon.component.ts), le GABARIT d'URL EST intégralement
 * déductible du `gfxId` : vérifié strictement 851/851 sur le référentiel actuel (le segment "42"
 * est constant pour tous les monstres) — c'est pourquoi elle n'est volontairement PAS incluse dans
 * l'index compact du catalogue (voir server/catalog/compact-index.ts). ⚠️ Ne garantit PAS que
 * l'asset existe réellement à cette URL pour tout `gfxId` (au moins 24/851 renvoient 403, voir
 * monsterPictureFallbacks juste en dessous — bug réel corrigé le 2026-08-24, ex. "Larve Verte") :
 * cette fonction reste volontairement le 1er choix (image officielle) mais jamais la seule
 * tentative côté appelant.
 */
function monsterPictureUrl(gfxId: string): string {
  return `https://static.ankama.com/wakfu/portal/game/monster/42/${gfxId}.png`;
}

/**
 * URLs de repli (wakassets, voir shared/entity-icon/entity-icon.component.ts) pour l'illustration
 * "propre image du monstre" de resolveFightImageInfo — bug réel corrigé le 2026-08-24 : contrairement
 * à ce qu'affirmait un commentaire d'origine ("851/851 déductible du gfxId"), au moins 24 monstres du
 * référentiel actuel (`repository/monsters.json`, champ `wakfu_available: false`, ex. "Larve Verte")
 * n'ont PAS d'image sur le CDN Ankama (403, asset absent) alors que wakassets l'a bien (200) — ce
 * champ `wakfu_available` n'est de toute façon pas inclus dans l'index compact servi au client (voir
 * server/catalog/compact-index.ts), donc pas exploitable directement ici : on tente Ankama en premier
 * (image officielle, meilleure qualité) puis ces deux replis en cas d'échec de chargement (voir
 * onFightImageError dans fight-history.component.ts), plutôt que de tomber directement sur
 * l'illustration générique DEFAULT_FIGHT_IMAGE_URL comme avant ce correctif.
 */
function monsterPictureFallbacks(gfxId: string): string[] {
  return [
    `https://vertylo.github.io/wakassets/monsters/${gfxId}.png`,
    `https://vertylo.github.io/wakassets/monsterIllustrations/${gfxId}.png`,
  ];
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
  /** URLs de repli à essayer, dans l'ordre, si `url` échoue à charger (voir onFightImageError dans
   * fight-history.component.ts) — vide pour un `url` de donjon ou déjà générique (repli direct sur
   * DEFAULT_FIGHT_IMAGE_URL dans ces cas, comme avant ce champ), voir monsterPictureFallbacks. */
  fallbackUrls: string[];
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
 *    (horde hétérogène, pas un combat de donjon/archi/dominant) -> illustration de brèche
 *    (BREACH_IMAGE_URL, voir breach-icon.data.ts) — heuristique de détection de brèche actuelle,
 *    faute d'un signal plus précis (pas de distinction simple/ultime pour l'instant, voir
 *    breach-icon.data.ts).
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
 * `fallbackUrls` (voir FightImageInfo) accompagne `url` pour les priorités 1(repli)/3/4/5 (propre
 * image d'un monstre, jamais un donjon) : des replis wakassets, à essayer par l'appelant si `url`
 * (CDN Ankama) échoue au chargement — voir monsterPictureFallbacks.
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
        fallbackUrls: [],
      };
    }
    return {
      url: monsterPictureUrl(bossEntry.gfxId),
      tooltipSource: { kind: 'monster', names: bossEntry },
      fallbackUrls: monsterPictureFallbacks(bossEntry.gfxId),
    };
  }

  const distinctFamilies = new Set(entries.map((entry) => entry.family ?? NO_FAMILY_KEY));
  if (distinctFamilies.size > DISTINCT_FAMILY_THRESHOLD) {
    // Heuristique actuelle de détection de brèche : aucun autre signal fiable (pas de boss, pas de
    // dungeon référencé) tant que la composition en familles des brèches connues n'est pas saisie
    // dans le référentiel — voir breach-icon.data.ts. BREACH_IMAGE_URL en repli plutôt que
    // DEFAULT_FIGHT_IMAGE_URL (générique, sans rapport avec une brèche) depuis le 2026-08-24.
    return { url: BREACH_IMAGE_URL, tooltipSource: null, fallbackUrls: [] };
  }

  const archiEntry = entries.find((entry) => entry.isArchi);
  if (archiEntry) {
    return {
      url: monsterPictureUrl(archiEntry.gfxId),
      tooltipSource: { kind: 'monster', names: archiEntry },
      fallbackUrls: monsterPictureFallbacks(archiEntry.gfxId),
    };
  }

  const dominantEntry = entries.find((entry) => entry.isDominant);
  if (dominantEntry) {
    return {
      url: monsterPictureUrl(dominantEntry.gfxId),
      tooltipSource: { kind: 'monster', names: dominantEntry },
      fallbackUrls: monsterPictureFallbacks(dominantEntry.gfxId),
    };
  }

  const topDamageEntry = entries[0];
  if (topDamageEntry) {
    return {
      url: monsterPictureUrl(topDamageEntry.gfxId),
      tooltipSource: { kind: 'monster', names: topDamageEntry },
      fallbackUrls: monsterPictureFallbacks(topDamageEntry.gfxId),
    };
  }

  return { url: null, tooltipSource: null, fallbackUrls: [] };
}

/** Repli sans métadonnée de tooltip — voir resolveFightImageInfo. */
export function resolveFightImageUrl(
  catalog: CatalogService,
  enemyNames: readonly string[],
): string | null {
  return resolveFightImageInfo(catalog, enemyNames).url;
}

/**
 * Rang de tri global des groupes du regroupement "Type" de l'historique — voir CLAUDE.md /
 * fight-history.component.ts (`buildTypeGroups`) : donjons non-brèche (par nombre de salles, puis
 * boss ultime, puis 3 joueurs, l'arcade fermant la marche faute de consigne dédiée), puis brèches,
 * puis familles de monstres, puis repli générique (horde hétérogène/inconnue) en tout dernier.
 * Un simple nombre plutôt qu'un enum : `resolveFightTypeClassification` s'en sert directement comme
 * clé de tri, sans mapping supplémentaire côté appelant.
 */
const DUNGEON_TYPE_CATEGORY_RANK: Readonly<Record<WakfuDungeonType, number>> = {
  TWO_ROOMS: 0,
  THREE_ROOMS: 1,
  FOUR_ROOMS: 2,
  ULTIMATE_BOSS: 3,
  THREE_PLAYERS: 4,
  ARCADE: 5,
  BREACH: 6,
  ULTIMATE_BREACH: 6,
};
const FAMILY_CATEGORY_RANK = 7;
const OTHER_CATEGORY_RANK = 8;

export type FightTypeClassification =
  | {
      kind: 'dungeon';
      categoryRank: number;
      /** Clé de regroupement stable, un donjon = un id (jamais son nom : deux donjons distincts
       * pourraient théoriquement partager une même traduction dans une langue donnée). */
      key: string;
      /** Nom localisé du donjon/brèche à afficher tel quel — contrairement à `resolveFightImageInfo`
       * (illustration), le nom d'une brèche N'EST PAS masqué ici : c'est justement ce qui distingue
       * la catégorie "brèches" de celle des donjons classiques dans le regroupement par type. */
      names: FightImageLocalizedName;
    }
  | {
      kind: 'family';
      categoryRank: number;
      /** Id de famille encyclopédie (voir `CatalogMonsterEntry.family`), ou nom de monstre normalisé
       * en repli pour les 28 monstres sans famille (voir CLAUDE.md) — chacun forme alors sa propre
       * "famille" à un seul membre, comme avant ce correctif. */
      key: string;
      /** Id de famille encyclopédie (`CatalogMonsterEntry.family`), `null` pour le repli par nom
       * (28 monstres sans famille, voir `key` ci-dessus). Permet à l'appelant de résoudre le VRAI
       * nom de famille via `CatalogService.findWakfuMonsterFamilyById` — préférable à
       * `candidateNames` ci-dessous, qui reste nécessaire en repli (id `null`, ou nom de famille pas
       * encore chargé côté client, voir CatalogService.initialize). */
      familyId: number | null;
      /** Nom du monstre "représentatif" choisi pour CE combat précis (même priorité que
       * `resolveFightImageInfo` : archimonstre > dominant > plus gros dégât) — PAS un nom de famille.
       * Un seul combat ne suffit pas à choisir un libellé stable pour tout le groupe : l'appelant
       * doit agréger ce champ sur l'ensemble des combats d'une même famille (nom le plus fréquent)
       * — voir `buildTypeGroups` dans fight-history.component.ts. */
      candidateNames: FightImageLocalizedName;
    }
  | { kind: 'other'; categoryRank: number; key: 'other' };

/** Variante de `resolveFightImageInfo` pour le regroupement "Type" de l'historique (pas
 * l'illustration) : reprend la même priorité (boss+donjon > horde hétérogène > archi > dominant >
 * plus gros dégât) mais renvoie une clé de regroupement PAR FAMILLE plutôt que par monstre pour le
 * dernier palier (voir CatalogMonsterEntry.family) — bug corrigé, l'ancienne implémentation
 * réutilisait telle quelle `resolveFightImageInfo().tooltipSource.names`, qui ne porte que le nom du
 * monstre "représentatif" de CE combat, jamais un identifiant de famille : deux combats contre des
 * monstres de la même famille mais de noms différents finissaient dans deux groupes distincts.
 */
export function resolveFightTypeClassification(
  catalog: CatalogService,
  enemyNames: readonly string[],
): FightTypeClassification {
  const entries = enemyNames
    .map((name) => catalog.findWakfuMonsterEntry(name))
    .filter((entry): entry is CatalogMonsterEntry => entry !== undefined);

  const bossEntry = entries.find((entry) => entry.isBoss);
  if (bossEntry) {
    const dungeon = findDungeonForEnemies(catalog, enemyNames);
    if (dungeon) {
      return {
        kind: 'dungeon',
        categoryRank: DUNGEON_TYPE_CATEGORY_RANK[dungeon.type],
        key: `dungeon:${dungeon.id}`,
        names: dungeon,
      };
    }
    // Boss sans donjon référencé pour son id : traité comme un monstre classique (famille), comme
    // resolveFightImageInfo bascule alors sur sa propre illustration.
    return familyClassification(bossEntry);
  }

  const distinctFamilies = new Set(entries.map((entry) => entry.family ?? NO_FAMILY_KEY));
  if (distinctFamilies.size > DISTINCT_FAMILY_THRESHOLD) {
    return { kind: 'other', categoryRank: OTHER_CATEGORY_RANK, key: 'other' };
  }

  const archiEntry = entries.find((entry) => entry.isArchi);
  if (archiEntry) return familyClassification(archiEntry);

  const dominantEntry = entries.find((entry) => entry.isDominant);
  if (dominantEntry) return familyClassification(dominantEntry);

  const topDamageEntry = entries[0];
  if (topDamageEntry) return familyClassification(topDamageEntry);

  return { kind: 'other', categoryRank: OTHER_CATEGORY_RANK, key: 'other' };
}

function familyClassification(entry: CatalogMonsterEntry): FightTypeClassification {
  return {
    kind: 'family',
    categoryRank: FAMILY_CATEGORY_RANK,
    key:
      entry.family !== null ? `family:${entry.family}` : `monster:${normalizeWakfuName(entry.fr)}`,
    familyId: entry.family,
    candidateNames: entry,
  };
}
