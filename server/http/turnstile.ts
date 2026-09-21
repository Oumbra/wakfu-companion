/**
 * Vérification serveur d'un jeton Cloudflare Turnstile (`siteverify`) — la partie pure, avec
 * `fetch` injectable pour les tests (`turnstile.spec.ts`). Appelée par `POST /api/v1/app/token`
 * (`functions/api/v1/app/token.ts`) avant d'émettre le jeton d'application (voir
 * `server/http/app-token.ts`, doc de tête, pour le pourquoi de l'ensemble).
 *
 * Contrat, repris tel quel de la documentation Turnstile : le navigateur obtient un jeton du
 * widget, l'envoie à NOTRE serveur, qui seul appelle `siteverify` avec le secret ; on exige
 * `success === true`, l'`action` attendue (`app-token`, posée par le widget côté client) et un
 * `hostname` de la liste attendue. Tout échec — réseau, réponse non JSON, `success: false` — est
 * un refus (fail closed) : la route répond 403, jamais un jeton « au bénéfice du doute ».
 *
 * Clés de test Cloudflare (`1x…`, `2x…`, `3x…`, documentées comme « toujours réussit / toujours
 * échoue ») : leur réponse porte un `hostname` et une `action` de démonstration, pas les nôtres —
 * les deux contrôles sont donc relâchés pour ces seuls secrets, ce qui permet de vérifier tout le
 * circuit en local sans widget réel. Jamais en production : les workflows y poussent le vrai
 * secret (`TURNSTILE_SECRET_KEY`).
 */

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** `data-action` posé par le widget côté client (`src/app/core/api/app-token.service.ts`) et
 * exigé ici — un jeton obtenu pour un autre usage ne vaut pas pour celui-ci. */
export const TURNSTILE_ACTION = 'app-token';
/** Borne de forme sur le jeton reçu du navigateur (Turnstile documente 2048 caractères max). */
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 10_000;

/** Secrets de test documentés par Cloudflare : `1x`/`2x`/`3x`, 31 zéros, `AA` (35 caractères). */
const TEST_SECRET_PATTERN = /^[123]x0{31}AA$/;

export function isTurnstileTestSecret(secret: string): boolean {
  return TEST_SECRET_PATTERN.test(secret);
}

export type TurnstileFailure =
  'missing_token' | 'network' | 'rejected' | 'action_mismatch' | 'hostname_mismatch';

export type TurnstileVerification =
  | { ok: true; hostname: string | null }
  | { ok: false; reason: TurnstileFailure; errorCodes: string[] };

export async function verifyTurnstileToken(params: {
  secret: string;
  token: unknown;
  /** IP de l'appelant telle que vue par Cloudflare (`cf-connecting-ip`), transmise à `siteverify`. */
  remoteIp: string | null;
  /** Noms d'hôte (sans port) où le widget a pu être servi — voir `functions/api/v1/app/token.ts`. */
  expectedHostnames: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileVerification> {
  const { secret, token, remoteIp, expectedHostnames } = params;
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'missing_token', errorCodes: [] };
  }

  const doFetch = params.fetchImpl ?? fetch;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
  let result: Record<string, unknown>;
  try {
    const response = await doFetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'network', errorCodes: [] };
    const parsed: unknown = await response.json();
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, reason: 'network', errorCodes: [] };
    }
    result = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'network', errorCodes: [] };
  } finally {
    clearTimeout(timer);
  }

  const errorCodes = Array.isArray(result['error-codes'])
    ? (result['error-codes'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  if (result['success'] !== true) return { ok: false, reason: 'rejected', errorCodes };

  const hostname = typeof result['hostname'] === 'string' ? result['hostname'] : null;
  if (isTurnstileTestSecret(secret)) return { ok: true, hostname };

  if (result['action'] !== TURNSTILE_ACTION) {
    return { ok: false, reason: 'action_mismatch', errorCodes };
  }
  if (hostname === null || !expectedHostnames.has(hostname)) {
    return { ok: false, reason: 'hostname_mismatch', errorCodes };
  }
  return { ok: true, hostname };
}
