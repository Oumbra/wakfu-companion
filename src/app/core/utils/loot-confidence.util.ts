import { CatalogService } from '../api/catalog.service';
import { LootConfidence } from '../models/fight.model';
import { UNIVERSAL_LOOT_ITEM_IDS } from '../data/wakfu-universal-loot.data';

/**
 * Recoupe un objet de butin avec (1) le référentiel d'objets universels (`UNIVERSAL_LOOT_ITEM_IDS`,
 * curé à la main par l'utilisateur — voir sa doc) puis, à défaut, (2) les tables de drop connues des
 * monstres présents dans le combat (`monsters.loot`, voir CatalogService.findMonsterLootItemIds) —
 * voir LootConfidence (core/models/fight.model.ts) pour le détail des 3 issues possibles.
 *
 * Fonction PURE partagée entre deux appelants qui reconstruisent un `FightLoot`/`LootRow` chacun
 * depuis une source différente :
 *  - `StatsStoreService.addLootToFight` (combat en cours, `enemyNames` = `Fight.enemies` — le
 *    roster est déjà COMPLET à cet instant, voir sa doc).
 *  - `history-archive.service.ts#toFightRecord` (combat rechargé depuis l'archive du compte,
 *    `enemyNames` = les participants `side: 'enemy'` renvoyés par le serveur) — recalculée à CHAQUE
 *    lecture plutôt que persistée côté serveur : un monstre dont la table de drop n'était pas
 *    encore connue au moment du combat peut l'être devenue depuis (le référentiel ne fait que
 *    grandir), une confiance figée à l'écriture aurait empêché cette amélioration rétroactive.
 *
 * `findAllWakfuItemEntriesByName` (déjà utilisé par ItemPickerService pour la correction manuelle)
 * balaie tous les homonymes d'un même nom affiché (ex. "Larme d'Ogrest", ids 24029/21602, dont un
 * seul est réellement universel — voir doc de UNIVERSAL_LOOT_ITEM_IDS ; ou "Perle", ids 9792/20392,
 * même principe) — c'est ce qui permet de corriger `catalogId` au passage quand la résolution
 * "premier match" par défaut (`findWakfuItemEntry`) s'était trompée de variante.
 */
export function resolveLootConfidence(
  catalog: CatalogService,
  enemyNames: readonly string[],
  itemName: string,
  defaultCatalogId: number | null,
): { catalogId: number | null; confidence: LootConfidence } {
  const homonyms = catalog.findAllWakfuItemEntriesByName(itemName);

  // Objet universel (ou homonyme d'un objet universel) : confirmé indépendamment des monstres du
  // combat — voir doc de UNIVERSAL_LOOT_ITEM_IDS, testé AVANT le recoupement par monstre pour ne
  // jamais dépendre de la complétude de `monsters.loot` (un objet universel n'a de toute façon
  // aucune raison d'y figurer, sa présence n'est pas propre à un monstre).
  const universalMatch = homonyms.find((entry) => UNIVERSAL_LOOT_ITEM_IDS.has(entry.id));
  if (universalMatch) return { catalogId: universalMatch.id, confidence: 'confirmed' };

  const candidateItemIds = new Set<number>();
  for (const name of enemyNames) {
    const monster = catalog.findWakfuMonsterEntry(name);
    if (!monster) continue;
    for (const id of catalog.findMonsterLootItemIds(monster.id)) candidateItemIds.add(id);
  }
  // Aucun monstre de ce combat n'a de table de drop connue : pas assez de données pour juger,
  // surtout pas à confondre avec 'doubtful' (qui, lui, a des données à charge) — voir doc de
  // LootConfidence.
  if (candidateItemIds.size === 0) return { catalogId: defaultCatalogId, confidence: 'unknown' };

  const matches = homonyms.filter((entry) => candidateItemIds.has(entry.id));
  if (matches.length === 0) return { catalogId: defaultCatalogId, confidence: 'doubtful' };
  // Plusieurs correspondances (ambiguïté non levée même avec les données monstre, rare) : garde la
  // première par id, déjà triée ainsi par findAllWakfuItemEntriesByName.
  return { catalogId: matches[0].id, confidence: 'confirmed' };
}

/** Combine la confiance de deux occurrences d'un même objet cumulées (voir
 * StatsStoreService.finalizeFight, sessionLootMap) : 'doubtful' l'emporte toujours (signal à
 * charge, jamais masqué par une autre occurrence confirmée ailleurs), puis 'confirmed' l'emporte
 * sur 'unknown'. */
export function mergeLootConfidence(a: LootConfidence, b: LootConfidence): LootConfidence {
  if (a === 'doubtful' || b === 'doubtful') return 'doubtful';
  if (a === 'confirmed' || b === 'confirmed') return 'confirmed';
  return 'unknown';
}
