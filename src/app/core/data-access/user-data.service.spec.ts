import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService, ApiResult } from '../api/api-client.service';
import { UserDataService } from './user-data.service';
import { USER_DATA_KEYS, USER_DATA_META_KEY } from './user-data.keys';

/**
 * Synchronisation de la configuration utilisateur (lot 6, prompt 6.1).
 *
 * Le point vérifié en priorité est l'arbitrage « dernier écrivain gagne »
 * par clé, dans les deux sens — c'est lui qui décide si un joueur retrouve ou
 * perd ses données en passant d'un appareil à l'autre.
 */

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
function offline<T>(): ApiResult<T> {
  return { ok: false, error: { kind: 'offline' } };
}

interface RemoteState {
  data: Record<string, unknown>;
  updatedAtByKey: Record<string, string>;
}

function setup(remote: RemoteState = { data: {}, updatedAtByKey: {} }) {
  const getJson = vi.fn(async (path: string) => {
    if (path === '/settings') return ok(remote);
    throw new Error(`chemin inattendu : ${path}`);
  });

  // Serveur en réduction : rejoue le même arbitrage que
  // functions/api/v1/settings.ts (dernier écrivain gagne, par clé).
  const requestJson = vi.fn(
    async (path: string, options: { method: string; body?: { entries?: unknown[] } }) => {
      if (path !== '/settings' || options.method !== 'PATCH') {
        throw new Error(`appel inattendu : ${options.method} ${path}`);
      }
      const applied: unknown[] = [];
      const rejected: unknown[] = [];
      for (const raw of options.body?.entries ?? []) {
        const entry = raw as { key: string; value: unknown; updatedAt: string };
        const current = remote.updatedAtByKey[entry.key];
        if (current && new Date(current) >= new Date(entry.updatedAt)) {
          rejected.push({
            key: entry.key,
            remoteUpdatedAt: current,
            value: remote.data[entry.key],
          });
          continue;
        }
        remote.data[entry.key] = entry.value;
        remote.updatedAtByKey[entry.key] = entry.updatedAt;
        applied.push({ key: entry.key, updatedAt: entry.updatedAt });
      }
      return ok({ applied, rejected });
    },
  );

  TestBed.configureTestingModule({
    providers: [{ provide: ApiClientService, useValue: { getJson, requestJson } }],
  });

  return { service: TestBed.inject(UserDataService), getJson, requestJson, remote };
}

function localMeta(): Record<string, string> {
  return JSON.parse(localStorage.getItem(USER_DATA_META_KEY) ?? '{}');
}

describe('UserDataService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('mode invité', () => {
    it('lit et écrit uniquement en localStorage, sans jamais appeler l’API', async () => {
      const { service, getJson, requestJson } = setup();

      service.write('profile', { pseudo: 'Oumbra' });

      expect(service.read('profile')).toEqual({ pseudo: 'Oumbra' });
      expect(localStorage.getItem(USER_DATA_KEYS.profile)).toBe('{"pseudo":"Oumbra"}');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getJson).not.toHaveBeenCalled();
      expect(requestJson).not.toHaveBeenCalled();
    });

    it('horodate quand même chaque écriture (indispensable au premier arbitrage)', () => {
      const { service } = setup();
      service.write('watchlist', []);
      expect(localMeta()['watchlist']).toBeTypeOf('string');
    });

    it('reste modifiable après une valeur venue d’un appareil à l’horloge en avance', () => {
      const { service } = setup();
      const ahead = new Date(Date.now() + 3_600_000).toISOString();
      service.applyAccountSnapshot({ profile: { pseudo: 'Avance' } }, { profile: ahead });

      service.write('profile', { pseudo: 'Local' });

      // Sans le rattrapage, l'écriture serait horodatée « maintenant », donc
      // antérieure à ce qu'elle remplace : refusée à jamais par l'arbitrage.
      expect(new Date(localMeta()['profile']).getTime()).toBeGreaterThan(new Date(ahead).getTime());
    });
  });

  describe('mode connecté', () => {
    it('récupère une valeur du compte plus récente que la locale', async () => {
      const { service } = setup({
        data: { profile: { pseudo: 'Distant' } },
        updatedAtByKey: { profile: '2026-08-10T12:00:00.000Z' },
      });
      localStorage.setItem(USER_DATA_KEYS.profile, JSON.stringify({ pseudo: 'Local' }));
      localStorage.setItem(
        USER_DATA_META_KEY,
        JSON.stringify({ profile: '2026-08-10T11:00:00.000Z' }),
      );

      await service.activateRemote();

      expect(service.read('profile')).toEqual({ pseudo: 'Distant' });
      // L'horodatage du serveur est conservé tel quel : sinon la valeur
      // repartirait aussitôt en sens inverse.
      expect(localMeta()['profile']).toBe('2026-08-10T12:00:00.000Z');
    });

    it('téléverse une valeur locale plus récente que celle du compte', async () => {
      const { service, remote } = setup({
        data: { profile: { pseudo: 'Distant' } },
        updatedAtByKey: { profile: '2026-08-10T10:00:00.000Z' },
      });
      localStorage.setItem(USER_DATA_KEYS.profile, JSON.stringify({ pseudo: 'Local' }));
      localStorage.setItem(
        USER_DATA_META_KEY,
        JSON.stringify({ profile: '2026-08-10T11:00:00.000Z' }),
      );

      await service.activateRemote();

      expect(remote.data['profile']).toEqual({ pseudo: 'Local' });
      expect(service.read('profile')).toEqual({ pseudo: 'Local' });
    });

    it('pousse un champ que le compte ne connaît pas encore', async () => {
      const { service, remote } = setup();
      localStorage.setItem(USER_DATA_KEYS.roster, JSON.stringify([{ id: 'a' }]));

      await service.activateRemote();

      expect(remote.data['roster']).toEqual([{ id: 'a' }]);
    });

    it('arbitre clé par clé, sans qu’un champ n’entraîne l’autre', async () => {
      const { service, remote } = setup({
        data: { profile: { pseudo: 'Distant' }, watchlist: [{ name: 'distant' }] },
        updatedAtByKey: {
          profile: '2026-08-10T12:00:00.000Z',
          watchlist: '2026-08-10T09:00:00.000Z',
        },
      });
      localStorage.setItem(USER_DATA_KEYS.profile, JSON.stringify({ pseudo: 'Local' }));
      localStorage.setItem(USER_DATA_KEYS.watchlist, JSON.stringify([{ name: 'local' }]));
      localStorage.setItem(
        USER_DATA_META_KEY,
        JSON.stringify({
          profile: '2026-08-10T11:00:00.000Z',
          watchlist: '2026-08-10T11:00:00.000Z',
        }),
      );

      await service.activateRemote();

      expect(service.read('profile')).toEqual({ pseudo: 'Distant' });
      expect(remote.data['watchlist']).toEqual([{ name: 'local' }]);
    });

    it('prévient les abonnés des seuls champs réellement modifiés ailleurs', async () => {
      const { service } = setup({
        data: { profile: { pseudo: 'Distant' }, roster: [] },
        updatedAtByKey: {
          profile: '2026-08-10T12:00:00.000Z',
          roster: '2026-08-10T12:00:00.000Z',
        },
      });
      localStorage.setItem(USER_DATA_KEYS.roster, JSON.stringify([]));
      const onProfile = vi.fn();
      const onRoster = vi.fn();
      service.onExternalChange('profile', onProfile);
      service.onExternalChange('roster', onRoster);

      await service.activateRemote();

      expect(onProfile).toHaveBeenCalledTimes(1);
      // Contenu identique à ce qui est déjà là : rien à recharger.
      expect(onRoster).not.toHaveBeenCalled();
    });

    it('groupe les écritures successives en un seul envoi différé', async () => {
      const { service, requestJson } = setup();
      await service.activateRemote();
      requestJson.mockClear();

      service.write('watchlist', [{ name: 'a', count: 1 }]);
      service.write('watchlist', [{ name: 'a', count: 2 }]);
      service.write('watchlist', [{ name: 'a', count: 3 }]);

      expect(requestJson).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(requestJson).toHaveBeenCalledTimes(1);
      const entries = (requestJson.mock.calls[0][1].body?.entries ?? []) as {
        key: string;
        value: unknown;
      }[];
      expect(entries).toHaveLength(1);
      expect(entries[0].value).toEqual([{ name: 'a', count: 3 }]);
    });

    it('applique la version du compte quand le serveur refuse une écriture périmée', async () => {
      const { service, remote } = setup();
      await service.activateRemote();
      const onProfile = vi.fn();
      service.onExternalChange('profile', onProfile);

      // Un autre appareil écrit dans le futur pendant que celui-ci modifie.
      remote.data['profile'] = { pseudo: 'AutreAppareil' };
      remote.updatedAtByKey['profile'] = new Date(Date.now() + 60_000).toISOString();

      service.write('profile', { pseudo: 'Périmé' });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(service.read('profile')).toEqual({ pseudo: 'AutreAppareil' });
      expect(onProfile).toHaveBeenCalledTimes(1);
    });

    it('garde le champ en attente quand l’envoi échoue, sans perdre la valeur locale', async () => {
      const { service, requestJson } = setup();
      await service.activateRemote();
      requestJson.mockImplementation(async () => offline());

      service.write('profile', { pseudo: 'HorsLigne' });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(service.read('profile')).toEqual({ pseudo: 'HorsLigne' });
      expect(service.syncState()).toBe('error');
      expect(service.pendingKeys()).toEqual(['profile']);
    });

    it('revient au stockage local à la déconnexion, sans toucher aux données', async () => {
      const { service, requestJson } = setup();
      await service.activateRemote();
      service.write('profile', { pseudo: 'Avant' });

      service.deactivateRemote();
      requestJson.mockClear();
      service.write('profile', { pseudo: 'Après' });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(service.isRemote()).toBe(false);
      expect(service.read('profile')).toEqual({ pseudo: 'Après' });
      expect(requestJson).not.toHaveBeenCalled();
    });

    it('reste utilisable quand le compte est injoignable au démarrage', async () => {
      const { service, getJson } = setup();
      getJson.mockImplementation(async () => offline());
      localStorage.setItem(USER_DATA_KEYS.profile, JSON.stringify({ pseudo: 'Local' }));

      await service.activateRemote();

      expect(service.read('profile')).toEqual({ pseudo: 'Local' });
      expect(service.syncState()).toBe('error');
    });
  });

  describe('migration depuis le compte (lot 5)', () => {
    it('conserve les horodatages du serveur en appliquant un instantané', () => {
      const { service } = setup();
      service.applyAccountSnapshot(
        { profile: { pseudo: 'Compte' } },
        { profile: '2026-08-10T12:00:00.000Z' },
      );
      expect(service.read('profile')).toEqual({ pseudo: 'Compte' });
      expect(localMeta()['profile']).toBe('2026-08-10T12:00:00.000Z');
    });

    it('aligne les horodatages locaux après un téléversement complet', () => {
      const { service } = setup();
      service.write('profile', { pseudo: 'Local' });
      service.markUploaded(new Date('2026-08-10T12:00:00.000Z'));
      expect(localMeta()['profile']).toBe('2026-08-10T12:00:00.000Z');
      // Une clé absente localement ne doit pas être inventée.
      expect(localMeta()['roster']).toBeUndefined();
    });
  });
});
