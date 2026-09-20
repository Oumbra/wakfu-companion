import { normalizeWakfuName } from '../utils/wakfu-name.util';

/**
 * Alias de nom d'objet : nom tel que lu dans `wakfu.log` → nom FR de l'entrée catalogue
 * correspondante, quand les deux divergent. Le seul cas connu est un singulier dans le log pour
 * une entrée au pluriel dans le catalogue (« Eclat » ramassé / « Eclats » en catalogue, id 27083).
 * Appliqué UNE fois à la construction de l'index (`CatalogService.applyIndex`) : chaque alias
 * devient une clé supplémentaire des index par nom, donc `findWakfuItemEntry`,
 * `findAllWakfuItemEntriesByName` et `hasMultipleWakfuItemEntriesByName` le résolvent en O(1)
 * comme n'importe quel nom — ni l'icône (item-icon.component.ts) ni la résolution de confiance du
 * butin (chemin chaud du parsing) n'ont besoin d'un cas particulier.
 *
 * Les deux côtés sont passés par `normalizeWakfuName` — écrire les noms tels qu'ils apparaissent
 * dans le log / le catalogue, la casse et les accents ne comptent pas. Un alias dont la cible
 * n'existe pas dans le catalogue est simplement ignoré.
 */
const WAKFU_ITEM_NAME_ALIASES_RAW: Readonly<Record<string, string>> = {
  Eclat: 'Eclats',
};

/** Clé normalisée (nom du log) → clé normalisée (nom catalogue). */
export const WAKFU_ITEM_NAME_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries(WAKFU_ITEM_NAME_ALIASES_RAW).map(([logName, catalogName]) => [
    normalizeWakfuName(logName),
    normalizeWakfuName(catalogName),
  ]),
);
