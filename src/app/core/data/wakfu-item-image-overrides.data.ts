import { wakassetsIconUrl } from '../utils/wakassets-url.util';

/**
 * Recours manuel (nom FR, minuscule -> `gfxId`) pour les objets dont le nom lu dans le log ne
 * correspond à aucune entrée du catalogue — voir core/api/catalog.service.ts (catalogue servi par
 * l'API distante). Ce sont typiquement des objets spéciaux (trophées de combat, jetons de
 * monstre...) ou un nom au singulier dans le log pour une entrée au pluriel dans le catalogue
 * (« Eclat » / « Eclats »). L'image est résolue sur wakassets comme n'importe quel objet connu
 * (voir item-icon.component.ts) : plus aucun hotlink `static.ankama.com`, dont la protection
 * anti-hotlink devait être contournée par `referrerpolicy="no-referrer"` — retiré le 2026-09-20
 * (voir docs/analyse-cgu.md, recommandation 5).
 */
const WAKFU_ITEM_GFX_ID_OVERRIDES: Readonly<Record<string, number>> = {
  'jeton brut': 64921003,
  eclat: 81127083,
};

export const WAKFU_ITEM_IMAGE_OVERRIDES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WAKFU_ITEM_GFX_ID_OVERRIDES).map(([name, gfxId]) => [
    name,
    wakassetsIconUrl('items', `${gfxId}.png`),
  ]),
);
