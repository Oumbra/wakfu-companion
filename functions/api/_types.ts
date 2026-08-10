// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — évite que ce fichier de
// types partagés ne devienne accidentellement une route /api/_types.

export interface Env {
  DATABASE_URL: string;
  /** Jeton de service statique protégeant les endpoints prix d'écriture/export (lot 4, prompt
   * 4.2) — voir functions/api/_price-auth.ts. Distinct par environnement (preview/production),
   * comme DATABASE_URL/DATABASE_URL_PREVIEW — voir server/README.md. */
  PRICE_SERVICE_TOKEN: string;
  /** Identifiants OAuth (lot 5, prompt 5.1) — voir server/README.md. Absents tant que les
   * secrets ne sont pas posés : les routes /auth/{provider}/* répondent alors 503
   * « fournisseur non configuré », le reste de l'application (mode invité) est intact. */
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Origine publique du site (ex. `https://wakfu-companion.pages.dev`), utilisée pour construire
   * l'URL de redirection OAuth — qui doit être déclarée à l'identique chez Discord/Google, donc
   * jamais déduite de l'URL de déploiement (variable par preview). Repli : origine de la requête. */
  PUBLIC_BASE_URL?: string;
}
