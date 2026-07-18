/**
 * Rareté (FR minuscule -> palier) des objets suivis pour alerte sonore.
 * Vérifié un par un sur la base communautaire MethodWakfu (db.methodwakfu.com/items/…) :
 * Pierre d'aventure (29847), Pierre d'équilibre (29848), Pierre de vitesse (29849),
 * Pierre d'entourage (29850) et Pierre ultime (29851) sont Mythique ;
 * Influence III (28872) est Légendaire.
 * Repli sur "common" pour tout objet ajouté manuellement dont la rareté est inconnue.
 */
export type WakfuRarity =
  | 'common'
  | 'rare'
  | 'mythical'
  | 'legendary'
  | 'souvenir'
  | 'epic'
  | 'relic';

const WAKFU_ITEM_RARITY: Readonly<Record<string, WakfuRarity>> = {
  "pierre d'aventure": 'mythical',
  "pierre d'équilibre": 'mythical',
  "pierre d'entourage": 'mythical',
  'pierre de vitesse': 'mythical',
  'pierre ultime': 'mythical',
  'influence iii': 'legendary',
};

export function getWakfuItemRarity(name: string): WakfuRarity {
  return WAKFU_ITEM_RARITY[name.toLowerCase().trim()] ?? 'common';
}
