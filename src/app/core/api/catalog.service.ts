import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { PersistenceService } from '../services/persistence.service';
import { normalizeWakfuName } from '../utils/wakfu-name.util';
import { RARITY_SORT_ORDER, WakfuRarity } from '../data/wakfu-item-rarity.data';
import { ITEM_CATEGORY_SORT_ORDER, WakfuItemCategory } from '../data/wakfu-item-category.data';

const INDEX_CACHE_KEY = 'catalog-index';
const DUNGEONS_CACHE_KEY = 'catalog-dungeons';
const MONSTER_FAMILIES_CACHE_KEY = 'catalog-monster-families';

/** Doit rester la même table que server/catalog/compact-index.ts (RARITY_SORT_ORDER) — construite
 * une seule fois par inversion de RARITY_SORT_ORDER (déjà défini côté client) plutôt que dupliquée
 * à la main. */
const RARITY_BY_SORT_ORDER: Readonly<Record<number, WakfuRarity>> = Object.fromEntries(
  Object.entries(RARITY_SORT_ORDER).map(([rarity, order]) => [order, rarity as WakfuRarity]),
);

/** Même principe que RARITY_BY_SORT_ORDER, pour ITEM_CATEGORY_SORT_ORDER (server/catalog/compact-index.ts). */
const ITEM_CATEGORY_BY_SORT_ORDER: Readonly<Record<number, WakfuItemCategory>> = Object.fromEntries(
  Object.entries(ITEM_CATEGORY_SORT_ORDER).map(([category, order]) => [
    order,
    category as WakfuItemCategory,
  ]),
);

export interface CatalogItemEntry {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  gfxId: number;
  rarity: WakfuRarity;
  hasRecipe: boolean;
  category: WakfuItemCategory;
}

export interface CatalogMonsterEntry {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  gfxId: string;
  /** `null` si le monstre n'a pas de famille encyclopédie (28 monstres sur 851). Référence
   * `CatalogMonsterFamilyEntry.id` (voir findWakfuMonsterFamilyById), jamais résolue ici même : le
   * nom de famille se lit dans une table séparée, pas dupliqué sur chaque monstre. */
  family: number | null;
  isBoss: boolean;
  isArchi: boolean;
  isDominant: boolean;
}

/** Famille encyclopédie d'un monstre (`repository/monster-families.json`, ~150 lignes) — sert
 * uniquement à donner un libellé localisé au palier "famille de monstre" du regroupement "Type" de
 * l'historique des combats (voir resolveFightTypeClassification, core/utils/fight-image.util.ts) ;
 * pas utilisée dans le chemin chaud de parsing (contrairement à CatalogMonsterEntry), chargée et
 * mise en cache comme CatalogDungeonEntry (petit volume, jamais dans l'index compact). */
export interface CatalogMonsterFamilyEntry {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
}

/** Catégorie d'un donjon, curée à la main dans repository/dungeons.json (miroir de
 * WakfuDungeonType côté serveur, server/db/schema.ts). `TWO_ROOMS`/`THREE_ROOMS`/`FOUR_ROOMS`
 * portent le nombre de salles précédant le boss (voir dungeonRoomCount,
 * core/utils/dungeon-run-grouping.util.ts) ; `BREACH`/`ULTIMATE_BREACH` remplacent les anciens
 * booléens `isBreach`/`isUltimateBreach` ; `THREE_PLAYERS`/`ULTIMATE_BOSS`/`ARCADE` désignent des
 * donjons à un seul combat (aucune salle à rattacher). */
export type WakfuDungeonType =
  | 'TWO_ROOMS'
  | 'THREE_ROOMS'
  | 'FOUR_ROOMS'
  | 'THREE_PLAYERS'
  | 'ULTIMATE_BOSS'
  | 'BREACH'
  | 'ULTIMATE_BREACH'
  | 'ARCADE';

/** Vrai pour une brèche dimensionnelle (`BREACH`/`ULTIMATE_BREACH`) — remplace l'ancien booléen
 * `CatalogDungeonEntry.isBreach`. Utilisé pour masquer le tooltip/nom de donjon sur ces
 * illustrations (voir fight-image.util.ts, fight-history.component.ts). */
export function isDungeonBreach(dungeon: CatalogDungeonEntry): boolean {
  return dungeon.type === 'BREACH' || dungeon.type === 'ULTIMATE_BREACH';
}

export interface CatalogDungeonEntry {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  level: number;
  bracket: number;
  type: WakfuDungeonType;
  /** Toujours un tableau, quel que soit le nombre de boss (0, 1, ou plusieurs pour
   * ULTIMATE_BREACH — voir repository/dungeons.json) : normalisé ainsi côté serveur (voir
   * server/import/import-catalog.ts, toIdArray), jamais un entier nu ni `null` ici. */
  bossMonsterId: readonly number[];
  /** Famille(s) de monstre du donjon/de la brèche — même convention "toujours un tableau" que
   * bossMonsterId ci-dessus (plusieurs éléments pour BREACH/ULTIMATE_BREACH, vide si inconnue). */
  monsterFamilyId: readonly number[];
  pictureUrl: string;
  wakassetsAvailable: boolean;
  /** Vrai pour les rares donjons avec un combat d'archimonstre supplémentaire avant le boss (ex.
   * Kokokolantha, Nécropoil de Morbax, La Pichine) — voir dungeon-run-grouping.util.ts. */
  hasPreBossArchi: boolean;
}

export interface CatalogItemDetail extends CatalogItemEntry {
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
  recipe: { itemId: number; name: string | null; quantity: number }[];
}

/** Voir CatalogService.resolveRecipeIngredients. */
export interface CatalogResolvedIngredient {
  name: string;
  /** Id Ankama EXACT de cet ingrédient (voir `items.recipe[].itemId` côté serveur) — à utiliser
   * pour le suivi (findWakfuItemEntryById), jamais une résolution par nom seul : un ingrédient
   * peut partager son nom avec une autre variante de rareté différente du même objet (ex. une
   * recette qui demande l'objet lui-même à un palier inférieur), et `findWakfuItemEntry(name)`
   * ne garantit pas de retomber sur CE palier précis. */
  id: number;
  rarity: WakfuRarity;
  quantity: number;
  hasRecipe: boolean;
  recipeIngredients: readonly CatalogResolvedIngredient[];
}

export interface CatalogMonsterDetail {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  gfxId: string;
  family: number | null;
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
  isBoss: boolean;
  isArchi: boolean;
  isDominant: boolean;
}

/** `loading` : ni le cache ni le réseau n'ont encore répondu. `ready` : l'index en mémoire est
 * exploitable (via le cache et/ou un fetch réussi). `unavailable` : ni cache ni réseau — voir
 * prompt 3.1 point 4 ("affiche un état explicite plutôt qu'une application qui semble fonctionner
 * mais ne reconnaît plus aucun objet"). */
export type CatalogStatus = 'loading' | 'ready' | 'unavailable';

interface CachedIndexPayload {
  indexHash: string;
  items: (number | string)[][];
  monsters: (number | string)[][];
}

type ItemTuple = [number, string, string, string, string, number, number, number, number];
type MonsterTuple = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
];

/**
 * Catalogue Ankama (objets/monstres/donjons) servi par l'API distante — lot
 * 3.1, remplace les tables embarquées wakfu-{items,monsters,dungeons}.data.ts
 * (supprimées à l'étape 8 du même lot).
 *
 * SQUELETTE (étape 2/9) : ce service est complet et testé unitairement mais
 * n'est encore branché à AUCUN consommateur — zéro changement de
 * comportement pour l'application tant que les étapes suivantes n'ont pas
 * migré chaque appelant un par un (voir docs/prompts-migration-serveur.md,
 * prompt 3.1, et la décomposition en étapes actée avec l'utilisateur).
 *
 * Contrainte absolue (prompt 3.1) : findWakfuItemEntry/findWakfuMonsterEntry
 * sont dans le CHEMIN CHAUD du parsing (StatsStoreService, à chaque
 * ramassage d'objet) — ils DOIVENT rester synchrones, d'où l'architecture
 * "charge tout en mémoire une fois, cache IndexedDB, lookup en Map" plutôt
 * qu'un appel réseau par lookup.
 *
 * Chargement (méthode `initialize()`, à appeler une fois au démarrage —
 * pas encore fait, voir étape 7) :
 * 1. Lit le cache IndexedDB (PersistenceService) — s'il existe, construit
 *    immédiatement les Map en mémoire et passe `status` à `ready` SANS
 *    attendre le réseau (l'app doit démarrer vite sur les lancements
 *    suivants).
 * 2. Rafraîchissement en arrière-plan (non bloquant si un cache existait) :
 *    compare `indexHash` (GET /catalog/version) à celui du cache ; si
 *    différent (ou pas de cache du tout), télécharge /catalog/index +
 *    /dungeons, reconstruit les Map, met à jour le cache.
 * 3. Premier lancement (pas de cache) : pas de repli possible, on ATTEND le
 *    résultat du réseau avant de conclure `ready` ou `unavailable`.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly apiClient = inject(ApiClientService);
  private readonly persistence = inject(PersistenceService);

  readonly status = signal<CatalogStatus>('loading');
  /** Incrémenté à chaque (re)construction des Map en mémoire (applyIndex/applyDungeons) — à lire
   * dans un computed() consommateur pour se rendre dépendant des données du catalogue : `status`
   * seul ne suffit PAS (un rafraîchissement en arrière-plan qui succède à un état déjà `ready` ne
   * change pas la valeur du signal, donc ne notifie personne). */
  readonly revision = signal(0);

  private itemsById = new Map<number, CatalogItemEntry>();
  private itemsByFrName = new Map<string, CatalogItemEntry>();
  private itemsByOtherLocaleName = new Map<string, CatalogItemEntry>();
  private monstersById = new Map<number, CatalogMonsterEntry>();
  private monstersByFrName = new Map<string, CatalogMonsterEntry>();
  private monstersByOtherLocaleName = new Map<string, CatalogMonsterEntry>();
  private dungeonsByBossMonsterId = new Map<number, CatalogDungeonEntry>();
  private monsterFamiliesById = new Map<number, CatalogMonsterFamilyEntry>();

  async initialize(): Promise<void> {
    const [cachedIndex, cachedDungeons, cachedMonsterFamilies] = await Promise.all([
      this.persistence.getCacheEntry<CachedIndexPayload>(INDEX_CACHE_KEY),
      this.persistence.getCacheEntry<CatalogDungeonEntry[]>(DUNGEONS_CACHE_KEY),
      this.persistence.getCacheEntry<CatalogMonsterFamilyEntry[]>(MONSTER_FAMILIES_CACHE_KEY),
    ]);

    if (cachedIndex && cachedDungeons) {
      this.applyIndex(cachedIndex);
      this.applyDungeons(cachedDungeons);
      // Optionnel (pas requis pour le chemin rapide, contrairement à cachedDungeons) : absent au
      // tout premier démarrage suivant l'ajout de cette table (cache existant plus ancien), il se
      // remplira au prochain rafraîchissement en arrière-plan ci-dessous — jamais bloquant, le
      // libellé de famille a un repli côté client (voir fight-image.util.ts) en son absence.
      if (cachedMonsterFamilies) this.applyMonsterFamilies(cachedMonsterFamilies);
      this.status.set('ready');
      // Rafraîchissement en arrière-plan : ne bloque pas le démarrage, voir doc de classe.
      void this.refreshIfNeeded(cachedIndex.indexHash);
      return;
    }

    // Premier lancement (ou cache partiel/absent) : aucun repli possible, on doit attendre le réseau.
    const refreshed = await this.refreshIfNeeded(null);
    this.status.set(refreshed ? 'ready' : 'unavailable');
  }

  /** Recherche un objet par nom, quelle que soit sa langue (FR/EN/ES/PT) — miroir de
   * findWakfuItemEntry (wakfu-items.data.ts, avant migration). SYNCHRONE : lit uniquement l'index
   * déjà en mémoire (voir contrainte du chemin chaud dans la doc de classe). */
  findWakfuItemEntry(name: string): CatalogItemEntry | undefined {
    const key = normalizeWakfuName(name);
    return this.itemsByFrName.get(key) ?? this.itemsByOtherLocaleName.get(key);
  }

  findWakfuItemEntryById(id: number): CatalogItemEntry | undefined {
    return this.itemsById.get(id);
  }

  /** Toutes les entrées catalogue partageant ce nom (n'importe quelle langue), triées par id — sert
   * à la désambiguïsation manuelle d'objets homonymes de rareté différente (ex. "Larme d'Ogrest",
   * ids 24029/21602 : `findWakfuItemEntry` n'en renvoie qu'une seule, arbitrairement). Balaie tout
   * `itemsById` (pas indexé par nom pour le cas multiple) : jamais un chemin chaud, seulement appelé
   * à l'ouverture du sélecteur de correction (voir ItemPickerService). */
  findAllWakfuItemEntriesByName(name: string): CatalogItemEntry[] {
    const key = normalizeWakfuName(name);
    return [...this.itemsById.values()]
      .filter(
        (entry) =>
          normalizeWakfuName(entry.fr) === key ||
          normalizeWakfuName(entry.en) === key ||
          normalizeWakfuName(entry.es) === key ||
          normalizeWakfuName(entry.pt) === key,
      )
      .sort((a, b) => a.id - b.id);
  }

  /** Miroir de findWakfuMonsterEntry — voir findWakfuItemEntry. */
  findWakfuMonsterEntry(name: string): CatalogMonsterEntry | undefined {
    const key = normalizeWakfuName(name);
    return this.monstersByFrName.get(key) ?? this.monstersByOtherLocaleName.get(key);
  }

  /** Miroir de findWakfuItemEntryById — voir findWakfuItemEntryById. Résolution non ambiguë par id,
   * à préférer à findWakfuMonsterEntry(name) partout où l'id est déjà connu (ex. capturé une fois à
   * la sélection dans l'autocomplétion) : le nom seul ne suffit pas à distinguer deux monstres
   * homonymes (25 cas constatés dans repository/monsters.json, ex. "Corbac", "Malopo"). */
  findWakfuMonsterEntryById(id: number): CatalogMonsterEntry | undefined {
    return this.monstersById.get(id);
  }

  isKnownWakfuMonsterName(name: string): boolean {
    return this.findWakfuMonsterEntry(name) !== undefined;
  }

  findWakfuDungeonByBossMonsterId(bossMonsterId: number): CatalogDungeonEntry | undefined {
    return this.dungeonsByBossMonsterId.get(bossMonsterId);
  }

  /** Résout `CatalogMonsterEntry.family` vers son libellé localisé — `undefined` si la famille
   * n'a pas (encore) de nom connu (cache pas encore rafraîchi, voir `initialize`, ou id de famille
   * absent du référentiel) : l'appelant doit alors se rabattre sur un autre libellé, voir
   * `resolveFightTypeClassification` (fight-image.util.ts). */
  findWakfuMonsterFamilyById(familyId: number): CatalogMonsterFamilyEntry | undefined {
    return this.monsterFamiliesById.get(familyId);
  }

  /** Itère tous les objets connus — sert à l'autocomplétion (WakfuSearchService, étape 5), qui
   * doit rester instantanée (recherche dans l'index LOCAL, jamais une requête par frappe). */
  itemEntries(): Iterable<CatalogItemEntry> {
    return this.itemsById.values();
  }

  monsterEntries(): Iterable<CatalogMonsterEntry> {
    return this.monstersById.values();
  }

  /** Détail complet (recette, traductions, image) — ASYNCHRONE par design (prompt 3.1) : ne fait
   * pas partie de l'index compact chargé au démarrage. `undefined` si l'objet est introuvable ou
   * si la requête échoue (hors-ligne...). */
  async getItemDetail(id: number): Promise<CatalogItemDetail | undefined> {
    const result = await this.apiClient.getJson<CatalogItemDetail>(`/items/${id}`);
    return result.ok ? result.data : undefined;
  }

  /** Résout, récursivement (cascade sur tous les niveaux de la recette), les ingrédients d'un
   * objet vers leur nom FR affichable + quantité requise — voir suivi > "suivre les objets de la
   * recette". Miroir ASYNCHRONE de resolveRecipeIngredientNames (wakfu-items.data.ts, avant
   * migration) : chaque niveau nécessite un aller-retour réseau (GET /items/{id}), contrairement à
   * l'ancienne version qui traversait un index local complet — voir
   * shared/wakfu-autocomplete/wakfu-autocomplete.component.ts (`openRecipe`, état de chargement).
   * `hasRecipe` par ingrédient est déterminé SANS réseau via `findWakfuItemEntryById` (déjà dans
   * l'index compact en mémoire) : seuls les ingrédients ayant réellement une recette déclenchent un
   * appel réseau supplémentaire (récursion), pas la totalité de l'arbre exploré à l'aveugle.
   *
   * `ancestorIds` protège contre une boucle infinie si le référentiel contient un cycle (objet
   * ingrédient de lui-même, directement ou via une chaîne plus longue — cas réel rencontré, voir
   * ancien commentaire de resolveRecipeIngredientNames) : un ingrédient dont l'id est déjà un
   * ancêtre dans la chaîne en cours est résolu avec `hasRecipe: false` (la ligne reste affichée
   * normalement, seule sa propre recette n'est pas développée davantage). Un ingrédient dont le nom
   * n'a pas pu être résolu côté serveur (`name: null`, id absent de la table `items`) est
   * silencieusement omis, comme avant.
   */
  async resolveRecipeIngredients(
    id: number,
    ancestorIds: ReadonlySet<number> = new Set([id]),
  ): Promise<CatalogResolvedIngredient[]> {
    const detail = await this.getItemDetail(id);
    if (!detail) return [];

    const resolved = await Promise.all(
      detail.recipe
        .filter(
          (ingredient): ingredient is { itemId: number; name: string; quantity: number } =>
            ingredient.name !== null,
        )
        .map(async (ingredient) => {
          const isCycle = ancestorIds.has(ingredient.itemId);
          const entry = this.findWakfuItemEntryById(ingredient.itemId);
          const hasRecipe = (entry?.hasRecipe ?? false) && !isCycle;
          const recipeIngredients = hasRecipe
            ? await this.resolveRecipeIngredients(
                ingredient.itemId,
                new Set([...ancestorIds, ingredient.itemId]),
              )
            : [];
          return {
            name: ingredient.name,
            id: ingredient.itemId,
            rarity: entry?.rarity ?? 'common',
            quantity: ingredient.quantity,
            hasRecipe,
            recipeIngredients,
          };
        }),
    );
    return resolved;
  }

  async getMonsterDetail(id: number): Promise<CatalogMonsterDetail | undefined> {
    const result = await this.apiClient.getJson<CatalogMonsterDetail>(`/monsters/${id}`);
    return result.ok ? result.data : undefined;
  }

  /** Compare l'empreinte locale (`cachedHash`, `null` si pas de cache) à celle du serveur et
   * rafraîchit l'index/les donjons si nécessaire. Retourne `true` si l'index en mémoire à l'issue
   * de l'appel est exploitable (déjà à jour, rafraîchi avec succès, ou repli sur un cache existant
   * suite à une panne réseau) — `false` uniquement si RIEN n'est exploitable (pas de cache ET
   * réseau injoignable). */
  private async refreshIfNeeded(cachedHash: string | null): Promise<boolean> {
    const versionResult = await this.apiClient.getJson<{ indexHash: string }>('/catalog/version');
    if (!versionResult.ok) {
      return cachedHash !== null;
    }
    if (versionResult.data.indexHash === cachedHash) {
      // `indexHash` ne couvre QUE l'index compact (objets/monstres, voir buildCompactIndex côté
      // serveur) — ni les donjons ni les familles de monstre n'y participent (payloads séparés,
      // /dungeons et /monster-families). Un changement portant uniquement sur
      // `repository/dungeons.json` (ex. type de donjon corrigé) ou `repository/monster-families.json`
      // ne fait donc jamais bouger ce hash : sans ce rafraîchissement dédié, un navigateur ayant
      // déjà un catalogue en cache ne réapprendrait JAMAIS une telle correction, potentiellement
      // indéfiniment (bug réel constaté sur les donjons : "Repaire des Super-Vilains" resté mal
      // typé côté client alors que la base était déjà correcte). Fire-and-forget : ne bloque pas
      // `initialize()`, les deux payloads sont petits (quelques dizaines de Ko).
      void this.refreshDungeonsAndFamiliesOnly();
      return true;
    }

    const [indexResult, dungeonsResult, monsterFamiliesResult] = await Promise.all([
      // Chemin SANS le segment "index" : Cloudflare Pages Functions traite un fichier nommé
      // index.ts comme la route racine de son dossier (`/catalog/`), pas comme un segment
      // littéral `/index` — une requête vers `/catalog/index` se prend une redirection 308 vers
      // `/catalog/` (bug réel constaté en prod : la redirection cassait silencieusement le
      // chargement du catalogue côté client). Voir functions/api/v1/catalog/index.ts.
      this.apiClient.getJson<{ items: (number | string)[][]; monsters: (number | string)[][] }>(
        '/catalog/',
      ),
      this.apiClient.getJson<CatalogDungeonEntry[]>('/dungeons'),
      this.apiClient.getJson<CatalogMonsterFamilyEntry[]>('/monster-families'),
    ]);
    if (!indexResult.ok || !dungeonsResult.ok) {
      return cachedHash !== null;
    }

    const payload: CachedIndexPayload = {
      indexHash: versionResult.data.indexHash,
      items: indexResult.data.items,
      monsters: indexResult.data.monsters,
    };
    this.applyIndex(payload);
    this.applyDungeons(dungeonsResult.data);
    // Non bloquant pour le statut `ready` (voir doc de `findWakfuMonsterFamilyById`) : un échec
    // réseau isolé sur ce seul payload ne doit pas dégrader le reste du catalogue.
    if (monsterFamiliesResult.ok) this.applyMonsterFamilies(monsterFamiliesResult.data);
    this.status.set('ready');
    await Promise.all([
      this.persistence.setCacheEntry(INDEX_CACHE_KEY, payload),
      this.persistence.setCacheEntry(DUNGEONS_CACHE_KEY, dungeonsResult.data),
      ...(monsterFamiliesResult.ok
        ? [this.persistence.setCacheEntry(MONSTER_FAMILIES_CACHE_KEY, monsterFamiliesResult.data)]
        : []),
    ]);
    return true;
  }

  /** Rafraîchit UNIQUEMENT `/dungeons` + `/monster-families`, indépendamment de `indexHash` (voir
   * le commentaire dans `refreshIfNeeded`) — seul moyen pour un navigateur avec un catalogue déjà
   * en cache d'apprendre une correction de donjon ou de famille qui ne s'accompagne d'aucun
   * changement d'objet/monstre. Silencieux en cas d'échec réseau, PAYLOAD PAR PAYLOAD (le cache
   * existant de chacun reste utilisable tel quel si l'autre échoue). */
  private async refreshDungeonsAndFamiliesOnly(): Promise<void> {
    const [dungeonsResult, monsterFamiliesResult] = await Promise.all([
      this.apiClient.getJson<CatalogDungeonEntry[]>('/dungeons'),
      this.apiClient.getJson<CatalogMonsterFamilyEntry[]>('/monster-families'),
    ]);
    if (dungeonsResult.ok) {
      this.applyDungeons(dungeonsResult.data);
      await this.persistence.setCacheEntry(DUNGEONS_CACHE_KEY, dungeonsResult.data);
    }
    if (monsterFamiliesResult.ok) {
      this.applyMonsterFamilies(monsterFamiliesResult.data);
      await this.persistence.setCacheEntry(MONSTER_FAMILIES_CACHE_KEY, monsterFamiliesResult.data);
    }
  }

  private applyIndex(payload: CachedIndexPayload): void {
    const itemsById = new Map<number, CatalogItemEntry>();
    const itemsByFrName = new Map<string, CatalogItemEntry>();
    const itemsByOtherLocaleName = new Map<string, CatalogItemEntry>();
    for (const tuple of payload.items) {
      const [id, fr, en, es, pt, gfxId, raritySortOrder, hasRecipeFlag, categorySortOrder] =
        tuple as ItemTuple;
      const entry: CatalogItemEntry = {
        id,
        fr,
        en,
        es,
        pt,
        gfxId,
        rarity: RARITY_BY_SORT_ORDER[raritySortOrder] ?? 'common',
        hasRecipe: hasRecipeFlag === 1,
        category: ITEM_CATEGORY_BY_SORT_ORDER[categorySortOrder] ?? 'misc',
      };
      itemsById.set(id, entry);
      const frKey = normalizeWakfuName(fr);
      if (!itemsByFrName.has(frKey)) itemsByFrName.set(frKey, entry);
      for (const localized of [en, es, pt]) {
        const key = normalizeWakfuName(localized);
        if (!itemsByOtherLocaleName.has(key)) itemsByOtherLocaleName.set(key, entry);
      }
    }
    this.itemsById = itemsById;
    this.itemsByFrName = itemsByFrName;
    this.itemsByOtherLocaleName = itemsByOtherLocaleName;

    const monstersById = new Map<number, CatalogMonsterEntry>();
    const monstersByFrName = new Map<string, CatalogMonsterEntry>();
    const monstersByOtherLocaleName = new Map<string, CatalogMonsterEntry>();
    for (const tuple of payload.monsters) {
      const [id, fr, en, es, pt, gfxId, family, isBossFlag, isArchiFlag, isDominantFlag] =
        tuple as MonsterTuple;
      const entry: CatalogMonsterEntry = {
        id,
        fr,
        en,
        es,
        pt,
        gfxId,
        family: family === -1 ? null : family,
        isBoss: isBossFlag === 1,
        isArchi: isArchiFlag === 1,
        isDominant: isDominantFlag === 1,
      };
      monstersById.set(id, entry);
      const frKey = normalizeWakfuName(fr);
      if (!monstersByFrName.has(frKey)) monstersByFrName.set(frKey, entry);
      for (const localized of [en, es, pt]) {
        const key = normalizeWakfuName(localized);
        if (!monstersByOtherLocaleName.has(key)) monstersByOtherLocaleName.set(key, entry);
      }
    }
    this.monstersById = monstersById;
    this.monstersByFrName = monstersByFrName;
    this.monstersByOtherLocaleName = monstersByOtherLocaleName;
    this.revision.update((v) => v + 1);
  }

  private applyDungeons(dungeons: CatalogDungeonEntry[]): void {
    const byBossMonsterId = new Map<number, CatalogDungeonEntry>();
    for (const dungeon of dungeons) {
      for (const bossMonsterId of dungeon.bossMonsterId) {
        if (!byBossMonsterId.has(bossMonsterId)) {
          byBossMonsterId.set(bossMonsterId, dungeon);
        }
      }
    }
    this.dungeonsByBossMonsterId = byBossMonsterId;
    this.revision.update((v) => v + 1);
  }

  private applyMonsterFamilies(families: CatalogMonsterFamilyEntry[]): void {
    this.monsterFamiliesById = new Map(families.map((family) => [family.id, family]));
    this.revision.update((v) => v + 1);
  }
}
