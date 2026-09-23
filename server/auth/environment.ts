/**
 * Détection « déploiement public » vs « développement local » (audit de sécurité du 2026-09-23).
 *
 * Plusieurs replis n'ont de sens qu'en local : secrets HMAC dérivés de `DATABASE_URL`
 * (`server/auth/rate-limit.ts`, `server/http/app-token.ts`), jeton d'application émis sans
 * Turnstile ou avec les clés de test Cloudflare (`functions/api/v1/app/token.ts`). Sur un
 * déploiement public, ils deviennent des contournements silencieux — on les refuse (fail-closed).
 *
 * Est « public » tout environnement dont l'origine publique déclarée (`PUBLIC_BASE_URL`) OU l'URL
 * réellement servie désigne un hôte **hors de la boucle locale** (`localhost`, `*.localhost`,
 * `127.0.0.0/8`, `::1`), **quel que soit le schéma** (audit #10 du 2026-09-23 : jusque-là, seul
 * `https:` comptait — un déploiement servi en `http:` derrière un mandataire, ou un
 * `PUBLIC_BASE_URL` mal saisi en `http://`, rouvrait silencieusement les replis de
 * développement). Deux signaux plutôt qu'un : `PUBLIC_BASE_URL` n'est poussé par les workflows que
 * s'il est défini, son absence ne doit pas suffire à rouvrir les replis. `wrangler pages dev` sert
 * en `http://localhost:8788` (derrière le proxy `http://localhost:4200` du serveur Angular) :
 * jamais public. Conséquence assumée : un poste de développement joint par son IP de réseau local
 * (adresse privée de type `http://<IP du LAN>`) est traité comme public — il lui faut alors les vrais secrets.
 */

/** Boucle locale — même définition que le contrôle d'hôte (`server/http/host-guard.ts`). */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === '::1' ||
    host === '[::1]'
  );
}

function isPublicUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // Une URL sans hôte (`file:`, `data:`...) ne désigne aucun déploiement.
  if (!url.hostname) return false;
  return !isLoopbackHostname(url.hostname);
}

export interface DeploymentEnv {
  PUBLIC_BASE_URL?: string;
}

export function isPublicDeployment(env: DeploymentEnv, requestUrl?: string | null): boolean {
  return isPublicUrl(env.PUBLIC_BASE_URL) || isPublicUrl(requestUrl);
}

/** Levée quand un secret obligatoire en production manque — message explicite dans les journaux. */
export class MissingProductionSecretError extends Error {
  constructor(name: string) {
    super(
      `${name} est obligatoire sur un déploiement public (hôte hors boucle locale) : ` +
        `le repli sur DATABASE_URL n'est admis qu'en développement local.`,
    );
    this.name = 'MissingProductionSecretError';
  }
}
