import {
  CatalogDungeonEntry,
  CatalogMonsterEntry,
  CatalogService,
  WakfuDungeonType,
  isDungeonBreach,
} from '../api/catalog.service';
import { normalizeWakfuName } from './wakfu-name.util';
import { BREACH_IMAGE_URL, ULTIMATE_BREACH_IMAGE_URL } from '../data/breach-icon.data';

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
  /** Brèche/brèche ultime détectée par heuristique (voir resolveFightImageInfo) : pas de nom
   * précis à afficher (composition en familles pas encore exploitée, voir breach-icon.data.ts),
   * juste une clé de traduction fixe ('damageMeter.breach'/'damageMeter.ultimateBreach', voir
   * translations.ts) résolue par l'appelant (fightImageTooltip dans fight-history.component.ts). */
  | { kind: 'text'; translationKey: string }
  | null;

export interface FightImageInfo {
  url: string | null;
  tooltipSource: FightImageTooltipSource;
  /** URLs de repli à essayer, dans l'ordre, si `url` échoue à charger (voir onFightImageError dans
   * fight-history.component.ts) — vide pour un `url` de donjon ou déjà générique (repli direct sur
   * DEFAULT_FIGHT_IMAGE_URL dans ces cas, comme avant ce champ), voir monsterPictureFallbacks. */
  fallbackUrls: string[];
}

/** Donjon (au sens large : donjon classique, brèche simple ou brèche ultime) rattaché à un
 * ensemble d'ennemis — première étape de `resolveFightImageInfo` ci-dessous, extraite pour être
 * réutilisée telle quelle par core/utils/dungeon-run-grouping.util.ts (regroupement des combats
 * d'un même donjon dans l'historique) ET par `HistorySyncService`/`resolveFightTypeClassification`
 * (rattachement `dungeonId` envoyé au serveur pour la carte Récap, et bucket "Type" de
 * l'historique) — les trois ont besoin de cette détection indépendamment de la résolution
 * d'illustration. `null` si rien de tout ça n'est identifiable.
 *
 * Priorité (même ordre que `resolveFightImageInfo`, voir sa doc pour le détail) :
 * 0. PLUSIEURS ennemis boss (`isBoss`) D'IDS DISTINCTS présents simultanément, correspondant à une
 *    brèche ultime connue (voir `CatalogService.findWakfuUltimateBreachByBossMonsters`) -> cette
 *    brèche ultime. Sans cette priorité, un boss partagé entre une brèche ultime ET un donjon
 *    classique (cas réel : "Phacochemar", boss de "Donjon Vandaliénés" ET l'un des 8 boss de la
 *    "Brèche dimensionnelle ultime de la Shukrute") se voyait à tort rattaché au donjon classique
 *    plutôt qu'à la brèche ultime réellement en cours — bug réel corrigé le 2026-08-28 (fichier
 *    utilisateur : `fightId` Wakfu 1680001243, un unique combat de ~38 min réunissant 7 des 8 boss
 *    de cette brèche ultime en plusieurs vagues).
 * 1. Un boss présent (seul, ou plusieurs mais aucune brèche ultime connue ne correspond) -> le
 *    donjon classique dont il est le boss attitré, `null` si son id n'est référencé par aucun
 *    donjon.
 * 2. Aucun boss du tout, mais plus de `DISTINCT_FAMILY_THRESHOLD` familles de monstre distinctes
 *    parmi les ennemis (horde hétérogène) -> la brèche simple (`type: 'BREACH'`) dont la
 *    composition en familles couvre celles observées (voir
 *    `CatalogService.findWakfuBreachByMonsterFamilies`), `null` si aucune brèche connue ne
 *    correspond (référentiel incomplet, ou horde qui n'en est en réalité pas une) — contrairement à
 *    `resolveFightImageInfo`, pas de repli générique possible ici : un `dungeonId` n'a pas
 *    d'équivalent "brèche non identifiée", il reste `null` (le combat retombe alors sur un
 *    classement par famille, voir les appelants). Bug réel corrigé le 2026-08-28 (même fichier
 *    utilisateur : `fightId` 1680001273, horde de 9 familles distinctes couvrant exactement la
 *    "Brèche dimensionnelle de la Shukrute" — jusque là `dungeonId` restait `null` pour ce combat,
 *    qui finissait éclaté en lignes "famille" isolées dans la carte Récap au lieu d'une section
 *    "Brèche" dédiée).
 */
export function findDungeonForEnemies(
  catalog: CatalogService,
  enemyNames: readonly string[],
): CatalogDungeonEntry | null {
  const entries = enemyNames
    .map((name) => catalog.findWakfuMonsterEntry(name))
    .filter((entry): entry is CatalogMonsterEntry => entry !== undefined);

  const bossEntries = entries.filter((entry) => entry.isBoss);
  // Ids distincts, pas le nombre brut d'entrées `isBoss` — même garde-fou qu'en priorité 0 de
  // resolveFightImageInfo (resynchronisation en cours de combat, voir sa doc).
  const distinctBossIds = [...new Set(bossEntries.map((entry) => entry.id))];
  if (distinctBossIds.length > 1) {
    const ultimateBreach = catalog.findWakfuUltimateBreachByBossMonsters(distinctBossIds);
    if (ultimateBreach) return ultimateBreach;
  }

  for (const name of enemyNames) {
    const entry = catalog.findWakfuMonsterEntry(name);
    if (!entry?.isBoss) continue;
    const dungeon = catalog.findWakfuDungeonByBossMonsterId(entry.id);
    if (dungeon) return dungeon;
  }

  if (bossEntries.length === 0) {
    const distinctFamilies = new Set(entries.map((entry) => entry.family ?? NO_FAMILY_KEY));
    if (distinctFamilies.size > DISTINCT_FAMILY_THRESHOLD) {
      const enemyFamilyIds = [...distinctFamilies].filter(
        (family): family is number => family !== NO_FAMILY_KEY,
      );
      const breach = catalog.findWakfuBreachByMonsterFamilies(enemyFamilyIds);
      if (breach) return breach;
    }
  }

  return null;
}

/**
 * Détermine l'illustration à afficher pour une entrée de l'historique des
 * combats, par ordre de priorité :
 * 0. PLUSIEURS ennemis boss (`isBoss`) D'IDS DISTINCTS présents simultanément ET correspondant
 *    exactement aux boss d'UNE des 3 brèches ultimes connues (`type: 'ULTIMATE_BREACH'` dans
 *    repository/dungeons.json, voir CatalogService.findWakfuUltimateBreachByBossMonsters) ->
 *    illustration de brèche ultime (ULTIMATE_BREACH_IMAGE_URL, voir breach-icon.data.ts), tooltip =
 *    nom de la brèche identifiée. Le référentiel des brèches ultimes étant exhaustif (seulement 3
 *    connues à ce jour), une combinaison de boss qui ne correspond à AUCUNE d'elles n'est PAR
 *    DÉFINITION jamais une brèche ultime réelle — pas de repli sur un libellé générique ici
 *    (contrairement à la priorité 2, brèche simple, dont le référentiel est loin d'être exhaustif) :
 *    on retombe alors sur la priorité 1 ci-dessous. Le comptage se fait sur les IDS DISTINCTS de
 *    boss, jamais sur le nombre brut d'entrées `isBoss` : bug réel corrigé le 2026-08-25 (fichier
 *    utilisateur avec 2 lignes `[_FL_] ... join the fight` pour LE MÊME boss "Cendragon", provoquées
 *    par une resynchronisation en cours de combat qui réémet un nouveau `fighterId` de circonstance
 *    pour un combattant déjà présent — voir CLAUDE.md "Invocations" pour un phénomène de
 *    resynchronisation similaire — comptées à tort comme 2 boss distincts, un combat de donjon
 *    classique affichant alors à tort l'image générique de brèche ultime). Volontairement AVANT la
 *    priorité 1 (sans quoi un seul des boss serait détecté par `entries.find` et le combat traité
 *    comme un donjon/boss classique) : seul cas connu dans le jeu à ce jour où plusieurs monstres
 *    `isBoss` D'IDS DIFFÉRENTS rejoignent légitimement le même combat, ajouté le 2026-08-24 à la
 *    demande de l'utilisateur.
 * 1. Un ennemi boss (`isBoss`) présent (SEUL, voir priorité 0 ci-dessus) -> illustration du donjon
 *    dont il est le boss (`bossMonsterId` dans repository/dungeons.json), ou à défaut (aucun donjon
 *    référencé pour ce boss) sa propre `pictureUrl`.
 * 2. Plus de ${DISTINCT_FAMILY_THRESHOLD} familles de monstres distinctes parmi les ennemis
 *    (horde hétérogène, pas un combat de donjon/archi/dominant) -> illustration de brèche
 *    (BREACH_IMAGE_URL, voir breach-icon.data.ts) — heuristique de détection de brèche actuelle,
 *    faute d'un signal plus précis pour savoir SI c'en est bien une. Tooltip : nom de LA brèche
 *    identifiée (parmi les 7 connues, `type: 'BREACH'`) via les familles de monstre réellement
 *    présentes — voir CatalogService.findWakfuBreachByMonsterFamilies, même repli générique en
 *    l'absence de correspondance.
 * 3. Un archimonstre (`isArchi`) présent -> sa `pictureUrl`.
 * 4. Un dominant (`isDominant`) présent -> sa `pictureUrl`.
 * 5. Sinon, l'ennemi ayant infligé le plus de dégâts -> sa `pictureUrl`.
 *
 * `enemyNames` doit être fourni dans l'ordre de dégâts décroissant (voir
 * FightRecord.rows, déjà trié ainsi) pour que le repli n°5 pointe vers le
 * bon monstre. Les noms sans entrée catalogue connue sont ignorés à
 * chaque étape (aucune image disponible pour eux). `tooltipSource` est
 * `null` pour une illustration de donjon-brèche classique trouvée par boss unique
 * (`isDungeonBreach`, priorité 1 — cas qui ne devrait plus se produire pour une vraie brèche
 * depuis la priorité 0, gardé par sécurité) ; de type `'dungeon'` (nom précis, comme un donjon
 * classique) pour les priorités 0/2 quand la brèche/brèche ultime a pu être identifiée, sinon de
 * type `'text'` (clé de traduction fixe générique) — voir feature "tooltip sur les images
 * d'historique de combat".
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

  const bossEntries = entries.filter((entry) => entry.isBoss);
  // Ids distincts, PAS le nombre brut d'entrées `isBoss` : une resynchronisation en cours de combat
  // peut faire rejoindre le MÊME boss une 2e fois sous un nouveau `fighterId` (voir doc ci-dessus) —
  // ça ne fait jamais de lui 2 boss différents.
  const distinctBossIds = [...new Set(bossEntries.map((entry) => entry.id))];
  if (distinctBossIds.length > 1) {
    // Référentiel des brèches ultimes exhaustif (3 connues) : si cette combinaison précise de boss
    // n'en identifie AUCUNE, ce n'est par définition pas une brèche ultime — pas de repli générique
    // ici (voir doc ci-dessus), on retombe sur la priorité 1 (boss unique/dungeon classique) via
    // `bossEntries[0]` plutôt que d'afficher à tort l'illustration de brèche ultime.
    const ultimateBreach = catalog.findWakfuUltimateBreachByBossMonsters(distinctBossIds);
    if (ultimateBreach) {
      return {
        url: ULTIMATE_BREACH_IMAGE_URL,
        tooltipSource: { kind: 'dungeon', names: ultimateBreach },
        fallbackUrls: [],
      };
    }
  }

  const bossEntry = bossEntries[0];
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
    // dungeon référencé). Identification précise de LA brèche (parmi celles connues) via les
    // familles de monstre réellement présentes — voir findWakfuBreachByMonsterFamilies. Repli sur
    // le libellé générique si aucune ne correspond (référentiel incomplet, ou horde hétérogène qui
    // n'est en réalité pas une brèche).
    const enemyFamilyIds = [...distinctFamilies].filter(
      (family): family is number => family !== NO_FAMILY_KEY,
    );
    const breach = catalog.findWakfuBreachByMonsterFamilies(enemyFamilyIds);
    return {
      url: BREACH_IMAGE_URL,
      tooltipSource: breach
        ? { kind: 'dungeon', names: breach }
        : { kind: 'text', translationKey: 'damageMeter.breach' },
      fallbackUrls: [],
    };
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
  // Couvre à la fois les donjons classiques (boss unique), les brèches ultimes (plusieurs boss
  // simultanés) et les brèches simples (horde hétérogène identifiée par ses familles) — voir la
  // doc de `findDungeonForEnemies` pour l'ordre de priorité exact. Un seul appel en tête plutôt que
  // de ne le tenter que si un boss est présent (bug réel corrigé le 2026-08-28, voir CLAUDE.md) :
  // une brèche simple n'a par nature AUCUN boss, elle ne serait jamais atteinte sinon.
  const dungeon = findDungeonForEnemies(catalog, enemyNames);
  if (dungeon) {
    return {
      kind: 'dungeon',
      categoryRank: DUNGEON_TYPE_CATEGORY_RANK[dungeon.type],
      key: `dungeon:${dungeon.id}`,
      names: dungeon,
    };
  }

  const entries = enemyNames
    .map((name) => catalog.findWakfuMonsterEntry(name))
    .filter((entry): entry is CatalogMonsterEntry => entry !== undefined);

  const bossEntry = entries.find((entry) => entry.isBoss);
  // Boss sans donjon référencé pour son id : traité comme un monstre classique (famille), comme
  // resolveFightImageInfo bascule alors sur sa propre illustration.
  if (bossEntry) return familyClassification(bossEntry);

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
