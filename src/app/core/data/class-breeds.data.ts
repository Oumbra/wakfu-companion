/**
 * Planche de portraits officielle Ankama (18 classes x 2 sexes = 36 cases),
 * servie en fichier statique (public/assets/avatars/, nom hashé pour un cache
 * navigateur immuable — régénérer le hash si le fichier change).
 * Source : https://static.ankama.com/wakfu/ng/modules/mmorpg/encyclopedia/breeds/assets/breeds.jpg
 * Grille reelle : 630x70px, soit 18 colonnes x 2 lignes de cases 35x35px.
 */
export const BREEDS_SPRITE_DATA_URI = 'assets/avatars/breeds-sprite-73f2ae21.jpg';
export const BREEDS_SPRITE_COLS = 18;
export const BREEDS_SPRITE_ROWS = 2;
export const BREEDS_SPRITE_CELL_SIZE = 35;

/**
 * Colonne (classe) de chaque case de la planche, retrouvée par comparaison
 * visuelle avec les icônes de classe (class-icons.data.ts) : Ankama ne
 * documente l'ordre nulle part. Ligne 1 (sexe='m') = variante visible dans
 * CLASS_ICON_DATA_URI (icônes masculines) ; ligne 0 = variante alternative —
 * SAUF pour `REVERSED_GENDER_ROW_CLASSES` ci-dessous (lignes inversées pour
 * ces 2 colonnes précises, déduit de tests utilisateur réels après une 1ère
 * comparaison visuelle erronée sur ces 7 classes, corrigée depuis).
 *
 * Exporté aussi pour `class-portraits.data.ts` (migration ponctuelle des anciens `avatarIndex`
 * vers le nouveau schéma sans sexe, voir ce fichier).
 */
export const BREED_CLASS_COLUMNS: Readonly<Record<string, number>> = {
  feca: 0,
  osamodas: 1,
  enutrof: 2,
  sram: 3,
  xelor: 4,
  ecaflip: 5,
  eniripsa: 6,
  iop: 7,
  cra: 8,
  sadida: 9,
  sacrier: 10,
  pandawa: 11,
  rogue: 12,
  zobal: 13,
  foggernaut: 14,
  eliotrope: 15,
  huppermage: 16,
  ouginak: 17,
};

/** Voir commentaire de `BREED_CLASS_COLUMNS` : ligne homme/femme inversée pour ces 2 classes uniquement. */
const REVERSED_GENDER_ROW_CLASSES = new Set(['huppermage', 'ouginak']);

/** Index (0-35) dans la planche pour une classe+sexe donnés (voir AvatarIconComponent) — classe inconnue -> 1ère case. */
export function getBreedAvatarIndex(className: string | undefined, gender: 'm' | 'f'): number {
  const col = (className ? BREED_CLASS_COLUMNS[className] : undefined) ?? 0;
  const maleRow = className && REVERSED_GENDER_ROW_CLASSES.has(className) ? 0 : 1;
  const row = gender === 'm' ? maleRow : 1 - maleRow;
  return row * BREEDS_SPRITE_COLS + col;
}
