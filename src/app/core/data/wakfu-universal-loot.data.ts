/**
 * Objets connus pour tomber en combat INDÉPENDAMMENT des monstres affrontés — jamais présents dans
 * une table `monsters.loot` (voir server/db/schema.ts) puisqu'ils ne sont pas propres à un monstre
 * précis, donc systématiquement marqués `'doubtful'` par `resolveLootConfidence`
 * (core/utils/loot-confidence.util.ts) sans ce référentiel. Curée à la main par l'utilisateur à
 * partir d'une analyse statistique réelle sur la base de production (voir
 * `server/import/analyze-universal-loot.ts`, `npm run main:analyze:universal-loot`) : signal retenu
 * pour juger de l'universalité d'un objet marqué "doute" = apparition dans de nombreux donjons
 * différents plutôt qu'un seul (auquel cas il s'agit plutôt d'un trou du référentiel `monsters.loot`
 * pour UN monstre précis, à corriger via le skill wakfu-monsters-sync plutôt qu'ici).
 *
 * Familles :
 * - Havre-Gemme / Fragment de Havre-Gemme : gemmes/fragments de havre-sac, un chance de drop
 *   générique sur (quasi) tout combat. Seules les variantes NON craftables (`items.hasRecipe ===
 *   false`) sont retenues — une variante craftable (ex. "Havre-Gemme de Bonta") s'obtient par
 *   recette, jamais par un simple ramassage de combat ; un exemplaire qui apparaîtrait malgré tout
 *   dans `fight_loot` pour cette raison n'aurait pas de sens à traiter comme "universel".
 * - Objets "événement"/pierres génériques : Plâjeton, Perle, Clef du Pâlais Mârin (lot d'un même
 *   événement, ids 20390-20392 consécutifs), Guildalogemme, Pierre de Cristal, Pierre de Diamant.
 * - Butin de mimique : "Mimicroquettes" (déposé par un mimique quel que soit le donjon — voir
 *   CLAUDE.md sur le traitement des mimiques). "Bave de Mimic" avait le même profil dans l'analyse
 *   statistique (23 vs 16 donjons distincts) mais n'a pas été confirmée par l'utilisateur, donc pas
 *   encore ajoutée ici.
 *
 * `Larme d'Ogrest` mérite une note à part : DEUX objets partagent ce nom (voir
 * CatalogService.findAllWakfuItemEntriesByName) — id 24029 (catégorie `resources`), le vrai butin
 * universel (confirmé par l'utilisateur : tombe en fin de combat quel que soit l'adversaire), et id
 * 21602 (catégorie `misc`), une résolution parasite d'AVANT le correctif de recoupement par monstre
 * (lot butin/loot) : `findWakfuItemEntry` retombait dessus arbitrairement faute de mieux. Seul 24029
 * figure ci-dessous — 21602 ne doit jamais y être ajouté, il n'a pas d'existence propre comme
 * "objet universel" (voir resolveLootConfidence, qui utilise déjà ce référentiel pour désambiguïser
 * ce cas précis, pas seulement pour confirmer un id déjà univoque).
 */
export const UNIVERSAL_LOOT_ITEM_IDS: ReadonlySet<number> = new Set([
  // Fragments de Havre-Gemme (jamais craftables, les 4 variantes existantes)
  12526, // Fragment de Havre-Gemme Marchande
  12527, // Fragment de Havre-Gemme Jardin
  12528, // Fragment de Havre-Gemme Artisanat
  12530, // Fragment de Havre-Gemme Déco

  // Havre-Gemme non craftables (exclut 27575 "Havre-Gemme de Bonta", hasRecipe: true)
  4262, // Havre-Gemme Marchande
  4263, // Havre-Gemme Décoration
  4264, // Havre-Gemme Artisanale
  4266, // Havre-Gemme de Jardin
  27572, // Havre-Gemme de Sufokia
  27573, // Havre-Gemme d'Amakna
  27574, // Havre-Gemme de Brâkmar

  27933, // Havre-Ambiance rayon de lumière

  24029, // Larme d'Ogrest (PAS 21602, voir doc de tête)

  16942, // Guildalogemme
  9795, // Pierre de Cristal
  9800, // Pierre de Diamant

  12324, // Mimicroquettes (butin de mimique, voir doc de tête)

  // Objets d'un même événement (ids consécutifs 20390-20392)
  20390, // Clef du Pâlais Mârin
  20391, // Plâjeton
  20392, // Perle (PAS 9792, homonyme "Perle" ordinaire — voir findAllWakfuItemEntriesByName)
]);
