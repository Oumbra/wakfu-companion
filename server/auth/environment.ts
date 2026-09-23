/**
 * Détection « déploiement public » vs « développement local » (audit de sécurité du 2026-09-23).
 *
 * Plusieurs replis n'ont de sens qu'en local : secrets HMAC dérivés de `DATABASE_URL`
 * (`server/auth/rate-limit.ts`, `server/http/app-token.ts`), jeton d'application émis sans
 * Turnstile ou avec les clés de test Cloudflare (`functions/api/v1/app/token.ts`). Sur un
 * déploiement public, ils deviennent des contournements silencieux — on les refuse (fail-closed).
 *
 * Est « public » tout environnement dont l'origine publique déclarée (`PUBLIC_BASE_URL`) OU l'URL
 * réellement servie est en `https:` sur un hôte autre que la boucle locale. Deux signaux plutôt
 * qu'un : `PUBLIC_BASE_URL` n'est poussé par les workflows que s'il est défini, son absence ne
 * doit pas suffire à rouvrir les replis. `wrangler pages dev` sert en `http://localhost:8788`
 * (derrière le proxy `http://localhost:4200` du serveur Angular) : jamais public.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isPublicHttpsUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return !LOOPBACK_HOSTS.has(host) && !host.endsWith('.localhost');
}

export interface DeploymentEnv {
  PUBLIC_BASE_URL?: string;
}

export function isPublicDeployment(env: DeploymentEnv, requestUrl?: string | null): boolean {
  return isPublicHttpsUrl(env.PUBLIC_BASE_URL) || isPublicHttpsUrl(requestUrl);
}

/** Levée quand un secret obligatoire en production manque — message explicite dans les journaux. */
export class MissingProductionSecretError extends Error {
  constructor(name: string) {
    super(
      `${name} est obligatoire sur un déploiement public (https hors localhost) : ` +
        `le repli sur DATABASE_URL n'est admis qu'en développement local.`,
    );
    this.name = 'MissingProductionSecretError';
  }
}
