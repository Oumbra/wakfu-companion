import type { SyncedSettingKey } from './keys';

/**
 * Écriture **partielle** d'une clé de configuration (fusion côté serveur).
 *
 * Motivation (analyse RGPD, constat C9) : l'overlay de bureau ne connaît que
 * trois champs du profil (réglages d'alerte) mais devait renvoyer le profil
 * ENTIER — pseudo, avatar, mode d'affichage — à chaque changement d'alerte,
 * parce que `PATCH /api/v1/settings` remplace la valeur de la clé. Même chose
 * pour le roster : ajouter un personnage à un compte obligeait à réémettre
 * tous les comptes, champs inconnus compris. Minimisation des données : un
 * client n'a plus à transmettre ce qu'il ne modifie pas.
 *
 * Deux clés seulement acceptent une fusion, chacune avec sa propre sémantique
 * (voir `applySettingPatch`) :
 *
 * - `profile` (objet) : fusion superficielle, champ par champ. Un champ absent
 *   du correctif est conservé tel quel ; un champ présent est remplacé en bloc
 *   (pas de fusion récursive : `soundItems` est une liste, remplacée entière).
 * - `roster` (tableau de comptes identifiés par `id`) : chaque compte du
 *   correctif est fusionné superficiellement dans le compte de même `id`
 *   (créé s'il n'existe pas, en fin de liste) ; `removedIds` retire des
 *   comptes. Les comptes non cités et les champs non cités restent intacts.
 *
 * Un correctif ne sait **pas supprimer** un champ (JSON n'a pas d'`undefined`,
 * et `null` est une valeur légitime pour `gameServer`/`avatarIndex`) : un
 * client qui doit retirer un champ envoie la valeur entière, comme avant.
 *
 * Les autres clés (listes plates, booléens, chaînes) n'ont pas de sous-clé
 * qui ait un sens : la fusion y est refusée en 400 plutôt que d'improviser.
 *
 * Pur, sans base : testé dans `patch.spec.ts`.
 */

/** Clés dont la valeur admet une écriture partielle. */
export const MERGEABLE_SETTING_KEYS = [
  'profile',
  'roster',
] as const satisfies readonly SyncedSettingKey[];

export type MergeableSettingKey = (typeof MERGEABLE_SETTING_KEYS)[number];

export function isMergeableSettingKey(key: string): key is MergeableSettingKey {
  return (MERGEABLE_SETTING_KEYS as readonly string[]).includes(key);
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Nombre maximal de comptes dans un correctif roster (`accounts` comme `removedIds`). Le site
 * n'impose aucune limite à la création de comptes (`CharacterRosterService.addAccount`), mais un
 * roster réel en compte une poignée (un par compte Ankama joué) : 50 laisse une marge très large
 * tout en bornant le travail d'une fusion (voir `applySettingPatch`).
 */
export const MAX_ROSTER_PATCH_ACCOUNTS = 50;

/**
 * Clés jamais recopiées d'un correctif (correctif du 2026-09-23, audit sécurité) : `JSON.parse`
 * crée `__proto__` comme propriété PROPRE, que la fusion par décomposition (`{ ...a, ...b }`)
 * recopie telle quelle dans la valeur stockée — relue plus tard par un client qui l'assignerait
 * champ par champ (`obj[key] = value`), elle remplacerait le prototype de l'objet. Filtrées
 * silencieusement : aucun client légitime ne les produit.
 */
const FORBIDDEN_PATCH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function withoutForbiddenKeys(source: JsonObject): JsonObject {
  const clean: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) continue;
    // `defineProperty` plutôt qu'une affectation : robuste même pour une clé exotique.
    Object.defineProperty(clean, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return clean;
}

/** Correctif du roster : comptes à fusionner (par `id`) et/ou comptes à retirer. */
export interface RosterPatch {
  accounts: readonly (JsonObject & { id: string })[];
  removedIds: readonly string[];
}

export type SettingPatch =
  { key: 'profile'; fields: JsonObject } | { key: 'roster'; roster: RosterPatch };

export type PatchParseResult = { ok: true; value: SettingPatch } | { ok: false; error: string };

/**
 * Valide la forme d'un correctif selon sa clé. Volontairement strict sur la
 * structure (objet pour le profil, `{ accounts?, removedIds? }` pour le
 * roster, chaque compte avec un `id` chaîne non vide) et volontairement laxiste
 * sur le contenu des champs : comme pour une valeur entière, le serveur ne
 * connaît pas le schéma applicatif (`jsonb` opaque), c'est le client qui en
 * répond.
 */
export function parseSettingPatch(key: MergeableSettingKey, raw: unknown): PatchParseResult {
  if (!isJsonObject(raw)) return { ok: false, error: `correctif non objet : ${key}` };

  if (key === 'profile') {
    const fields = withoutForbiddenKeys(raw);
    if (Object.keys(fields).length === 0) return { ok: false, error: 'correctif vide : profile' };
    return { ok: true, value: { key, fields } };
  }

  const {
    accounts = [],
    removedIds = [],
    ...rest
  } = raw as {
    accounts?: unknown;
    removedIds?: unknown;
  };
  if (Object.keys(rest).length > 0) {
    return {
      ok: false,
      error: `champ inattendu dans le correctif roster : ${Object.keys(rest)[0]}`,
    };
  }
  if (!Array.isArray(accounts) || !Array.isArray(removedIds)) {
    return {
      ok: false,
      error: 'correctif roster : "accounts" et "removedIds" doivent être des tableaux',
    };
  }
  if (accounts.length === 0 && removedIds.length === 0) {
    return { ok: false, error: 'correctif vide : roster' };
  }
  if (
    accounts.length > MAX_ROSTER_PATCH_ACCOUNTS ||
    removedIds.length > MAX_ROSTER_PATCH_ACCOUNTS
  ) {
    return {
      ok: false,
      error: `correctif roster : trop de comptes (max ${MAX_ROSTER_PATCH_ACCOUNTS})`,
    };
  }
  const seen = new Set<string>();
  const cleanAccounts: (JsonObject & { id: string })[] = [];
  for (const account of accounts) {
    if (!isJsonObject(account) || typeof account['id'] !== 'string' || account['id'] === '') {
      return { ok: false, error: 'correctif roster : compte sans "id"' };
    }
    if (seen.has(account['id'])) {
      return { ok: false, error: `correctif roster : compte en double : ${account['id']}` };
    }
    seen.add(account['id']);
    cleanAccounts.push(withoutForbiddenKeys(account) as JsonObject & { id: string });
  }
  if (!removedIds.every((id) => typeof id === 'string' && id !== '')) {
    return { ok: false, error: 'correctif roster : "removedIds" doit contenir des identifiants' };
  }
  return {
    ok: true,
    value: {
      key,
      roster: {
        accounts: cleanAccounts,
        removedIds: removedIds as string[],
      },
    },
  };
}

/**
 * Applique un correctif à la valeur actuellement en compte et renvoie la
 * nouvelle valeur entière — c'est elle qui est écrite en base, la table ne
 * connaît que des valeurs entières.
 *
 * Une valeur en compte d'un type inattendu (clé absente, ou reliquat d'un
 * ancien format) est traitée comme vide plutôt que de faire échouer
 * l'écriture : un compte qui n'a encore jamais reçu de profil obtient un
 * profil réduit aux champs du correctif, exactement ce que l'overlay
 * construisait déjà de son côté.
 */
export function applySettingPatch(patch: SettingPatch, stored: unknown): unknown {
  if (patch.key === 'profile') {
    const base = isJsonObject(stored) ? stored : {};
    return { ...base, ...patch.fields };
  }

  const removed = new Set(patch.roster.removedIds);
  // Index par `id` (correctif du 2026-09-23) : la recherche linéaire dans le correctif pour chaque
  // compte stocké rendait la fusion O(n·m).
  const updatesById = new Map(patch.roster.accounts.map((entry) => [entry.id, entry]));
  const current = (Array.isArray(stored) ? stored : []).filter((account): account is JsonObject =>
    isJsonObject(account),
  );
  const merged: JsonObject[] = [];
  const consumed = new Set<string>();
  for (const account of current) {
    const id = account['id'];
    if (typeof id === 'string' && removed.has(id)) continue;
    const update = typeof id === 'string' ? updatesById.get(id) : undefined;
    if (update) consumed.add(update.id);
    merged.push(update ? { ...account, ...update } : account);
  }
  // Comptes nouveaux : ajoutés dans l'ordre du correctif, après les existants
  // — l'ordre des comptes est celui d'affichage des onglets côté site, un
  // nouveau compte y apparaît en dernier de toute façon.
  for (const entry of patch.roster.accounts) {
    if (!consumed.has(entry.id) && !removed.has(entry.id)) merged.push({ ...entry });
  }
  return merged;
}
