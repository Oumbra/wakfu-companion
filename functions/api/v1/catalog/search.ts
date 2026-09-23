import type { PagesFunction } from '@cloudflare/workers-types';
import { ilike, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { items, monsters } from '../../../../server/db/schema';
import { parseSearchQuery } from '../../../../server/catalog/params';
import { rejectUnknownCaller } from '../../_caller';
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
  // Réservé au site et à l'overlay (docs/analyse-cgu-2026-09-21.md, reco 4) — voir functions/api/_caller.ts.
  const rejected = await rejectUnknownCaller(context.request, context.env);
  if (rejected) return rejected;
  const url = new URL(context.request.url);
  const localeParam = url.searchParams.get('locale') ?? 'fr';
  const locale: Locale = LOCALES.includes(localeParam as Locale) ? (localeParam as Locale) : 'fr';
  const kind = url.searchParams.get('kind') === 'monster' ? 'monster' : 'item';

  // `q` : 2 à 64 caractères, métacaractères LIKE (`\ % _`) échappés — voir server/catalog/params.ts
  // (correctif du 2026-09-23 : `q=%` ou `q=_` balayait toute la table). Un `q` vide ou d'un seul
  // caractère répondait auparavant `[]` (200) : désormais 400, aucun client connu ne l'envoie.
  const search = parseSearchQuery(url.searchParams.get('q'));
  if (!search.ok) {
    return new Response(JSON.stringify({ error: search.error }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = createDb(context.env.DATABASE_URL);
  const pattern = search.pattern;

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
