import { TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { UserDataService } from '../data-access/user-data.service';
import type { UserDataKey } from '../data-access/user-data.keys';
import { DashboardLayoutService } from './dashboard-layout.service';

/**
 * Régression #15 (audit 2026-09-23) : `applyStored` posait n'importe quelle chaîne stockée dans
 * les signaux typés (`menuPos`, `kpiPos`, `bodyMode`, `focusTarget`, `focusSide`) — le sélecteur
 * de disposition plantait ensuite (`.find(...)!.nameKey` → TypeError). Une valeur inconnue doit
 * retomber sur le défaut DE CE CHAMP, sans perdre le reste de la disposition.
 *
 * `UserDataService` est remplacé par un faux qui renvoie la valeur BRUTE (sans passer par
 * `sanitizeUserDataValue`) : on vérifie ici la défense propre au service.
 */
function serviceWith(stored: unknown): {
  layout: DashboardLayoutService;
  emit: (value: unknown) => void;
} {
  let current = stored;
  let listener: (() => void) | null = null;
  const fake: Partial<UserDataService> = {
    read: <T>(key: UserDataKey) => (key === 'dashboardLayout' ? (current as T) : undefined),
    write: () => undefined,
    onExternalChange: (key: UserDataKey, fn: () => void) => {
      if (key === 'dashboardLayout') listener = fn;
      return () => undefined;
    },
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: UserDataService, useValue: fake }] });
  const layout = TestBed.inject(DashboardLayoutService);
  return {
    layout,
    emit: (value) => {
      current = value;
      listener?.();
    },
  };
}

describe('DashboardLayoutService — valeurs stockées inconnues', () => {
  beforeAll(() => {
    // jsdom n'implémente pas matchMedia (utilisé par `MediaQuerySignal`).
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    }
  });

  it('applique les valeurs connues telles quelles', () => {
    const { layout } = serviceWith({
      menuPos: 'right',
      kpiPos: 'bottom',
      bodyMode: 'equal',
      focusTarget: 'chat',
      focusSide: 'left',
    });
    expect(layout.menuPos()).toBe('right');
    expect(layout.kpiPos()).toBe('bottom');
    expect(layout.bodyMode()).toBe('equal');
    expect(layout.focusTarget()).toBe('chat');
    expect(layout.focusSide()).toBe('left');
  });

  it('retombe sur le défaut du SEUL champ invalide, sans jeter le reste', () => {
    const { layout } = serviceWith({
      menuPos: 'diagonal',
      kpiPos: 42,
      bodyMode: 'focus',
      focusTarget: 'combat', // ancienne carte supprimée
      focusSide: 'left',
      historyGroup: { combats: true, purchases: true, trades: false, pacts: false },
    });
    expect(layout.menuPos()).toBe('top-left');
    expect(layout.kpiPos()).toBe('top');
    expect(layout.bodyMode()).toBe('focus');
    expect(layout.focusTarget()).toBe('hist_combats');
    expect(layout.focusSide()).toBe('left');
    expect(layout.historyGroup()).toEqual({
      combats: true,
      purchases: true,
      trades: false,
      pacts: false,
    });
  });

  it('un changement externe invalide remet le défaut au lieu de garder une chaîne arbitraire', () => {
    const { layout, emit } = serviceWith({ menuPos: 'right' });
    expect(layout.menuPos()).toBe('right');
    emit({ menuPos: '__proto__', focusTarget: 'toString' });
    expect(layout.menuPos()).toBe('top-left');
    expect(layout.focusTarget()).toBe('hist_combats');
  });
});
