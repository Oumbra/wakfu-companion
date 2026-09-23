import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { USER_DATA_KEYS, USER_DATA_META_KEY } from '../data-access/user-data.keys';
import { UserDataService } from '../data-access/user-data.service';
import { AuthService } from './auth.service';

/**
 * Déconnexion avec effacement des données de l'appareil (audit sécurité du 2026-09-23 :
 * navigateur partagé). Vérifie les trois garde-fous : effacement uniquement sur demande, jamais
 * pour un invité jamais connecté, jamais tant que des modifications n'ont pas atteint le compte.
 */

const PROFILE = { pseudo: 'Moi' };

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function setup(options: { patchFails?: boolean } = {}) {
  const api = {
    getJson: vi.fn(async (path: string) => {
      if (path === '/auth/me')
        return ok({ user: { id: 'u1', email: null, displayName: null }, identities: [] });
      if (path === '/settings') return ok({ data: {}, updatedAtByKey: {} });
      return { ok: false, error: { kind: 'http', status: 404 } };
    }),
    requestJson: vi.fn(async (path: string) => {
      if (path === '/settings') {
        return options.patchFails
          ? { ok: false, error: { kind: 'network' } }
          : ok({ applied: [], rejected: [] });
      }
      return ok({ ok: true });
    }),
    setUnauthorizedHandler: vi.fn(),
    setAppTokenRefreshHandler: vi.fn(),
  };
  TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
  return { auth: TestBed.inject(AuthService), userData: TestBed.inject(UserDataService), api };
}

async function signIn(auth: AuthService, userData: UserDataService): Promise<void> {
  await auth.loadCurrentUser();
  await userData.activateRemote();
}

describe('AuthService.logout — effacement des données de cet appareil', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(USER_DATA_KEYS.profile, JSON.stringify(PROFILE));
    localStorage.setItem('wakfu-locale', JSON.stringify('fr'));
  });
  afterEach(() => localStorage.clear());

  it('conserve les données par défaut', async () => {
    const { auth, userData } = setup();
    await signIn(auth, userData);
    expect(await auth.logout()).toBe('ok');
    expect(localStorage.getItem(USER_DATA_KEYS.profile)).not.toBeNull();
  });

  it('efface uniquement les clés de données utilisateur quand demandé', async () => {
    const { auth, userData } = setup();
    await signIn(auth, userData);
    expect(await auth.logout({ wipeLocalData: true })).toBe('ok');
    expect(localStorage.getItem(USER_DATA_KEYS.profile)).toBeNull();
    expect(localStorage.getItem(USER_DATA_META_KEY)).toBeNull();
    // Préférence purement locale, sans lien avec le compte : intacte.
    expect(localStorage.getItem('wakfu-locale')).not.toBeNull();
    expect(auth.status()).toBe('guest');
  });

  it("n'efface rien pour un invité qui n'a jamais été connecté", async () => {
    const { auth } = setup();
    await auth.logout({ wipeLocalData: true });
    expect(localStorage.getItem(USER_DATA_KEYS.profile)).not.toBeNull();
  });

  it("refuse d'effacer des modifications pas encore envoyées au compte", async () => {
    const { auth, userData } = setup({ patchFails: true });
    await signIn(auth, userData);
    userData.write('profile', { pseudo: 'Nouveau' });
    expect(await auth.logout({ wipeLocalData: true })).toBe('unsynced');
    expect(auth.status()).toBe('authenticated');
    expect(JSON.parse(localStorage.getItem(USER_DATA_KEYS.profile)!)).toEqual({
      pseudo: 'Nouveau',
    });
    userData.deactivateRemote();
  });
});
