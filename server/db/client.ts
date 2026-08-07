import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Client DB pour le runtime Pages Functions (edge, pas de socket TCP
 * classique). Deux options existaient (voir prompt 2.1) : le driver
 * serverless Neon sur la connexion poolée, ou Cloudflare Hyperdrive avec un
 * driver SQL standard. Choix retenu : @neondatabase/serverless en mode HTTP
 * (`neon-http`, une requête = un fetch HTTP, pas de connexion persistante) —
 * fonctionne nativement dans le runtime Workers sans configuration
 * supplémentaire (pas de binding wrangler.toml, pas de compte Hyperdrive à
 * activer), au prix de l'absence de vraies transactions interactives
 * multi-requêtes. Suffisant pour ce lot (lectures + migrations simples) ; à
 * revoir avec `neon-serverless` (WebSocket, transactions) le jour où un
 * besoin transactionnel réel apparaît (ex. lot 8, idempotence combats/achats).
 *
 * `DATABASE_URL` doit être la chaîne de connexion POOLÉE (PgBouncer intégré
 * Neon, host `...-pooler...`), pas la connexion directe — voir server/README.md.
 */
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
