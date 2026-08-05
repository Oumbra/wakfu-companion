import { Injectable, inject } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { PROFILE_KEY } from './profile.service';
import { REASSIGN_HISTORY_KEY, WATCHLIST_KEY } from './stats-store.service';
import { ROSTER_KEY } from './character-roster.service';

/** Dupliquées depuis chat-panel.component.ts (propriétaire du chat, pas de
 * service dédié) — garder synchronisées si ces clés changent là-bas. */
const CHAT_ACTIVE_CHANNELS_KEY = 'wakfu-active-chat-channels';
const CHAT_FILTERS_KEY = 'wakfu-chat-filters';

/** Un champ = une clé localStorage existante, réutilisées telles quelles
 * (aucune retranscription du contenu) — l'export est un simple instantané de
 * ce que chaque service/composant lit déjà via `PersistenceService`. */
const EXPORT_KEYS = {
  profile: PROFILE_KEY,
  watchlist: WATCHLIST_KEY,
  damageReassignments: REASSIGN_HISTORY_KEY,
  roster: ROSTER_KEY,
  chatActiveChannels: CHAT_ACTIVE_CHANNELS_KEY,
  chatFilters: CHAT_FILTERS_KEY,
} as const;

type ExportField = keyof typeof EXPORT_KEYS;

export interface AppDataExport {
  app: 'wakfu-companion';
  version: 1;
  exportedAt: string;
  data: Partial<Record<ExportField, unknown>>;
}

function isAppDataExport(value: unknown): value is AppDataExport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['app'] === 'wakfu-companion' && typeof candidate['data'] === 'object';
}

/**
 * Export/import global des données locales (profil, suivi, personnages,
 * chat) — voir bouton dans `.profile-page-header`. Fonctionne uniquement au
 * niveau `localStorage` (les clés que chaque service écrit déjà via
 * `PersistenceService`), sans repasser par les signaux en mémoire de chaque
 * service : un import recharge donc la page pour que tout se réinitialise
 * proprement depuis les nouvelles valeurs, plutôt que de risquer d'oublier
 * de resynchroniser un signal quelque part.
 */
@Injectable({ providedIn: 'root' })
export class AppDataExportService {
  private readonly persistence = inject(PersistenceService);

  buildExport(): AppDataExport {
    const data: AppDataExport['data'] = {};
    for (const field of Object.keys(EXPORT_KEYS) as ExportField[]) {
      const value = this.persistence.getJson(EXPORT_KEYS[field]);
      if (value !== undefined) data[field] = value;
    }
    return { app: 'wakfu-companion', version: 1, exportedAt: new Date().toISOString(), data };
  }

  /** @throws Error si `raw` n'est pas un export valide de cette appli. */
  applyImport(raw: unknown): void {
    if (!isAppDataExport(raw)) throw new Error('invalid-export-file');
    const data = raw.data;
    for (const field of Object.keys(EXPORT_KEYS) as ExportField[]) {
      if (data[field] !== undefined) this.persistence.setJson(EXPORT_KEYS[field], data[field]);
    }
  }
}
