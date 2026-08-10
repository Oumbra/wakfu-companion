import { Injectable, inject } from '@angular/core';
import { USER_DATA_KEY_LIST, type UserDataKey } from '../data-access/user-data.keys';
import { UserDataService } from '../data-access/user-data.service';

export type ExportField = UserDataKey;

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
 * chat) — voir bouton dans `.profile-page-header`.
 *
 * Les champs exportés sont exactement ceux du dépôt de données utilisateur
 * (`USER_DATA_KEYS`, lot 6) : c'est le même jeu de clés que celui synchronisé
 * avec le compte, et c'est voulu — le §11 du plan prévoit explicitement de
 * réutiliser ce format d'export comme format de synchronisation plutôt que
 * d'en maintenir un second.
 *
 * L'import passe désormais par `UserDataService` plutôt que d'écrire
 * `localStorage` en direct : en mode connecté, les données importées doivent
 * partir vers le compte comme n'importe quelle autre modification. Il
 * recharge toujours la page ensuite (voir `applyImport`), pour que tous les
 * signaux en mémoire repartent des nouvelles valeurs.
 */
@Injectable({ providedIn: 'root' })
export class AppDataExportService {
  private readonly userData = inject(UserDataService);

  buildExport(): AppDataExport {
    const data: AppDataExport['data'] = {};
    for (const field of USER_DATA_KEY_LIST) {
      const value = this.userData.read(field);
      if (value !== undefined) data[field] = value;
    }
    return { app: 'wakfu-companion', version: 1, exportedAt: new Date().toISOString(), data };
  }

  /**
   * Applique un export. Attend la fin de l'envoi éventuel vers le compte : le
   * rechargement de page qui suit côté appelant annulerait sinon l'écriture
   * décalée, et l'import ne serait jamais monté sur le compte.
   *
   * @throws Error si `raw` n'est pas un export valide de cette appli.
   */
  async applyImport(raw: unknown): Promise<void> {
    if (!isAppDataExport(raw)) throw new Error('invalid-export-file');
    const data = raw.data;
    for (const field of USER_DATA_KEY_LIST) {
      if (data[field] !== undefined) this.userData.write(field, data[field]);
    }
    await this.userData.flush();
  }
}
