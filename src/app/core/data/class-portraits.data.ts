import { Gender } from './class-icons.data';

/**
 * Portraits de classe "grand format" (2 sexes x 18 classes) — planche `class-avatars-sheet-*.png`,
 * 2 colonnes (0 = féminin, 1 = masculin) x 18 lignes, une seule image par sexe (pas de variante
 * mate pré-rendue, contrairement à l'ancienne planche `class-portraits-v2-*.png` sourcée depuis
 * l'encyclopédie officielle — voir git log). Sources : `static.ankama.com/web-test/{id}.png`
 * (icônes de sélection d'avatar du jeu, fournies directement par identifiant numérique plutôt que
 * cadrées à la main comme la planche précédente), assemblées en une seule planche 2026-08-15.
 *
 * Fond transparent (2026-08-16) — `class-avatars-sheet-transparent-*.png`, copie retraitée de la
 * planche opaque d'origine (`class-avatars-sheet-ade44514.png`, conservée telle quelle, non
 * référencée ailleurs). Une 1ère tentative de fond transparent par simple flood-fill à seuil
 * "lâche" avait été faite puis annulée (2026-08-15) : sur certaines cases, la lisière tête/cheveux
 * est rendue en dégradé doux sans trait d'encre net, si bien qu'un flood-fill à seuil lâche
 * traverse ce dégradé et mange une partie du visage (fuite mesurée entre 165 et 175 de luminosité
 * minimale sur la case la plus à risque). Traitement retenu cette fois : connexité stricte depuis
 * la bordure de chaque case (seuil élevé, marge de sécurité large sous ce point de fuite) + anneau
 * de dilatation borné (quelques px, pas une nouvelle traversée de connexité) pour rattraper le
 * reliquat d'anti-aliasing, puis alpha + dématriçage couleur façon "color to alpha" (fond blanc
 * pur) sur cette seule région — un pixel hors de cette région reste intégralement opaque quelle
 * que soit sa couleur, ce qui protège les cheveux clairs/reflets blancs internes au personnage.
 * Vérifié sur les 36 cases (composite sur fond magenta ET sombre + détection automatique de petits
 * artefacts) avant intégration.
 */
export const CLASS_PORTRAITS_SPRITE_URI = 'assets/avatars/class-avatars-sheet-transparent-9eb9eceb.png';
export const CLASS_PORTRAITS_SPRITE_COLS = 2;
export const CLASS_PORTRAITS_SPRITE_ROWS = 18;

/** Ordre RÉEL des lignes de la planche `class-avatars-sheet-*.png` (spécifié explicitement par
 * l'utilisateur au moment de l'assemblage — pas déduit d'une source externe, contrairement à
 * l'ancienne planche). Toute reconstruction de cette planche doit conserver cet ordre. */
export const CLASS_PORTRAIT_ORDER: readonly string[] = [
  'cra',
  'ecaflip',
  'sacrier',
  'zobal',
  'sram',
  'ouginak',
  'iop',
  'eniripsa',
  'feca',
  'sadida',
  'enutrof',
  'eliotrope',
  'foggernaut',
  'huppermage',
  'xelor',
  'osamodas',
  'pandawa',
  'rogue',
];

/** Sexe "par défaut" d'une classe (repris de l'ancienne planche à 1 portrait/classe) — n'a plus
 * d'usage pour la grille "Avatar" elle-même (voir AVATAR_GRID_ENTRIES, genrée) mais reste utile en
 * repli pour migrer un ancien `avatarIndex` qui ne connaissait pas encore le sexe. */
export const CLASS_PORTRAIT_DEFAULT_GENDER: Readonly<Record<string, Gender>> = {
  feca: 'f',
  sadida: 'f',
  sacrier: 'm',
  pandawa: 'm',
  rogue: 'f',
  zobal: 'f',
  foggernaut: 'm',
  osamodas: 'f',
  enutrof: 'm',
  sram: 'm',
  xelor: 'm',
  ecaflip: 'm',
  eniripsa: 'f',
  iop: 'm',
  cra: 'f',
  eliotrope: 'm',
  huppermage: 'm',
  ouginak: 'm',
};

const CLASS_PORTRAIT_ROW: Readonly<Record<string, number>> = Object.fromEntries(
  CLASS_PORTRAIT_ORDER.map((key, i) => [key, i]),
);

/** Ligne (0-17) d'une classe dans la planche — 0 (Cra) si `className` inconnu/absent, pour rester
 * cohérent avec `getAvatarGridIndex` (repli sur la 1ère case plutôt que planter). */
export function getClassPortraitRow(className: string | undefined): number {
  return (className ? CLASS_PORTRAIT_ROW[className] : undefined) ?? 0;
}

/** Sexe par défaut d'une classe (voir CLASS_PORTRAIT_DEFAULT_GENDER) — 'f' si `className`
 * inconnu/absent. Utilisé uniquement par `migrateLegacyAvatarIndex` (anciens schémas qui ne
 * connaissaient pas le sexe choisi). */
export function getClassPortraitDefaultGender(className: string | undefined): Gender {
  return (className && CLASS_PORTRAIT_DEFAULT_GENDER[className]) || 'f';
}

/** Une entrée par case de la grille "Avatar" du profil : 18 classes (voir CLASS_PORTRAIT_ORDER) x
 * 2 sexes, féminin puis masculin pour chaque classe — mêmes colonnes que la planche
 * (col 0 = féminin, col 1 = masculin), 36 cases au total. `profile.avatarIndex()` est un index
 * dans CE tableau (0-35). */
export const AVATAR_GRID_ENTRIES: readonly { className: string; gender: Gender }[] =
  CLASS_PORTRAIT_ORDER.flatMap((className) => [
    { className, gender: 'f' as Gender },
    { className, gender: 'm' as Gender },
  ]);

/** Entrée (classe + sexe) d'une case de la grille "Avatar" — 1ère case si `index` inconnu/absent. */
export function getAvatarGridEntry(index: number | null | undefined): {
  className: string;
  gender: Gender;
} {
  return (
    (index !== null && index !== undefined && AVATAR_GRID_ENTRIES[index]) || AVATAR_GRID_ENTRIES[0]
  );
}

/** Index (0-35) dans AVATAR_GRID_ENTRIES pour une classe+sexe donnés — classe inconnue -> 1ère case.
 * Utilisé aussi bien par `migrateLegacyAvatarIndex` ci-dessous que par `AvatarIconComponent` (petit
 * portrait persistant, pas de choix interactif) — voir ce composant pour son propre repli si
 * `className`/`gender` sont absents en amont. */
export function getAvatarGridIndex(className: string | undefined, gender: Gender): number {
  const row = className ? CLASS_PORTRAIT_ORDER.indexOf(className) : -1;
  const safeRow = row >= 0 ? row : 0;
  return safeRow * 2 + (gender === 'f' ? 0 : 1);
}

/** Version courante du schéma `avatarIndex` stocké (voir ProfileService) — incrémenter à chaque
 * changement de sens de l'index stocké (nouvel ordre de lignes, ou nouveau découpage des cases).
 * v4 -> v5 (2026-08-15) : la grille "Avatar" redevient genrée (36 cases, voir AVATAR_GRID_ENTRIES)
 * au lieu d'une case par classe seulement — voir `migrateLegacyAvatarIndex`.
 */
export const AVATAR_INDEX_SCHEMA_VERSION = 5;

/** Ordre utilisé sous schéma v3 (planche `class-portraits-v2-*.png`, désormais remplacée) et
 * repris tel quel par le schéma v4 (grille non genrée, 1 case/classe). Conservé uniquement pour
 * migrer les `avatarIndex` qui auraient été persistés entre-temps — ne JAMAIS l'utiliser ailleurs. */
const LEGACY_V3_ORDER: readonly string[] = [
  'feca',
  'sadida',
  'sacrier',
  'pandawa',
  'rogue',
  'zobal',
  'foggernaut',
  'osamodas',
  'enutrof',
  'sram',
  'xelor',
  'ecaflip',
  'eniripsa',
  'iop',
  'cra',
  'eliotrope',
  'huppermage',
  'ouginak',
];

/** Ordre (erroné — id Ankama) utilisé un temps sous schéma v2, avant correction. Conservé
 * uniquement pour migrer les `avatarIndex` qui auraient été persistés entre-temps (voir
 * `migrateLegacyAvatarIndex`) — ne JAMAIS l'utiliser ailleurs. */
const LEGACY_V2_ORDER: readonly string[] = [
  'feca',
  'osamodas',
  'enutrof',
  'sram',
  'xelor',
  'ecaflip',
  'eniripsa',
  'iop',
  'cra',
  'sadida',
  'sacrier',
  'pandawa',
  'rogue',
  'zobal',
  'ouginak',
  'foggernaut',
  'eliotrope',
  'huppermage',
];

/** Repli (colonne -> classe) de l'ancien schéma v1 (planche `class-breeds-sprite-*.jpg`, 18 classes
 * x 2 sexes, `index = ligne(sexe)*18 + colonne(classe)`), utilisé uniquement par
 * `migrateLegacyAvatarIndex` ci-dessous. Ancienne source (`class-breeds.data.ts`, table
 * `BREED_CLASS_COLUMNS`) supprimée depuis qu'`AvatarIconComponent` a basculé sur la planche
 * courante (2026-08-15) — cette copie figée reste la seule trace de l'ordre d'origine, ne plus la
 * faire évoluer. */
const LEGACY_V1_COLUMN_TO_CLASS: readonly string[] = [
  'feca',
  'osamodas',
  'enutrof',
  'sram',
  'xelor',
  'ecaflip',
  'eniripsa',
  'iop',
  'cra',
  'sadida',
  'sacrier',
  'pandawa',
  'rogue',
  'zobal',
  'foggernaut',
  'eliotrope',
  'huppermage',
  'ouginak',
];

/** Classes dont la ligne homme/femme du schéma v1 était inversée — même copie figée que
 * LEGACY_V1_COLUMN_TO_CLASS ci-dessus, pour la même raison. */
const LEGACY_V1_REVERSED_GENDER_ROW_CLASSES = new Set(['huppermage', 'ouginak']);

/**
 * Migration ponctuelle d'un ancien `avatarIndex` vers le schéma courant (voir
 * ProfileService.loadFromStorage, appelée dès que `avatarSchemaVersion` stocké ne vaut pas
 * `AVATAR_INDEX_SCHEMA_VERSION`) :
 * - schéma v1 (absent) : 0-35, planche `class-breeds.data.ts` (18 classes x 2 sexes) — le sexe
 *   choisi EST préservé (encodé par la ligne, voir `LEGACY_V1_REVERSED_GENDER_ROW_CLASSES`).
 * - schéma v2 : 0-17, ordre de lignes erroné (`LEGACY_V2_ORDER`) et sexe non mémorisé — repli sur
 *   le sexe par défaut de la classe (`CLASS_PORTRAIT_DEFAULT_GENDER`).
 * - schéma v3/v4 : 0-17, ordre correct (v4 = `CLASS_PORTRAIT_ORDER` actuel, v3 = `LEGACY_V3_ORDER`)
 *   mais sexe non mémorisé — même repli.
 * Un index déjà cohérent avec le schéma courant (v5) ne devrait jamais transiter par cette
 * fonction (voir le test `avatarSchemaVersion` dans ProfileService), mais un round-trip par une
 * classe connue reste inoffensif si jamais appelé par erreur.
 */
export function migrateLegacyAvatarIndex(
  oldIndex: number,
  fromVersion: number | undefined,
): number {
  if (fromVersion === 4) {
    const className = CLASS_PORTRAIT_ORDER[oldIndex];
    return getAvatarGridIndex(className, getClassPortraitDefaultGender(className));
  }
  if (fromVersion === 3) {
    const className = LEGACY_V3_ORDER[oldIndex];
    return getAvatarGridIndex(className, getClassPortraitDefaultGender(className));
  }
  if (fromVersion === 2) {
    const className = LEGACY_V2_ORDER[oldIndex];
    return getAvatarGridIndex(className, getClassPortraitDefaultGender(className));
  }
  // Schéma v1 (absent) : 0-35, sexe encodé par la ligne (0 ou 1) de l'ancienne planche.
  const safeIndex = ((oldIndex % 36) + 36) % 36;
  const col = safeIndex % 18;
  const row = Math.floor(safeIndex / 18);
  const className = LEGACY_V1_COLUMN_TO_CLASS[col];
  const maleRow = className && LEGACY_V1_REVERSED_GENDER_ROW_CLASSES.has(className) ? 0 : 1;
  const gender: Gender = row === maleRow ? 'm' : 'f';
  return getAvatarGridIndex(className, gender);
}
