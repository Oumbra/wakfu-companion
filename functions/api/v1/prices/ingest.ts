import type { PagesFunction } from '@cloudflare/workers-types';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { gameServers, itemPricesDaily, items, priceScanRuns } from '../../../../server/db/schema';
import { checkPriceServiceToken } from '../../_price-auth';
import type { Env } from '../../_types';

interface IngestBody {
  gameServer: string;
  capturedOn: string;
  items: { itemId: number; price: number; priceMax?: number }[];
  unresolved: string[];
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valide la forme du corps envoyé par les skills de scan (vidéo, prompt 4.1, ou mémoire HDV) :
 * {gameServer, capturedOn, items: [{itemId, price, priceMax?}], unresolved: [...]}.
 * `priceMax` est optionnel en entrée (le skill vidéo ne voit qu'un seul prix par jour et ne
 * l'envoie pas) — retombe sur `price` à l'insertion, voir plus bas. Retourne un message
 * d'erreur (400) ou les données typées. */
export function parseIngestBody(body: unknown): { error: string } | { data: IngestBody } {
  if (typeof body !== 'object' || body === null) return { error: 'corps JSON invalide' };
  const b = body as Record<string, unknown>;

  if (typeof b['gameServer'] !== 'string' || b['gameServer'].length === 0) {
    return { error: 'gameServer manquant ou invalide' };
  }
  if (typeof b['capturedOn'] !== 'string' || !DATE_RE.test(b['capturedOn'])) {
    return { error: 'capturedOn manquant ou invalide (attendu AAAA-MM-JJ)' };
  }
  if (!Array.isArray(b['items'])) return { error: 'items manquant ou invalide' };
  for (const entry of b['items']) {
    if (typeof entry !== 'object' || entry === null) {
      return { error: 'items[] doit contenir des entrées {itemId: number, price: number}' };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['itemId'] !== 'number' || typeof e['price'] !== 'number') {
      return { error: 'items[] doit contenir des entrées {itemId: number, price: number}' };
    }
    if (e['priceMax'] !== undefined && typeof e['priceMax'] !== 'number') {
      return { error: 'items[].priceMax doit être un nombre si présent' };
    }
  }
  const unresolved = b['unresolved'];
  if (unresolved !== undefined && !Array.isArray(unresolved)) {
    return { error: 'unresolved doit être un tableau si présent' };
  }

  return {
    data: {
      gameServer: b['gameServer'],
      capturedOn: b['capturedOn'],
      items: b['items'] as { itemId: number; price: number; priceMax?: number }[],
      unresolved: (unresolved as string[] | undefined) ?? [],
    },
  };
}

const BATCH_SIZE = 500;

// POST /api/v1/prices/ingest — reçoit le lot quotidien produit par le skill de scan vidéo de
// l'hôtel de ventes (prompt 4.1), protégé par jeton de service statique (voir _price-auth.ts) —
// PAS une session utilisateur, sans rapport avec l'authentification du lot 5. Upsert sur
// (item_id, game_server, captured_on) : une ré-ingestion du même jour écrase plutôt que duplique
// (pas de mécanique de clé déterministe façon lot 8, ce pipeline n'a pas le problème
// isInitialLoad — chaque appel du skill correspond à un vrai jour scanné, jamais un rejeu partiel
// d'un fichier local). Un itemId absent du catalogue au moment de l'ingestion est REJETÉ
// explicitement (jamais silencieusement ignoré, voir prompt 4.2 point 5) : exclu de l'upsert,
// compté et listé dans la réponse ET dans price_scan_runs.notes pour trace ultérieure.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authError = checkPriceServiceToken(context.request, context.env);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError('corps JSON invalide', 400);
  }

  const parsed = parseIngestBody(rawBody);
  if ('error' in parsed) return jsonError(parsed.error, 400);
  const { gameServer, capturedOn, items: priceItems, unresolved } = parsed.data;

  const db = createDb(context.env.DATABASE_URL);

  const [server] = await db
    .select({ code: gameServers.code })
    .from(gameServers)
    .where(eq(gameServers.code, gameServer))
    .limit(1);
  if (!server) return jsonError(`serveur de jeu inconnu : "${gameServer}"`, 400);

  const distinctItemIds = [...new Set(priceItems.map((entry) => entry.itemId))];
  const knownRows =
    distinctItemIds.length > 0
      ? await db
          .select({ ankamaId: items.ankamaId })
          .from(items)
          .where(inArray(items.ankamaId, distinctItemIds))
      : [];
  const knownItemIds = new Set(knownRows.map((row) => row.ankamaId));

  const accepted = priceItems.filter((entry) => knownItemIds.has(entry.itemId));
  const rejectedItemIds = [
    ...new Set(priceItems.filter((e) => !knownItemIds.has(e.itemId)).map((e) => e.itemId)),
  ];

  for (let i = 0; i < accepted.length; i += BATCH_SIZE) {
    const batch = accepted.slice(i, i + BATCH_SIZE).map((entry) => ({
      itemId: entry.itemId,
      gameServer,
      capturedOn,
      price: entry.price,
      // repli sur price quand la source ne fournit pas de vrai maximum (skill vidéo,
      // prompt 4.1) — voir commentaire de itemPricesDaily dans schema.ts
      priceMax: entry.priceMax ?? entry.price,
    }));
    await db
      .insert(itemPricesDaily)
      .values(batch)
      .onConflictDoUpdate({
        target: [itemPricesDaily.itemId, itemPricesDaily.gameServer, itemPricesDaily.capturedOn],
        set: { price: sql`excluded.price`, priceMax: sql`excluded.price_max` },
      });
  }

  const notesParts: string[] = [];
  if (rejectedItemIds.length > 0) {
    notesParts.push(
      `${rejectedItemIds.length} item(s) rejeté(s) (id catalogue introuvable) : ${rejectedItemIds.join(', ')}`,
    );
  }
  if (unresolved.length > 0) {
    notesParts.push(
      `${unresolved.length} nom(s) non résolu(s) par le skill vidéo : ${unresolved.join(', ')}`,
    );
  }

  await db.insert(priceScanRuns).values({
    gameServer,
    capturedOn,
    itemsCaptured: accepted.length,
    itemsUnresolved: unresolved.length,
    notes: notesParts.length > 0 ? notesParts.join(' | ') : null,
  });

  return new Response(
    JSON.stringify({
      accepted: accepted.length,
      rejected: rejectedItemIds,
      unresolvedCount: unresolved.length,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
