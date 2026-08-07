// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — évite que ce fichier de
// types partagés ne devienne accidentellement une route /api/_types.

export interface Env {
  DATABASE_URL: string;
  /** Jeton de service statique protégeant les endpoints prix d'écriture/export (lot 4, prompt
   * 4.2) — voir functions/api/_price-auth.ts. Distinct par environnement (preview/production),
   * comme DATABASE_URL/DATABASE_URL_PREVIEW — voir server/README.md. */
  PRICE_SERVICE_TOKEN: string;
}
