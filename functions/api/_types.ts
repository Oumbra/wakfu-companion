// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — évite que ce fichier de
// types partagés ne devienne accidentellement une route /api/_types.

export interface Env {
  DATABASE_URL: string;
}
