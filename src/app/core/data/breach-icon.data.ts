/**
 * Illustrations de repli pour un combat de brèche (voir resolveFightImageInfo,
 * core/utils/fight-image.util.ts) servies en fichiers statiques (public/assets/ui/, noms hashés
 * pour un cache navigateur immuable — régénérer le hash si le fichier change). Fournies par
 * l'utilisateur le 2026-08-24 pour remplacer l'illustration générique (DEFAULT_FIGHT_IMAGE_URL) :
 * `BREACH_IMAGE_URL` pour une horde hétérogène sans boss (> DISTINCT_FAMILY_THRESHOLD familles
 * distinctes), `ULTIMATE_BREACH_IMAGE_URL` pour plusieurs ennemis `isBoss` simultanément — ces deux
 * heuristiques restent les seuls signaux de DÉTECTION (aucune brèche/brèche ultime "propre" dans
 * les logs). Le nom précis de LA brèche/brèche ultime affiché en tooltip, lui, est identifié via
 * le référentiel (`repository/dungeons.json`, familles de monstre / boss — voir
 * CatalogService.findWakfuBreachByMonsterFamilies / findWakfuUltimateBreachByBossMonsters) : ces
 * deux images restent génériques (une seule illustration par catégorie, pas une par brèche connue).
 */
export const BREACH_IMAGE_URL = 'assets/ui/breach-74a8ca57.png';
export const ULTIMATE_BREACH_IMAGE_URL = 'assets/ui/ultimate-breach-8010573f.png';
