/**
 * Recours manuel (nom FR, minuscule -> URL d'image directe) pour les objets
 * absents des deux catalogues officiels Ankama (jobsItems.json ET
 * items.json) — voir wakfu-items.data.ts. Ce sont typiquement des objets
 * spéciaux (trophées de combat, jetons de monstre...) non exposés dans les
 * fichiers JSON publics. URLs trouvées manuellement sur l'encyclopédie
 * officielle (https://www.wakfu.com/fr/mmorpg/encyclopedie/), consultée en
 * particulier sur la fiche du monstre El Pochito.
 *
 * static.ankama.com bloque ces URLs si la requête porte un en-tête Referer
 * d'un domaine tiers (protection anti-hotlink) : `<img>` doit être chargée
 * avec `referrerpolicy="no-referrer"` (voir item-icon.component.ts), sinon
 * l'image échoue silencieusement même si l'URL est correcte.
 */
export const WAKFU_ITEM_IMAGE_OVERRIDES: Readonly<Record<string, string>> = {
  'jeton brut': 'https://static.ankama.com/wakfu/portal/game/item/64/64921003.png',
  'eclat': 'https://static.ankama.com/wakfu/portal/game/item/64/81127083.png',
};
