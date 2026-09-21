import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { PersistenceService } from '../services/persistence.service';
import { ApiClientService } from './api-client.service';

/** Réponse de `GET /api/v1/app/token` (voir `functions/api/v1/app/token.ts`). */
interface AppTokenConfig {
  siteKey: string | null;
  ttlSeconds: number;
  hasToken: boolean;
}

interface StoredAppToken {
  /** ISO — échéance annoncée par le serveur à la dernière émission. */
  expiresAt: string;
}

/** Clé `localStorage` (voir `PersistenceService.getJson`) — donnée locale non synchronisée, pas une
 * donnée utilisateur : juste la mémoire de « le cookie devrait encore être là ». */
const STORAGE_KEY = 'app-token';
/** Redemander un jeton un peu avant son échéance réelle, pour ne jamais partir avec un cookie
 * qui expire en cours de session. */
const RENEW_MARGIN_MS = 15 * 60 * 1000;

const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** `data-action` exigé côté serveur (`server/http/turnstile.ts`, `TURNSTILE_ACTION`). */
const TURNSTILE_ACTION = 'app-token';
/** Au-delà, on renonce pour ce chargement de page (script bloqué par une extension, réseau
 * absent…) : l'application reste utilisable, seules les routes référentiel répondent 403 et le
 * bandeau « catalogue indisponible » existant le dit. Nouvel essai au prochain chargement. */
const TURNSTILE_TIMEOUT_MS = 12_000;
const CONTAINER_ID = 'wc-turnstile';

/** Surface minimale de l'API globale `turnstile` (script Cloudflare, voir TURNSTILE_SCRIPT_URL). */
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Jeton d'application du site (`docs/analyse-cgu-2026-09-21.md`, recommandation 4, options B + C —
 * voir `server/http/app-token.ts` pour le pourquoi) : le cookie `wc_app` que les routes référentiel
 * (`/catalog/*`, `/items/{id}`, `/monsters/{id}`, `/monster-loot`, `/monster-families`, `/dungeons`)
 * exigent d'un navigateur, en plus de `Sec-Fetch-Site: same-origin`. Le relais d'icônes ne l'exige
 * pas (une `<img>` peut partir avant que le jeton n'existe).
 *
 * Le cookie est `HttpOnly` : ce service ne le lit jamais, il ne retient que l'échéance annoncée par
 * le serveur (`localStorage`). Deux points d'entrée :
 * - `ensure()` — au démarrage (`App.ngOnInit`) : ne fait rien si l'échéance mémorisée est encore
 *   loin, sinon demande un jeton. Non bloquant pour le reste du démarrage.
 * - le rappel enregistré auprès d'`ApiClientService` — un `403` porteur du code
 *   `app_token_required` (cookie absent, expiré, ou secret serveur changé) redemande un jeton et
 *   la requête est rejouée une fois. C'est la vraie garantie ; `ensure()` n'est qu'une avance.
 *
 * Obtention : `GET /app/token` donne la clé de site Turnstile (`null` si Turnstile n'est pas
 * configuré, cas du développement local) ; si elle existe, le widget Turnstile est rendu en mode
 * `interaction-only` (invisible tant qu'aucune interaction n'est requise) dans un conteneur fixé en
 * bas à droite, et son jeton est envoyé à `POST /app/token`, qui pose le cookie. Une seule demande
 * en vol à la fois : les appels concurrents partagent la même promesse.
 */
@Injectable({ providedIn: 'root' })
export class AppTokenService {
  private readonly api = inject(ApiClientService);
  private readonly persistence = inject(PersistenceService);
  private readonly document = inject(DOCUMENT);

  /** Vrai dès qu'un jeton a été obtenu pendant ce chargement de page, ou qu'un jeton mémorisé
   * semblait encore valide au démarrage. Informatif (affichage éventuel), jamais bloquant. */
  readonly ready = signal(false);

  private expiresAtMs = this.readStoredExpiry();
  private inFlight: Promise<boolean> | null = null;
  private scriptLoading: Promise<TurnstileApi | null> | null = null;

  constructor() {
    this.api.setAppTokenRefreshHandler(() => this.refresh());
  }

  /** Au démarrage : demande un jeton seulement si aucun ne semble encore valide. */
  ensure(): Promise<boolean> {
    if (this.expiresAtMs - Date.now() > RENEW_MARGIN_MS) {
      this.ready.set(true);
      return Promise.resolve(true);
    }
    return this.refresh();
  }

  /** Demande un jeton neuf (une seule demande en vol, partagée). */
  refresh(): Promise<boolean> {
    if (!this.inFlight) {
      this.inFlight = this.requestToken().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async requestToken(): Promise<boolean> {
    const config = await this.api.getJson<AppTokenConfig>('/app/token', { retries: 0 });
    if (!config.ok) return false;

    let turnstileToken: string | null = null;
    if (config.data.siteKey) {
      turnstileToken = await this.solveTurnstile(config.data.siteKey);
      if (!turnstileToken) return false;
    }

    const issued = await this.api.requestJson<{ ok: true; expiresAt: string }>('/app/token', {
      method: 'POST',
      body: { turnstileToken },
    });
    if (!issued.ok) return false;

    this.expiresAtMs = Date.parse(issued.data.expiresAt);
    this.persistence.setJson(STORAGE_KEY, { expiresAt: issued.data.expiresAt } as StoredAppToken);
    this.ready.set(true);
    return true;
  }

  private readStoredExpiry(): number {
    const stored = this.persistence.getJson<StoredAppToken>(STORAGE_KEY);
    const parsed = stored ? Date.parse(stored.expiresAt) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Charge le script Turnstile une seule fois (`render=explicit` : rien ne se rend tout seul). */
  private loadTurnstile(): Promise<TurnstileApi | null> {
    if (this.document.defaultView?.turnstile) {
      return Promise.resolve(this.document.defaultView.turnstile);
    }
    if (!this.scriptLoading) {
      this.scriptLoading = new Promise<TurnstileApi | null>((resolve) => {
        const script = this.document.createElement('script');
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve(this.document.defaultView?.turnstile ?? null);
        script.onerror = () => resolve(null);
        this.document.head.appendChild(script);
      }).then((api) => {
        // Un échec de chargement ne doit pas être mémorisé pour toute la vie de la page : la
        // prochaine demande retentera d'insérer le script.
        if (!api) this.scriptLoading = null;
        return api;
      });
    }
    return this.scriptLoading;
  }

  /** Conteneur du widget, fixé en bas à droite et vide tant que Turnstile n'a rien à montrer
   * (`appearance: 'interaction-only'`) — créé à la demande, réutilisé ensuite. */
  private container(): HTMLElement {
    let el = this.document.getElementById(CONTAINER_ID);
    if (!el) {
      el = this.document.createElement('div');
      el.id = CONTAINER_ID;
      el.style.position = 'fixed';
      el.style.right = '16px';
      el.style.bottom = '16px';
      el.style.zIndex = '10000';
      this.document.body.appendChild(el);
    }
    return el;
  }

  /** Jeton Turnstile pour l'action `app-token`, ou `null` (script indisponible, refus, délai). */
  private async solveTurnstile(siteKey: string): Promise<string | null> {
    const api = await this.loadTurnstile();
    if (!api) return null;

    const container = this.container();
    return new Promise<string | null>((resolve) => {
      let widgetId: string | null = null;
      let settled = false;
      const finish = (token: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (widgetId !== null) {
          try {
            api.remove(widgetId);
          } catch {
            // widget déjà retiré (navigation) : rien à faire
          }
        }
        resolve(token);
      };
      const timer = setTimeout(() => finish(null), TURNSTILE_TIMEOUT_MS);
      try {
        widgetId = api.render(container, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          appearance: 'interaction-only',
          callback: (token) => finish(token),
          'error-callback': () => finish(null),
          'expired-callback': () => finish(null),
          'timeout-callback': () => finish(null),
        });
      } catch {
        finish(null);
      }
    });
  }
}
