import type { ParseResult } from './parse';

/**
 * Validation pure de la requête d'agrégation par période (`GET /api/v1/history/stats`) — même
 * esprit que `parsePageQuery` (parse.ts) : les bornes viennent du CLIENT (`since`/`until`, des
 * instants ISO explicites), jamais un paramètre `granularity` interprété côté serveur. Le calcul
 * "premier jour du mois civil local", etc. dépend du fuseau horaire de l'utilisateur — seul le
 * navigateur le connaît (voir `core/utils/local-period.util.ts`) ; le serveur ne fait qu'agréger
 * entre deux instants déjà résolus.
 */

/** Écart maximal accepté entre `since` et `until` — ~400 jours couvre le pire cas prévu côté
 * client (une année civile complète, jamais glissante) avec une marge confortable, tout en
 * empêchant une requête sur une plage arbitrairement large (le calcul, bien qu'indexé, reste un
 * agrégat sur plusieurs tables à chaque appel). */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * Sentinelle identifiant, parmi les lignes de `purchases`, une récupération de kamas à l'Hôtel de
 * vente (un GAIN) plutôt qu'un vrai achat d'objet (une DÉPENSE) — les deux partagent la même
 * table et le même signe de `total_cost` (toujours positif côté client), seul `item_name` les
 * distingue. Miroir de `HDV_KAMAS_SALE_ITEM`
 * (`src/app/core/services/stats-store.service.ts`) : dupliqué plutôt qu'importé, `server/` ne
 * dépend jamais de `src/` (même principe que `server/settings/keys.ts`, miroir documenté de
 * `user-data.keys.ts`) — à garder synchronisé si jamais renommé côté client.
 */
export const HDV_KAMAS_SALE_ITEM = '__hdv_kamas_sale__';

export interface StatsQuery {
  since: Date;
  until: Date;
}

export function parseStatsQuery(params: URLSearchParams): ParseResult<StatsQuery> {
  const rawSince = params.get('since');
  if (rawSince === null) return { ok: false, error: 'since manquant' };
  const since = new Date(rawSince);
  if (Number.isNaN(since.getTime())) return { ok: false, error: `since invalide : ${rawSince}` };

  const rawUntil = params.get('until');
  if (rawUntil === null) return { ok: false, error: 'until manquant' };
  const until = new Date(rawUntil);
  if (Number.isNaN(until.getTime())) return { ok: false, error: `until invalide : ${rawUntil}` };

  if (until.getTime() <= since.getTime()) {
    return { ok: false, error: 'until doit être postérieur à since' };
  }
  if (until.getTime() - since.getTime() > MAX_RANGE_MS) {
    return { ok: false, error: 'plage trop large (400 jours max)' };
  }

  return { ok: true, value: { since, until } };
}
