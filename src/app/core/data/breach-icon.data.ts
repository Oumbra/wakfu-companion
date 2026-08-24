/**
 * Illustrations de repli pour un combat de brèche (voir resolveFightImageInfo,
 * core/utils/fight-image.util.ts) servies en fichiers statiques (public/assets/ui/, noms hashés
 * pour un cache navigateur immuable — régénérer le hash si le fichier change). Fournies par
 * l'utilisateur le 2026-08-24 pour remplacer l'illustration générique (DEFAULT_FIGHT_IMAGE_URL)
 * dans le cas "horde hétérogène" (> DISTINCT_FAMILY_THRESHOLD familles distinctes, sans boss) —
 * heuristique de détection de brèche actuelle, faute de mieux : voir fight-image.util.ts.
 *
 * `ULTIMATE_BREACH` n'est pour l'instant PAS utilisée par resolveFightImageInfo : distinguer une
 * brèche simple d'une brèche ultime nécessite de savoir à quelle brèche précise appartient le
 * combat (composition en familles de monstres du référentiel, en cours de saisie manuelle côté
 * utilisateur) — en attendant, tout combat classé "horde hétérogène" retombe sur BREACH.
 */
export const BREACH_IMAGE_URL = 'assets/ui/breach-74a8ca57.png';
export const ULTIMATE_BREACH_IMAGE_URL = 'assets/ui/ultimate-breach-8010573f.png';
