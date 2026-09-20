import type { UserDataKey } from './user-data.keys';

/**
 * Écriture partielle des données utilisateur (minimisation, analyse RGPD
 * constat C9) : plutôt que de renvoyer le profil ou le roster ENTIER à chaque
 * réglage, le client n'envoie au compte que ce qui a changé depuis la dernière
 * version que le serveur détient, et le serveur fusionne
 * (`PATCH /api/v1/settings`, entrée `{ key, patch, updatedAt }` — voir
 * `server/settings/patch.ts`, qui fixe la sémantique de chaque clé).
 *
 * Ce fichier n'importe rien du serveur (`server/` et `src/` ne se connaissent
 * pas, même principe que `user-data.keys.ts`) : les deux clés fusionnables
 * sont donc dupliquées ici, à garder alignées avec `MERGEABLE_SETTING_KEYS`.
 *
 * Un correctif ne sait pas supprimer un champ ni réordonner une liste : dans
 * ces cas (`'full'`), la valeur entière repart comme avant — jamais une
 * fusion approximative.
 */
export const MERGEABLE_USER_DATA_KEYS: readonly UserDataKey[] = ['profile', 'roster'];

export function isMergeableUserDataKey(key: UserDataKey): boolean {
  return MERGEABLE_USER_DATA_KEYS.includes(key);
}

export type UserDataPatchPlan =
  /** Rien ne diffère de la version du compte : rien à envoyer. */
  | { kind: 'none' }
  /** Différence exprimable en correctif partiel. */
  | { kind: 'patch'; patch: unknown }
  /** Différence non exprimable (champ retiré, ordre changé, forme inattendue) : valeur entière. */
  | { kind: 'full' };

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ce que le serveur recevrait réellement : `undefined` disparaît à la sérialisation. */
function normalize(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fusion superficielle inversée : les champs de `local` absents ou différents
 * dans `acked`. `null` si un champ d'`acked` a disparu de `local` (pas
 * exprimable), objet vide si rien ne diffère.
 */
function shallowDiff(acked: JsonObject, local: JsonObject): JsonObject | null {
  for (const key of Object.keys(acked)) if (!(key in local)) return null;
  const diff: JsonObject = {};
  for (const [key, value] of Object.entries(local)) {
    if (!(key in acked) || !sameJson(acked[key], value)) diff[key] = value;
  }
  return diff;
}

/**
 * Décide comment envoyer `key` au compte, connaissant la valeur que le serveur
 * détient (`acked`, telle que ce client l'a vue en dernier) et la valeur
 * locale courante.
 */
export function buildUserDataPatch(
  key: UserDataKey,
  acked: unknown,
  localRaw: unknown,
): UserDataPatchPlan {
  if (!isMergeableUserDataKey(key)) return { kind: 'full' };
  const local = normalize(localRaw);
  if (sameJson(acked, local)) return { kind: 'none' };

  if (key === 'profile') {
    if (!isJsonObject(acked) || !isJsonObject(local)) return { kind: 'full' };
    const diff = shallowDiff(acked, local);
    if (diff === null) return { kind: 'full' };
    return Object.keys(diff).length === 0 ? { kind: 'none' } : { kind: 'patch', patch: diff };
  }

  // roster : liste de comptes identifiés par `id`.
  if (!Array.isArray(acked) || !Array.isArray(local)) return { kind: 'full' };
  const ackedById = new Map<string, JsonObject>();
  for (const account of acked) {
    if (!isJsonObject(account) || typeof account['id'] !== 'string') return { kind: 'full' };
    ackedById.set(account['id'], account);
  }
  const accounts: JsonObject[] = [];
  const localIds: string[] = [];
  for (const account of local) {
    if (!isJsonObject(account) || typeof account['id'] !== 'string') return { kind: 'full' };
    const id = account['id'];
    if (localIds.includes(id)) return { kind: 'full' };
    localIds.push(id);
    const before = ackedById.get(id);
    if (!before) {
      accounts.push(account);
      continue;
    }
    const diff = shallowDiff(before, account);
    if (diff === null) return { kind: 'full' };
    if (Object.keys(diff).length > 0) accounts.push({ id, ...diff });
  }
  // Le serveur conserve l'ordre des comptes existants : un réordonnancement
  // local ne peut pas s'exprimer en correctif.
  const survivingAckedOrder = [...ackedById.keys()].filter((id) => localIds.includes(id));
  const survivingLocalOrder = localIds.filter((id) => ackedById.has(id));
  if (!sameJson(survivingAckedOrder, survivingLocalOrder)) return { kind: 'full' };

  const removedIds = [...ackedById.keys()].filter((id) => !localIds.includes(id));
  if (accounts.length === 0 && removedIds.length === 0) return { kind: 'none' };
  const patch: { accounts?: JsonObject[]; removedIds?: string[] } = {};
  if (accounts.length > 0) patch.accounts = accounts;
  if (removedIds.length > 0) patch.removedIds = removedIds;
  return { kind: 'patch', patch };
}
