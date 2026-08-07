import { defineConfig } from 'drizzle-kit';

// Config drizzle-kit (génération + exécution des migrations). DATABASE_URL
// est fourni par l'environnement (secret GitHub Actions en CI, variable
// locale sinon) — voir server/README.md pour la procédure.
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
