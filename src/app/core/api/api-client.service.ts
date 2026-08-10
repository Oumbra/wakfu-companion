import { Injectable } from '@angular/core';

export type ApiErrorKind = 'offline' | 'timeout' | 'http' | 'network';

export interface ApiError {
  kind: ApiErrorKind;
  /** Renseigné uniquement pour `kind: 'http'`. */
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client HTTP centralisé pour l'API (`/api/v1/*`, voir server/README.md) —
 * lot 3.1, prompt "core/api/api-client.service.ts : fetch centralisé (base
 * URL, timeout, retry, credentials: 'include', gestion du hors-ligne)".
 *
 * URL relative (`/api/v1`, pas d'origine absolue) : front et API sont
 * servis depuis la MÊME origine (voir server/README.md §Architecture) —
 * aucun besoin de configurer une base URL par environnement, et ça évite
 * tout souci CORS.
 *
 * `credentials: 'include'` dès maintenant même si aucun cookie de session
 * n'existe encore (lot 5, authentification) : évite d'avoir à revisiter cet
 * appel plus tard, sans coût (un `fetch` sans cookie à envoyer se comporte
 * normalement).
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly baseUrl = '/api/v1';
  private unauthorizedHandler: (() => void) | null = null;

  /**
   * Point d'accroche unique pour le `401` (lot 5, prompt 5.2 : « intercepteur
   * HTTP : sur 401, bascule proprement en mode invité plutôt que de
   * planter »). Cette application n'utilise pas `HttpClient` — tout passe par
   * ce service — donc l'équivalent d'un intercepteur est ici, et il couvre
   * ainsi TOUS les appels API, pas seulement ceux d'`AuthService`.
   *
   * Enregistré par `AuthService` ; volontairement pas une injection directe
   * d'`AuthService` ici, qui créerait une dépendance circulaire (AuthService →
   * ApiClientService → AuthService).
   */
  setUnauthorizedHandler(handler: () => void): void {
    this.unauthorizedHandler = handler;
  }

  private notifyIfUnauthorized(status: number): void {
    if (status === 401) this.unauthorizedHandler?.();
  }

  /**
   * GET JSON avec retry (backoff simple) et timeout. Pas de retry sur une
   * erreur HTTP 4xx (le serveur a répondu, retenter ne changera rien) —
   * uniquement sur timeout/erreur réseau, où un aléa transitoire est
   * plausible.
   */
  async getJson<T>(
    path: string,
    options?: { timeoutMs?: number; retries?: number },
  ): Promise<ApiResult<T>> {
    if (!navigator.onLine) {
      return { ok: false, error: { kind: 'offline' } };
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = options?.retries ?? DEFAULT_RETRIES;
    let lastError: ApiError = { kind: 'network' };

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          lastError = { kind: 'http', status: response.status };
          this.notifyIfUnauthorized(response.status);
          if (response.status >= 400 && response.status < 500) break;
        } else {
          return { ok: true, data: (await response.json()) as T };
        }
      } catch {
        clearTimeout(timer);
        lastError = controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network' };
      }

      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }

    return { ok: false, error: lastError };
  }

  /**
   * Requête JSON quelconque (POST/PUT/DELETE...), sans retry : contrairement
   * à un GET, rejouer une écriture n'est pas anodin — une requête mutative
   * dont on ne sait pas si elle a abouti ne doit pas être relancée
   * automatiquement.
   *
   * Ajoute le jeton CSRF double-submit (`X-CSRF-Token`) attendu par les
   * routes mutatives de l'API d'authentification (voir
   * functions/api/_auth.ts) : il est lu dans le cookie `wc_csrf`, seul cookie
   * d'authentification volontairement lisible en JS — le cookie de session,
   * lui, est `httpOnly` et reste invisible d'ici.
   */
  async requestJson<T>(
    path: string,
    options: { method: string; body?: unknown; timeoutMs?: number },
  ): Promise<ApiResult<T>> {
    if (!navigator.onLine) {
      return { ok: false, error: { kind: 'offline' } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = {};
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        credentials: 'include',
        signal: controller.signal,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      clearTimeout(timer);

      if (!response.ok) {
        this.notifyIfUnauthorized(response.status);
        return { ok: false, error: { kind: 'http', status: response.status } };
      }
      // 204 ou corps vide : renvoyer `undefined` plutôt que planter sur un JSON absent.
      const text = await response.text();
      return { ok: true, data: (text ? JSON.parse(text) : undefined) as T };
    } catch {
      clearTimeout(timer);
      return {
        ok: false,
        error: controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network' },
      };
    }
  }
}

/** Cookie CSRF posé par l'API (voir server/auth/cookies.ts) — non `httpOnly` par conception. */
function readCsrfCookie(): string | null {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'wc_csrf')
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
