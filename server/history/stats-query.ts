import { HISTORY_MAX_FUTURE_SKEW_MS, HISTORY_MIN_DATE_MS, type ParseResult } from './parse';

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

/**
 * Bornes absolues de la plage (correctif du 2026-09-23, audit sécurité) — en plus de l'écart
 * maximal `MAX_RANGE_MS` :
 *
 * - `since` ≥ 2012-01-01 moins un jour (`HISTORY_MIN_DATE_MS`, parse.ts : aucun événement n'est
 *   accepté avant ; le jour de marge couvre un début d'année civile LOCALE en UTC+14) et
 *   ≤ maintenant + 1 jour (une période qui commence dans le futur ne contient rien) ;
 * - `until` ≤ maintenant + `MAX_RANGE_MS` — PAS maintenant + 1 jour : la période EN COURS se
 *   termine à la fin du jour/mois/année civil(e) (`periodBounds`, local-period.util.ts), donc
 *   jusqu'à un an dans le futur pour la vue Année.
 *
 * Tient aussi toute date loin des limites de `timestamptz` (une date JS extrême y ferait échouer
 * la requête en 500).
 */
const MIN_SINCE_MS = HISTORY_MIN_DATE_MS - 24 * 60 * 60 * 1000;

function parseInstant(raw: string | null, field: string): ParseResult<Date> {
  if (raw === null) return { ok: false, error: `${field} manquant` };
  if (raw.length > 64) return { ok: false, error: `${field} invalide` };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: `${field} invalide : ${raw}` };
  return { ok: true, value: parsed };
}

export function parseStatsQuery(
  params: URLSearchParams,
  now: Date = new Date(),
): ParseResult<StatsQuery> {
  const sinceResult = parseInstant(params.get('since'), 'since');
  if (!sinceResult.ok) return sinceResult;
  const since = sinceResult.value;
  if (since.getTime() < MIN_SINCE_MS) return { ok: false, error: 'since antérieur à 2012' };
  if (since.getTime() > now.getTime() + HISTORY_MAX_FUTURE_SKEW_MS) {
    return { ok: false, error: 'since dans le futur' };
  }

  const untilResult = parseInstant(params.get('until'), 'until');
  if (!untilResult.ok) return untilResult;
  const until = untilResult.value;
  if (until.getTime() > now.getTime() + MAX_RANGE_MS) {
    return { ok: false, error: 'until trop loin dans le futur' };
  }

  if (until.getTime() <= since.getTime()) {
    return { ok: false, error: 'until doit être postérieur à since' };
  }
  if (until.getTime() - since.getTime() > MAX_RANGE_MS) {
    return { ok: false, error: 'plage trop large (400 jours max)' };
  }

  return { ok: true, value: { since, until } };
}
