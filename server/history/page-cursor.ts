import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { PageQuery } from './parse';

/**
 * Condition « strictement avant le curseur » pour un tri `(horodatage desc, id desc)`. Avec un
 * curseur composite, les lignes de même horodatage que la dernière ligne vue restent atteignables
 * par leur id ; avec un curseur à l'ancien format (date seule), comportement historique.
 */
export function beforeCursor(
  timestamp: PgColumn,
  id: PgColumn,
  query: Pick<PageQuery, 'before' | 'beforeId'>,
): SQL | undefined {
  if (!query.before) return undefined;
  if (query.beforeId === null) return lt(timestamp, query.before);
  return or(lt(timestamp, query.before), and(eq(timestamp, query.before), lt(id, query.beforeId)));
}
