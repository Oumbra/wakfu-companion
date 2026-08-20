/**
 * Icônes d'en-tête (source : site de référence, public/assets/img/headers/),
 * servies en fichiers statiques (public/assets/ui/, noms hashés pour un cache
 * navigateur immuable — régénérer le hash si un fichier change).
 */
export const HEADER_ICON_XP_DATA_URI = 'assets/ui/header-xp-1ec8ccc4.png';
export const HEADER_ICON_KAMAS_DATA_URI = 'assets/ui/header-kamas-23aea153.png';
/** Utilisée uniquement dans la section "Combats" de SessionRecapComponent, entourée des autres
 * médaillons illustrés (XP, Kamas, Défis, Butin) — y garder ce même style bitmap plutôt que le
 * symbole SVG `crossed-swords` (rail replié / en-tête du panneau Combat, voir icon.component.ts)
 * qui y détonnerait, seul trait fin au milieu d'icônes peintes dorées (vérifié à l'écran). */
export const HEADER_ICON_COMBAT_DATA_URI = 'assets/ui/header-combat-362cec52.png';
export const HEADER_ICON_CHALLENGES_DATA_URI = 'assets/ui/header-challenges-1293dcc0.png';
export const HEADER_ICON_LOOT_DATA_URI = 'assets/ui/header-loot-1309c5cd.png';
export const HEADER_ICON_ALLIES_DATA_URI = 'assets/ui/header-allies-2456601d.png';
export const HEADER_ICON_ENEMIES_DATA_URI = 'assets/ui/header-enemies-20001d83.png';
