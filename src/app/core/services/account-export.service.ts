import { Injectable, inject } from '@angular/core';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { HISTORY_ENDPOINTS, type HistoryEventKind } from '../sync/history-event.model';

/** Réponse de `GET /api/v1/auth/export` (voir `functions/api/v1/auth/export.ts`), reprise telle
 * quelle dans le fichier : c'est le serveur qui fait autorité sur ce qu'il détient. */
export interface AccountExportServerPart {
  exportedAt: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    createdAt: string;
    lastSeenAt: string;
  };
  identities: { provider: string; providerUid: string; email: string | null; linkedAt: string }[];
  sessions: {
    id: string;
    current: boolean;
    issuedAt: string;
    lastUsedAt: string;
    expiresAt: string;
    userAgent: string | null;
    revokedAt: string | null;
    supersededAt: string | null;
  }[];
  settings: Record<string, { value: unknown; updatedAt: string }>;
}

/** Une page de `GET /api/v1/history/*` — seuls `entries`/`nextBefore` sont lus ici, les entrées
 * sont recopiées sans interprétation (format d'archive du serveur, voir `HistoryArchiveService`
 * pour les types détaillés). */
interface HistoryPage {
  entries: unknown[];
  nextBefore: string | null;
}

export type AccountHistoryExport = Record<HistoryEventKind, unknown[]>;

/** Partie « compte » d'un export (`AppDataExport.account`) — tout ce que le serveur détient. */
export interface AccountExport extends AccountExportServerPart {
  history: AccountHistoryExport;
}

/** Taille de page maximale acceptée par `GET /api/v1/history/*` (`MAX_PAGE_SIZE`, server/history/parse.ts). */
const PAGE_SIZE = 200;

/** Garde-fou contre un curseur qui n'avancerait plus (jamais censé être atteint : à 200 par page,
 * 2 000 pages font 400 000 combats). */
const MAX_PAGES_PER_KIND = 2000;

/**
 * Export RGPD des données de COMPTE (droit d'accès, portabilité — politique de
 * confidentialité §6) : identité, identités OAuth, sessions et configuration
 * via `GET /api/v1/auth/export`, plus l'INTÉGRALITÉ de l'historique du compte
 * (combats, achats, échanges, extractions de pacte) en enchaînant les quatre
 * `GET /api/v1/history/*` paginés jusqu'à épuisement.
 *
 * L'historique est composé ici plutôt que renvoyé d'un bloc par le serveur :
 * voir la doc de `functions/api/v1/auth/export.ts` (budget CPU d'une Pages
 * Function, pagination déjà bornée et testée). Le résultat est le même.
 *
 * Aucun retry : `retries: 0` comme `HistoryArchiveService` — un export qui
 * échoue à mi-parcours est simplement signalé, l'utilisateur relance.
 *
 * @throws Error('account-export-failed') dès qu'une requête échoue : un
 *   fichier partiel serait pire qu'aucun (l'utilisateur le croirait complet).
 */
@Injectable({ providedIn: 'root' })
export class AccountExportService {
  private readonly api = inject(ApiClientService);

  async build(): Promise<AccountExport> {
    const server = await this.api.getJson<AccountExportServerPart>('/auth/export', {
      retries: 0,
    });
    if (!server.ok) throw new Error('account-export-failed');

    const kinds = Object.keys(HISTORY_ENDPOINTS) as HistoryEventKind[];
    const pages = await Promise.all(kinds.map((kind) => this.loadAllPages(kind)));
    const history = Object.fromEntries(kinds.map((kind, i) => [kind, pages[i]]));
    return { ...server.data, history: history as AccountHistoryExport };
  }

  private async loadAllPages(kind: HistoryEventKind): Promise<unknown[]> {
    const entries: unknown[] = [];
    let before: string | null = null;
    for (let page = 0; page < MAX_PAGES_PER_KIND; page++) {
      const query: string = `?limit=${PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
      const result: ApiResult<HistoryPage> = await this.api.getJson<HistoryPage>(
        `${HISTORY_ENDPOINTS[kind]}${query}`,
        { retries: 0 },
      );
      if (!result.ok) throw new Error('account-export-failed');
      entries.push(...result.data.entries);
      if (result.data.nextBefore === null || result.data.nextBefore === before) break;
      before = result.data.nextBefore;
    }
    return entries;
  }
}
