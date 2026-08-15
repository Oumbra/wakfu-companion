import { Gender } from './class-icons.data';

/**
 * Portraits de classe "grand format" (2 sexes x 18 classes), reconstruits à partir des
 * illustrations officielles Ankama de l'encyclopédie (chaque page classe expose en fond un
 * `breed-{id}.jpg` contenant les DEUX personnages — mâle et femelle — côte à côte, voir
 * `CLAUDE.md`). Chaque case existe en 2 variantes pré-rendues — colorée et mate — pour reproduire
 * le rendu "survol = couleur, repos = mat" du site officiel sans filtre CSS (voir
 * ClassPortraitComponent).
 *
 * Historique : la planche officielle `.../breeds/assets/icons/big.png` (utilisée un temps, voir
 * git log) n'a qu'UN portrait par classe, pas les deux sexes — 18 des 36 cases ont dû être
 * recadrées à la main dans `breed-{id}.jpg` (repérage du personnage manquant à l'œil, planche par
 * planche) et calées sur le même traitement colorimétrique que les 18 déjà fournies par Ankama
 * (régression linéaire par canal RGB entre les 2 colonnes de big.png, appliquée aux nouveaux
 * recadrages — coefficients ci-dessous, `RAW_TO_COLORED`/`COLORED_TO_MUTED`). Résultat unique :
 * `class-portraits-v2-*.png`, 4 colonnes x 18 lignes de cases 80x81px : [mâle coloré, mâle mat,
 * femelle coloré, femelle mat].
 */
export const CLASS_PORTRAITS_SPRITE_URI = 'assets/avatars/class-portraits-v2-d32417ee.png';
export const CLASS_PORTRAITS_SPRITE_COLS = 4;
export const CLASS_PORTRAITS_SPRITE_ROWS = 18;

/** Ordre RÉEL des lignes de la planche — PAS l'id interne Ankama (hypothèse initiale erronée,
 * corrigée le 2026-08-15) : relevé de façon fiable en lisant les `background-position` CSS
 * effectivement utilisés par le site officiel pour sa propre barre de sélection de classe
 * (`.ak-breed-icon-big.breed{id}_0` sur une page encyclopédie, ex. .../classes/4-sram), qui pointent
 * vers l'ANCIENNE planche à 1 colonne — `ligne = |offsetY| / 81`. Revérifié visuellement (ligne 9 =
 * crâne Sram, correspond bien à `breed4_0`, id Ankama du Sram). Ne PAS reconstruire "à l'œil"
 * depuis l'ordre des slugs de l'encyclopédie : sans lien avec l'ordre réel au-delà de la 1ère ligne
 * (Féca, id 1). Conservé tel quel pour la nouvelle planche (même ordre de lignes, colonnes
 * réarrangées en 4 : voir ci-dessus).
 */
export const CLASS_PORTRAIT_ORDER: readonly string[] = [
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

/** Sexe déjà fourni par Ankama dans l'ancienne planche à 1 portrait/classe — utilisé uniquement
 * là où un affichage non-genré doit rester STABLE (ex. grille "Avatar" du profil, qui n'a jamais
 * demandé le sexe à l'utilisateur) : évite de changer l'apparence des portraits déjà en place. */
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

/** Ligne (0-17) d'une classe dans la planche — 0 (Féca) si `className` inconnu/absent, pour rester
 * cohérent avec `getBreedAvatarIndex` (repli sur la 1ère case plutôt que planter). */
export function getClassPortraitRow(className: string | undefined): number {
  return (className ? CLASS_PORTRAIT_ROW[className] : undefined) ?? 0;
}

/** Sexe par défaut d'une classe (voir CLASS_PORTRAIT_DEFAULT_GENDER) — 'f' si `className`
 * inconnu/absent (comportement arbitraire mais déterministe, jamais utilisé en pratique : la
 * grille "Avatar" itère toujours sur `CLASS_PORTRAIT_ORDER`, des classes connues). */
export function getClassPortraitDefaultGender(className: string | undefined): Gender {
  return (className && CLASS_PORTRAIT_DEFAULT_GENDER[className]) || 'f';
}

/** Version courante du schéma `avatarIndex` stocké (voir ProfileService) — incrémenter si
 * `CLASS_PORTRAIT_ORDER` change d'ordre un jour (forcerait une nouvelle migration). Le passage à
 * la planche genrée (v2 -> ce fichier) n'a PAS fait bouger l'ordre des lignes ni le sens de
 * l'index stocké (toujours 0-17, une classe) : pas de nouveau bump de version nécessaire, la
 * grille "Avatar" reste non-genrée (voir CLASS_PORTRAIT_DEFAULT_GENDER ci-dessus).
 */
export const AVATAR_INDEX_SCHEMA_VERSION = 3;

/** Ordre (erroné — id Ankama, voir commentaire de `CLASS_PORTRAIT_ORDER` ci-dessus) utilisé un
 * temps sous schéma v2, avant correction. Conservé uniquement pour migrer les `avatarIndex` qui
 * auraient été persistés entre-temps (voir `migrateLegacyAvatarIndex`) — ne JAMAIS l'utiliser
 * ailleurs. */
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

/** Repli (colonne -> classe) de l'ancien schéma v1 (planche `class-breeds.data.ts`, 18 classes x
 * 2 sexes), utilisé uniquement par `migrateLegacyAvatarIndex` ci-dessous. Table dupliquée ici
 * (plutôt qu'importée de class-breeds.data.ts) pour ne plus dépendre de cette planche, dont
 * l'usage se limite maintenant à l'icône de classe miniature (class-icons.data.ts) — voir
 * BREED_CLASS_COLUMNS dans class-breeds.data.ts pour la table d'origine, à garder synchronisée. */
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

/**
 * Migration ponctuelle d'un ancien `avatarIndex` vers le schéma courant (voir
 * ProfileService.loadFromStorage, appelée dès que `avatarSchemaVersion` stocké ne vaut pas
 * `AVATAR_INDEX_SCHEMA_VERSION`) :
 * - schéma v1 (absent) : 0-35, planche `class-breeds.data.ts` (18 classes x 2 sexes,
 *   `index = ligne(sexe)*18 + colonne(classe)`) — le sexe est perdu, seule la classe choisie est
 *   préservée.
 * - schéma v2 : 0-17 mais construit avec un ordre de lignes erroné (`LEGACY_V2_ORDER`, hypothèse
 *   initiale non vérifiée) — reconverti classe par classe vers l'ordre correct.
 * Un index déjà cohérent avec le schéma courant (v3) ne devrait jamais transiter par cette
 * fonction (voir le test `avatarSchemaVersion` dans ProfileService), mais un round-trip par une
 * classe connue reste inoffensif si jamais appelé par erreur.
 */
export function migrateLegacyAvatarIndex(oldIndex: number, fromVersion: number | undefined): number {
  const className =
    fromVersion === 2
      ? LEGACY_V2_ORDER[oldIndex]
      : LEGACY_V1_COLUMN_TO_CLASS[((oldIndex % 18) + 18) % 18];
  const newIndex = CLASS_PORTRAIT_ORDER.indexOf(className);
  return newIndex >= 0 ? newIndex : 0;
}
