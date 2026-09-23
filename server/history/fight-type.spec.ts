import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { familyFightTypeSelectSql, familyFightTypeUpdateSql } from './fight-type';

const dialect = new PgDialect();

/** Texte SQL de la sous-requête `DISTINCT ON` (entre `distinct on` et `order by`). */
function distinctOnSubquery(text: string): string {
  const start = text.indexOf('select distinct on');
  const end = text.indexOf('order by', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('fight-type — sous-requête famille représentative', () => {
  const scope = sql`f.id in (${sql.join([sql`${11}`, sql`${12}`], sql`, `)})`;

  for (const [label, build] of [
    ['UPDATE', familyFightTypeUpdateSql],
    ['SELECT', familyFightTypeSelectSql],
  ] as const) {
    it(`${label} : le scope est appliqué DANS la sous-requête, pas seulement autour`, () => {
      const query = dialect.sqlToQuery(build(scope));
      const subquery = distinctOnSubquery(query.sql);
      // Le filtre du lot est présent dans la sous-requête, sur la table `fights` jointe sous `f`.
      expect(subquery).toContain('from fights f');
      expect(subquery).toMatch(/f\.id in \(\$\d+, \$\d+\)/);
      expect(subquery).toContain('f.dungeon_id is null');
      // Les ids du lot sont liés en paramètres (jamais concaténés dans le texte SQL).
      expect(query.params).toEqual(expect.arrayContaining([11, 12]));
    });
  }

  it('scope par compte : le filtre utilisateur est lié en paramètre dans la sous-requête', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const query = dialect.sqlToQuery(familyFightTypeUpdateSql(sql`f.user_id = ${userId}`));
    expect(distinctOnSubquery(query.sql)).toMatch(/f\.user_id = \$\d+/);
    expect(query.params).toContain(userId);
  });
});
