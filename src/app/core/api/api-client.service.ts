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
}
