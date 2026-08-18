import type { PagesFunction } from '@cloudflare/workers-types';
import { eq, inArray } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { itemRecipes, items } from '../../../../server/db/schema';
import type { Env } from '../../_types';

// GET /api/v1/items/{id} — détail complet d'un objet (id = ankamaId, PAS
// items.pk, voir schema.ts). En cas de collision d'id Ankama (2 cas connus
// sur le référentiel actuel), la première entrée insérée (pk le plus petit)
// fait foi.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = Number(context.params['id']);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'id invalide' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = createDb(context.env.DATABASE_URL);
  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.ankamaId, id))
    .orderBy(items.pk)
    .limit(1);

  if (!item) {
    return new Response(JSON.stringify({ error: 'objet introuvable' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const recipeRows = item.hasRecipe
    ? await db.select().from(itemRecipes).where(eq(itemRecipes.itemAnkamaId, id))
    : [];

  // Résolution des noms d'ingrédients en un seul aller-retour (plutôt qu'une requête par
  // ingrédient) — ajout par rapport à WakfuRecipeIngredient côté client (qui ne stocke que
  // {itemId, quantity}, la résolution du nom se faisant en mémoire via WAKFU_ITEMS_BY_ID) :
  // utile ici puisqu'un client REST n'a pas cet index en mémoire.
  const ingredientIds = recipeRows.map((row) => row.ingredientAnkamaId);
  const ingredientNames =
    ingredientIds.length > 0
      ? await db
          .select({ ankamaId: items.ankamaId, fr: items.fr })
          .from(items)
          .where(inArray(items.ankamaId, ingredientIds))
      : [];
  const nameByIngredientId = new Map(ingredientNames.map((row) => [row.ankamaId, row.fr]));

  return new Response(
    JSON.stringify({
      id: item.ankamaId,
      fr: item.fr,
      en: item.en,
      es: item.es,
      pt: item.pt,
      rarity: item.rarity,
      gfxId: item.gfxId,
      pictureUrl: item.pictureUrl,
      wakassetsAvailable: item.wakassetsAvailable,
      wakfuAvailable: item.wakfuAvailable,
      hasRecipe: item.hasRecipe,
      category: item.category,
      recipe: recipeRows.map((row) => ({
        itemId: row.ingredientAnkamaId,
        name: nameByIngredientId.get(row.ingredientAnkamaId) ?? null,
        quantity: row.quantity,
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
