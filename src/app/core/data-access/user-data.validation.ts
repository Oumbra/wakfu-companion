import { findAvatarFanartGallery } from '../data/avatar-fanart-galleries.data';
import type { UserDataKey } from './user-data.keys';

/**
 * Gardes de type légères des données utilisateur (audit sécurité du 2026-09-23) : un fichier
 * d'import JSON, une valeur `localStorage` modifiée à la main ou une valeur venue du compte ne sont
 * jamais typés à l'exécution — `read<T>()` n'est qu'une assertion TypeScript. Sans ces gardes, une
 * valeur malformée (ex. `roster: 42`, `soundItems: "x"`) faisait planter le constructeur du service
 * consommateur au démarrage, et `avatarExternalUrl` acceptait n'importe quelle URL (pixel de suivi
 * chargé à chaque affichage de l'avatar).
 *
 * Principe : **repli sur la valeur par défaut, jamais d'exception**. Une valeur de premier niveau
 * du mauvais type renvoie `undefined` (le consommateur applique déjà son défaut pour une clé
 * absente) ; dans une liste, seuls les éléments invalides sont écartés ; dans un objet, seuls les
 * champs invalides sont retirés. Volontairement structurel (types primitifs, quelques littéraux
 * stables) et sans import de service — ce fichier est importé par `UserDataService`, que ces
 * services consomment (même raison que `user-data.keys.ts`). Coût : linéaire en taille de la
 * valeur, appelé uniquement au chargement (constructeurs, changement externe, import), jamais sur
 * le chemin chaud d'ingestion du log.
 */

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptional(value: unknown, guard: (v: unknown) => boolean): boolean {
  return value === undefined || guard(value);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Filtre les éléments d'une liste ; `undefined` si la valeur n'est pas une liste. */
function filterArray(value: unknown, guard: (item: unknown) => boolean): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(guard);
}

/** Seules les URL d'avatar issues des galeries fan-art connues (`static.ankama.com/web-test/{id}.png`,
 * plage d'ids d'une galerie de `AVATAR_FANART_GALLERIES`) sont acceptées. */
export function isAllowedAvatarExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && findAvatarFanartGallery(url) !== undefined;
}

function isSoundItem(item: unknown): boolean {
  return (
    isPlainObject(item) &&
    isString(item['name']) &&
    typeof item['enabled'] === 'boolean' &&
    isOptional(item['isDefault'], (v) => typeof v === 'boolean') &&
    isOptional(item['catalogId'], isNullableNumber)
  );
}

function sanitizeProfile(value: unknown): Json | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Json = { ...value };
  const drop = (field: string, valid: boolean) => {
    if (!valid) delete out[field];
  };
  drop('pseudo', isOptional(out['pseudo'], isString));
  drop('avatarIndex', isOptional(out['avatarIndex'], isNullableNumber));
  drop('avatarSchemaVersion', isOptional(out['avatarSchemaVersion'], isFiniteNumber));
  drop(
    'avatarExternalUrl',
    out['avatarExternalUrl'] === undefined ||
      out['avatarExternalUrl'] === null ||
      isAllowedAvatarExternalUrl(out['avatarExternalUrl']),
  );
  if (out['soundItems'] !== undefined) {
    const items = filterArray(out['soundItems'], isSoundItem);
    if (items === undefined) delete out['soundItems'];
    else out['soundItems'] = items;
  }
  drop(
    'alertDurationSeconds',
    isOptional(out['alertDurationSeconds'], (v) => isFiniteNumber(v) && v >= 0),
  );
  drop(
    'alertManualClose',
    isOptional(out['alertManualClose'], (v) => typeof v === 'boolean'),
  );
  drop(
    'characterViewMode',
    isOptional(out['characterViewMode'], (v) => v === 'list' || v === 'grid'),
  );
  return out;
}

function isWatchlistEntry(item: unknown): boolean {
  return (
    isPlainObject(item) &&
    isString(item['name']) &&
    isFiniteNumber(item['count']) &&
    (item['kind'] === 'enemy' || item['kind'] === 'item') &&
    isOptional(item['mode'], (v) => v === 'up' || v === 'down' || v === 'goal') &&
    isOptional(item['countdownTarget'], isFiniteNumber) &&
    isOptional(item['catalogId'], isNullableNumber)
  );
}

function isInstanceRef(value: unknown): boolean {
  return isPlainObject(value) && isString(value['name']) && isFiniteNumber(value['instanceIndex']);
}

function isDamageReassignment(item: unknown): boolean {
  return (
    isPlainObject(item) &&
    isFiniteNumber(item['fightId']) &&
    isString(item['spellName']) &&
    isInstanceRef(item['from']) &&
    isInstanceRef(item['to'])
  );
}

function isItemReassignment(item: unknown): boolean {
  if (!isPlainObject(item) || !isFiniteNumber(item['quantity'])) return false;
  if (!isFiniteNumber(item['catalogId'])) return false;
  switch (item['kind']) {
    case 'loot':
      return (
        isString(item['fightKey']) &&
        isString(item['itemName']) &&
        isNullableNumber(item['sourceCatalogId'])
      );
    case 'purchase':
      return isString(item['purchaseKey']) && isOptional(item['kamas'], isFiniteNumber);
    case 'tradeItem':
      return (
        isString(item['tradeKey']) &&
        (item['direction'] === 'acquired' || item['direction'] === 'given') &&
        isString(item['itemName']) &&
        isNullableNumber(item['sourceCatalogId'])
      );
    case 'pactItem':
      return (
        isString(item['pactKey']) &&
        isString(item['itemName']) &&
        isNullableNumber(item['sourceCatalogId'])
      );
    default:
      return false;
  }
}

function isRosterCharacter(item: unknown): boolean {
  return (
    isPlainObject(item) &&
    isString(item['name']) &&
    isString(item['className']) &&
    (item['gender'] === 'm' || item['gender'] === 'f')
  );
}

function sanitizeRosterAccount(item: unknown): Json | null {
  if (!isPlainObject(item) || !isString(item['id'])) return null;
  if (!isOptional(item['label'], isString)) return null;
  if (!isOptional(item['isDefault'], (v) => typeof v === 'boolean')) return null;
  if (!isOptional(item['gameServer'], (v) => v === null || isString(v))) return null;
  const characters = filterArray(item['characters'], isRosterCharacter);
  if (characters === undefined) return null;
  return { ...item, label: item['label'] ?? '', characters };
}

function sanitizeRoster(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const accounts: Json[] = [];
  for (const item of value) {
    const account = sanitizeRosterAccount(item);
    if (account) accounts.push(account);
  }
  return accounts;
}

function isChatFilter(item: unknown): boolean {
  return (
    isString(item) || (isPlainObject(item) && isString(item['text']) && isString(item['channel']))
  );
}

function isBooleanRecord(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'boolean');
}

function sanitizeDashboardLayout(value: unknown): Json | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Json = { ...value };
  for (const field of ['menuPos', 'kpiPos', 'bodyMode', 'focusTarget', 'focusSide']) {
    if (!isOptional(out[field], isString)) delete out[field];
  }
  for (const field of ['historyGroup', 'collapsedSections']) {
    if (!isOptional(out[field], isBooleanRecord)) delete out[field];
  }
  // `blockOrder` : validé (et migré) par DashboardLayoutService.applyStored lui-même.
  return out;
}

/**
 * Valeur utilisable de `key`, ou `undefined` si elle est inexploitable (le consommateur retombe
 * alors sur sa valeur par défaut). Renvoie la valeur d'origine telle quelle quand rien n'est à
 * corriger dans une valeur scalaire ; une copie filtrée pour une liste/un objet.
 */
export function sanitizeUserDataValue(key: UserDataKey, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  switch (key) {
    case 'profile':
      return sanitizeProfile(value);
    case 'watchlist':
      return filterArray(value, isWatchlistEntry);
    case 'watchlistAddMode':
      return value === 'up' || value === 'down' || value === 'goal' ? value : undefined;
    case 'damageReassignments':
      return filterArray(value, isDamageReassignment);
    case 'itemReassignments':
      return filterArray(value, isItemReassignment);
    case 'roster':
      return sanitizeRoster(value);
    case 'chatActiveChannels':
      return filterArray(value, isString);
    case 'chatFilters':
      return filterArray(value, isChatFilter);
    case 'combatPanelCollapsed':
    case 'chatPanelCollapsed':
      return typeof value === 'boolean' ? value : undefined;
    case 'dashboardLayout':
      return sanitizeDashboardLayout(value);
    default: {
      // Garde d'exhaustivité : une nouvelle clé de USER_DATA_KEYS doit recevoir sa garde ici.
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}
