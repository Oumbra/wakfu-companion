/**
 * Contrôle d'hôte et en-têtes de sécurité des réponses de l'API (Pages Functions) — logique pure
 * du middleware `functions/api/_middleware.ts`, testée dans `host-guard.spec.ts`. Correctif du
 * 2026-09-23 (audit sécurité).
 *
 * ## Pourquoi un contrôle d'hôte
 *
 * Chaque déploiement Cloudflare Pages reste joignable indéfiniment à son URL immuable
 * `<hash>.<projet>.pages.dev` (hash hexadécimal de 8 caractères), et chaque branche déjà déployée
 * à son alias `<branche>.<projet>.pages.dev` — avec le code de l'API TEL QU'IL ÉTAIT à ce
 * moment-là, branché sur la même base (mêmes secrets d'environnement). Un correctif de sécurité
 * déployé ne protège donc rien tant que ces anciennes versions répondent. Ce contrôle fait qu'à
 * partir de maintenant, chaque déploiement refuse de servir l'API ailleurs que sur les hôtes
 * attendus : devenu ancien, il ne sera plus exploitable par son URL immuable.
 *
 * ⚠ Il ne protège PAS les déploiements ANTÉRIEURS à son introduction (ils exécutent leur propre
 * code, sans ce contrôle) : les supprimer dans le tableau de bord Cloudflare (Pages → projet →
 * Deployments → « Delete deployment »), voir server/README.md.
 *
 * ## Politique
 *
 * 1. Boucle locale (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`) : toujours autorisée — le
 *    développement (`wrangler pages dev`, `ng serve` + proxy) n'est jamais bloqué.
 * 2. `HOST_GUARD=off` : tout est autorisé (échappatoire d'urgence, sans redéploiement de code).
 * 3. `ALLOWED_HOSTS` défini (liste séparée par des virgules) : mode STRICT — seuls ces hôtes (plus
 *    celui de `PUBLIC_BASE_URL`) sont servis.
 * 4. Défaut (aucune variable) : seuls les sous-domaines `*.pages.dev` sont filtrés — le domaine du
 *    projet `<projet>.pages.dev` et l'alias de la preview `claude-dev.<projet>.pages.dev` (branche
 *    `claude/dev`, `.github/workflows/deploy-preview.yml`) passent, ainsi que l'hôte de
 *    `PUBLIC_BASE_URL` ; tout autre `<x>.<projet>.pages.dev` (déploiement immuable, alias d'une
 *    ancienne branche) est refusé. Les autres hôtes (domaine canonique `wakfu-companion.com`,
 *    adresse IP de réseau local en test) passent : un domaine personnalisé ne peut pointer ici que
 *    s'il a été rattaché au projet par le mainteneur.
 */

export interface HostGuardEnv {
  /** Liste d'hôtes autorisés (mode strict), séparés par des virgules — ex.
   * `wakfu-companion.com,www.wakfu-companion.com`. Absente : politique par défaut. */
  ALLOWED_HOSTS?: string;
  /** `off` désactive le contrôle. */
  HOST_GUARD?: string;
  PUBLIC_BASE_URL?: string;
}

/** Sous-domaines `<x>.<projet>.pages.dev` servis par la politique par défaut. */
export const DEFAULT_ALLOWED_PAGES_ALIASES: readonly string[] = ['claude-dev'];

export type HostDecision = 'allow' | 'reject';

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Décision pour `hostname` (tel que `new URL(request.url).hostname`, sans port). */
export function decideHost(rawHostname: string, env: HostGuardEnv): HostDecision {
  const hostname = rawHostname.toLowerCase().replace(/\.$/, '');
  if (isLoopback(hostname)) return 'allow';
  if (env.HOST_GUARD?.trim().toLowerCase() === 'off') return 'allow';

  const publicHost = hostOf(env.PUBLIC_BASE_URL);
  if (publicHost !== null && hostname === publicHost) return 'allow';

  const strictList = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (strictList.length > 0) return strictList.includes(hostname) ? 'allow' : 'reject';

  if (!hostname.endsWith('.pages.dev')) return 'allow';
  const labels = hostname.slice(0, -'.pages.dev'.length).split('.');
  // `<projet>.pages.dev` : le domaine du projet lui-même.
  if (labels.length === 1) return 'allow';
  // `<alias>.<projet>.pages.dev` : alias de branche autorisé, sinon (hash de déploiement immuable,
  // ancienne branche) refusé.
  if (labels.length === 2 && DEFAULT_ALLOWED_PAGES_ALIASES.includes(labels[0])) return 'allow';
  return 'reject';
}

/**
 * En-têtes posés sur toutes les réponses de l'API — sans écraser un en-tête déjà défini par la
 * route. `public/_headers` ne s'applique qu'aux fichiers statiques servis par Pages, pas aux
 * réponses des Functions : sans ce middleware, l'API répondait sans aucun d'eux.
 *
 * - CSP `default-src 'none'; frame-ancestors 'none'` : une réponse d'API (JSON, image, redirection
 *   OAuth 302) n'a jamais à charger quoi que ce soit ni à être encadrée — si un navigateur venait
 *   à l'interpréter comme un document (type mal déclaré), rien ne s'exécute.
 * - `Cross-Origin-Resource-Policy: same-origin` : les icônes relayées (`/api/v1/icons/*`) sont
 *   chargées en `<img>` par le site depuis LA MÊME origine — autorisé ; une page tierce ne peut
 *   plus les embarquer (complète `rejectUnknownCaller`). L'overlay n'est pas un navigateur : non
 *   concerné.
 * - HSTS 2 ans avec sous-domaines, `nosniff`, `DENY`, `Referrer-Policy` : alignés sur l'intention
 *   de `public/_headers`.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
};

/**
 * `response` avec les en-têtes de sécurité manquants. Toujours une NOUVELLE `Response` : celles
 * que renvoient `fetch`, `caches.default.match` ou `Response.redirect` ont des en-têtes
 * immuables (les modifier lèverait une exception).
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Réponse à un hôte refusé : 404 neutre (rien n'indique qu'un service existe derrière). */
export function rejectedHostResponse(): Response {
  return withSecurityHeaders(
    new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    }),
  );
}
