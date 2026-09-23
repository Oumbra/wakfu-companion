import { isSyncedSettingKey, type SyncedSettingKey } from './keys';
import { isMergeableSettingKey, parseSettingPatch, type SettingPatch } from './patch';

/**
 * Logique pure de la synchronisation par clé (lot 6, prompt 6.1) — validation
 * du corps et arbitrage « dernier écrivain gagne ».
 *
 * Isolée de la route Cloudflare pour la même raison que `server/auth/flow.ts`
 * l'est de `functions/api/v1/auth/*` : c'est ici que vivent les décisions, et
 * elles doivent être testables sans base ni runtime Workers
 * (`server/settings/merge.spec.ts`).
 */

/**
 * Une écriture de configuration accompagnée de l'horodatage de sa dernière
 * modification côté client. Deux formes :
 *
 * - `replace` : la valeur entière de la clé (`{ key, value, updatedAt }`), le
 *   cas historique, valable pour toutes les clés.
 * - `merge` : un correctif partiel (`{ key, patch, updatedAt }`), fusionné côté
 *   serveur dans la valeur en compte — réservé aux clés de
 *   `MERGEABLE_SETTING_KEYS` (voir `patch.ts` pour la sémantique par clé).
 */
export type SettingWrite = {
  key: SyncedSettingKey;
  /** Date de modification déclarée par le client (ISO 8601). */
  updatedAt: Date;
} & ({ mode: 'replace'; value: unknown } | { mode: 'merge'; patch: SettingPatch });

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Horodatage futur toléré avant rejet. Une horloge client légèrement en avance
 * est banale ; une date très future serait en revanche un moyen simple de
 * rendre une clé impossible à écraser depuis un autre appareil (le « dernier
 * écrivain » ne pourrait plus jamais gagner). On borne donc, sans exiger une
 * horloge parfaite.
 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Profondeur d'imbrication maximale d'une valeur de configuration (correctif du 2026-09-23, audit
 * sécurité). Les valeurs réelles ne dépassent pas 4 ou 5 niveaux (profil → `soundItems` → objet ;
 * roster → compte → `characters` → personnage). Une valeur très profonde (`[[[[...]]]]`, quelques
 * octets par niveau, donc des dizaines de milliers de niveaux dans 512 Ko) coûterait en revanche
 * cher à chaque sérialisation, ici comme chez chaque client qui la relit — voire ferait déborder
 * une pile récursive.
 */
export const MAX_SETTING_DEPTH = 32;

/**
 * Vrai si `value` imbrique plus de `maxDepth` niveaux d'objets/tableaux. Parcours ITÉRATIF (pile
 * explicite) : une vérification récursive déborderait sur exactement l'entrée qu'elle doit refuser.
 */
export function jsonDepthExceeds(value: unknown, maxDepth: number = MAX_SETTING_DEPTH): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth + 1 > maxDepth) return true;
    const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
    for (const child of children) {
      if (typeof child === 'object' && child !== null)
        stack.push({ node: child, depth: depth + 1 });
    }
  }
  return false;
}

function parseTimestamp(raw: unknown, now: Date): ParseResult<Date> {
  if (typeof raw !== 'string') return { ok: false, error: 'updatedAt manquant' };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: `updatedAt invalide : ${raw}` };
  if (parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: `updatedAt trop dans le futur : ${raw}` };
  }
  return { ok: true, value: parsed };
}

/**
 * Corps attendu par `PATCH /api/v1/settings` :
 * `{ entries: [{ key, value, updatedAt }] }` — ou, pour une clé fusionnable,
 * `{ key, patch, updatedAt }` (exactement l'un des deux, jamais les deux).
 *
 * Un lot d'une seule entrée est l'écriture « par clé » — inutile d'exposer
 * une route `/settings/{key}` séparée pour ça (voir server/README.md, section
 * lot 6 : un fichier `settings.ts` et un dossier `settings/` coexistant dans
 * `functions/` est précisément le genre d'ambiguïté de routage qui a déjà
 * coûté un bug sur `/catalog/index`).
 */
export function parsePatchBody(body: unknown, now: Date): ParseResult<SettingWrite[]> {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return { ok: false, error: 'champ "entries" manquant ou invalide' };
  if (entries.length === 0) return { ok: true, value: [] };

  const writes: SettingWrite[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'entrée non objet' };
    const entry = raw as { key?: unknown; value?: unknown; patch?: unknown; updatedAt?: unknown };
    if (typeof entry.key !== 'string' || !isSyncedSettingKey(entry.key)) {
      return { ok: false, error: `clé inconnue : ${String(entry.key)}` };
    }
    if (seen.has(entry.key)) return { ok: false, error: `clé en double : ${entry.key}` };
    seen.add(entry.key);
    const updatedAt = parseTimestamp(entry.updatedAt, now);
    if (!updatedAt.ok) return updatedAt;
    if (jsonDepthExceeds(entry.patch) || jsonDepthExceeds(entry.value)) {
      return { ok: false, error: `valeur trop imbriquée : ${entry.key}` };
    }
    if (entry.patch !== undefined) {
      if (entry.value !== undefined) {
        return { ok: false, error: `"value" et "patch" sont exclusifs : ${entry.key}` };
      }
      if (!isMergeableSettingKey(entry.key)) {
        return { ok: false, error: `clé non fusionnable : ${entry.key}` };
      }
      const patch = parseSettingPatch(entry.key, entry.patch);
      if (!patch.ok) return patch;
      writes.push({
        key: entry.key,
        mode: 'merge',
        patch: patch.value,
        updatedAt: updatedAt.value,
      });
      continue;
    }
    // `undefined` n'existe pas en JSON ; une valeur absente est donc une
    // erreur de forme, jamais une demande de suppression (le client envoie une
    // liste vide, un objet vide... mais toujours une valeur).
    if (entry.value === undefined) return { ok: false, error: `valeur manquante : ${entry.key}` };
    writes.push({
      key: entry.key,
      mode: 'replace',
      value: entry.value,
      updatedAt: updatedAt.value,
    });
  }
  return { ok: true, value: writes };
}

/** Clé refusée parce que le compte porte déjà une version plus récente. */
export interface RejectedWrite {
  key: SyncedSettingKey;
  /** Horodatage de la version conservée — le client s'en sert pour se resynchroniser. */
  remoteUpdatedAt: string;
}

export interface ResolvedWrites {
  accepted: SettingWrite[];
  rejected: RejectedWrite[];
}

/**
 * Arbitrage « dernier écrivain gagne », **par clé** (prompt 6.1 point 4) :
 * une écriture n'est appliquée que si elle est strictement plus récente que
 * la version déjà en compte. Suffisant pour un usage mono-utilisateur
 * multi-appareils, où deux appareils ne modifient jamais la même clé à la
 * même milliseconde.
 *
 * L'égalité stricte compte comme un rejet : même horodatage = même version
 * déjà connue du serveur, rien à réécrire.
 */
export function resolveWrites(
  writes: readonly SettingWrite[],
  remoteUpdatedAt: ReadonlyMap<string, Date>,
): ResolvedWrites {
  const accepted: SettingWrite[] = [];
  const rejected: RejectedWrite[] = [];
  for (const write of writes) {
    const existing = remoteUpdatedAt.get(write.key);
    if (existing && existing.getTime() >= write.updatedAt.getTime()) {
      rejected.push({ key: write.key, remoteUpdatedAt: existing.toISOString() });
      continue;
    }
    accepted.push(write);
  }
  return { accepted, rejected };
}

/**
 * Corps attendu par `PUT /api/v1/settings` : `{ data: { <clé>: <valeur>, ... } }` — remplacement
 * complet (voir la route). Liste blanche fermée (`keys.ts`) et profondeur bornée
 * (`MAX_SETTING_DEPTH`) ; une valeur `undefined` n'existe pas en JSON, les entrées sont renvoyées
 * telles quelles.
 */
export function parsePutBody(body: unknown): ParseResult<[SyncedSettingKey, unknown][]> {
  const data = (body as { data?: unknown } | null)?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'champ "data" manquant ou invalide' };
  }
  const entries: [SyncedSettingKey, unknown][] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined) continue;
    // Refuser franchement une clé inconnue plutôt que de laisser `user_settings` accumuler
    // n'importe quel nom envoyé par un client modifié.
    if (!isSyncedSettingKey(key)) return { ok: false, error: `clé inconnue : ${key}` };
    if (jsonDepthExceeds(value)) return { ok: false, error: `valeur trop imbriquée : ${key}` };
    entries.push([key, value]);
  }
  return { ok: true, value: entries };
}
