import { defineConfig } from 'vitest/config';

/**
 * Tests du code serveur (`server/**`), séparés des tests Angular.
 *
 * Pourquoi une config à part : `npm test` passe par le builder Angular
 * `@angular/build:unit-test`, qui compile `src/` avec le compilateur Angular
 * et ne prend que `src/**\/*.spec.ts` (voir tsconfig.spec.json). Le code
 * serveur n'a rien à voir avec ce pipeline — il cible le runtime Workers et
 * ne doit surtout pas embarquer Angular. Deux commandes distinctes :
 * `npm test` (client) et `npm run test:server`.
 *
 * Environnement `node` : les primitives utilisées (WebCrypto, `btoa`,
 * `Request`/`Response`) sont natives à Node ≥ 18 comme au runtime Workers,
 * aucun polyfill nécessaire.
 */
export default defineConfig({
  test: {
    include: ['server/**/*.spec.ts'],
    environment: 'node',
  },
});
