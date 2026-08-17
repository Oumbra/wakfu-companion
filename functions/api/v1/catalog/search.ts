import type { PagesFunction } from '@cloudflare/workers-types';
import { ilike, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { items, monsters } from '../../../../server/db/schema';
import type { Env } from '../../_types';

type Locale = 'fr' | 'en' | 'es' | 'pt';
const LOCALES: readonly Locale[] = ['fr', 'en', 'es', 'pt'];

const SEARCH_RESULT_LIMIT = 30;

// GET /api/v1/catalog/search?q=&locale=fr&kind=item|monster — recherche
// serveur par sous-chaîne (ILIKE, insensible à la casse), langue au choix.
// `kind` par défaut à "item" si absent/invalide plutôt que de chercher les
// deux tables à la fois : évite d'avoir à fusionner deux formes de
// résultats différentes (objets ont rareté/hasRecipe, monstres non) dans
// une même réponse.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const localeParam = url.searchParams.get('locale') ?? 'fr';
  const locale: Locale = LOCALES.includes(localeParam as Locale) ? (localeParam as Locale) : 'fr';
  const kind = url.searchParams.get('kind') === 'monster' ? 'monster' : 'item';

  if (q.length === 0) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = createDb(context.env.DATABASE_URL);
  const pattern = `%${q}%`;

  if (kind === 'monster') {
    const nameColumn = monsters[locale];
    const results = await db
      .select({ id: monsters.id, name: nameColumn, gfxId: monsters.gfxId })
      .from(monsters)
      .where(ilike(nameColumn, pattern))
      .orderBy(sql`length(${nameColumn})`, nameColumn)
      .limit(SEARCH_RESULT_LIMIT);
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const nameColumn = items[locale];
  const results = await db
    .select({
      id: items.ankamaId,
      name: nameColumn,
      gfxId: items.gfxId,
      rarity: items.rarity,
      hasRecipe: items.hasRecipe,
      category: items.category,
    })
    .from(items)
    .where(ilike(nameColumn, pattern))
    .orderBy(sql`length(${nameColumn})`, nameColumn)
    .limit(SEARCH_RESULT_LIMIT);
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
