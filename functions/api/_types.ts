// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — évite que ce fichier de
// types partagés ne devienne accidentellement une route /api/_types.

export interface Env {
  DATABASE_URL: string;
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
  /** Secret de pseudonymisation des adresses IP dans `auth_rate_limits` (voir
   * `server/auth/rate-limit.ts::clientIpKey`). OBLIGATOIRE sur un déploiement public (https hors
   * localhost, `server/auth/environment.ts`) : absent = erreur explicite. Le repli sur
   * `DATABASE_URL` comme matière à clé ne vaut plus qu'en développement local. */
  RATE_LIMIT_SALT?: string;
  /** Jeton d'application du site (`server/http/app-token.ts`) : secret HMAC. OBLIGATOIRE sur un
   * déploiement public (absent = 503 à l'émission, 403 à la vérification) ; repli sur
   * `DATABASE_URL` en développement local seulement, comme pour `RATE_LIMIT_SALT`. */
  APP_TOKEN_SECRET?: string;
  /** Cloudflare Turnstile (`server/http/turnstile.ts`, `functions/api/v1/app/token.ts`) : clé de
   * site (publique, variable Pages) et secret. Absents ensemble = jeton émis sans vérification
   * en développement local UNIQUEMENT ; sur un déploiement public, absents, clé de test `1x…` ou
   * l'un sans l'autre = 503 `turnstile_unavailable` (fail-closed, `turnstileMode`). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
