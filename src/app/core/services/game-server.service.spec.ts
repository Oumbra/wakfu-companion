import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService, ApiResult } from '../api/api-client.service';
import { CharacterRosterService } from './character-roster.service';
import { GameServer, GameServerService } from './game-server.service';
import { ProfileService } from './profile.service';

/**
 * Déduction du serveur de jeu actif (lot 7, prompt 7.1).
 *
 * Le log Wakfu ne dit jamais sur quel serveur on joue : tout repose sur la
 * chaîne « personnage reconnu → compte du roster → serveur déclaré », avec le
 * défaut global en repli. C'est cette chaîne que ces tests couvrent.
 */

const SERVERS: GameServer[] = [
  { code: 'pandora', label: 'Pandora', isActive: true },
  { code: 'rubilax', label: 'Rubilax', isActive: true },
  { code: 'ogrest', label: 'Ogrest', isActive: false },
];

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function setup(options: { servers?: ApiResult<GameServer[]> } = {}) {
  const getJson = vi.fn(async (path: string) => {
    if (path === '/game-servers') return options.servers ?? ok(SERVERS);
    throw new Error(`chemin inattendu : ${path}`);
  });

  TestBed.configureTestingModule({
    providers: [{ provide: ApiClientService, useValue: { getJson } }],
  });

  return {
    service: TestBed.inject(GameServerService),
    roster: TestBed.inject(CharacterRosterService),
    profile: TestBed.inject(ProfileService),
    getJson,
  };
}

describe('GameServerService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('ne propose que les serveurs actifs', async () => {
    const { service } = setup();
    await service.initialize();
    expect(service.selectableServers().map((s) => s.code)).toEqual(['pandora', 'rubilax']);
  });

  it('n’invente aucun serveur tant que rien n’est renseigné', async () => {
    const { service } = setup();
    await service.initialize();
    expect(service.activeServer()).toBeNull();
    expect(service.needsSetup()).toBe(true);
  });

  it('déduit le serveur du compte auquel appartient le personnage reconnu', async () => {
    const { service, roster } = setup();
    await service.initialize();
    const accountId = roster.accounts()[0].id;
    roster.addCharacter(accountId, 'Oumbra', 'Iop', 'm');
    roster.setAccountGameServer(accountId, 'rubilax');

    service.noticeCharacter('Oumbra');

    expect(service.activeServer()).toEqual({
      server: SERVERS[1],
      source: 'character',
      characterName: 'Oumbra',
    });
  });

  it('bascule quand un personnage d’un autre compte joue', async () => {
    const { service, roster } = setup();
    await service.initialize();
    const first = roster.accounts()[0].id;
    roster.addCharacter(first, 'Oumbra', 'Iop', 'm');
    roster.setAccountGameServer(first, 'pandora');
    const second = roster.addAccount();
    roster.addCharacter(second, 'Autre', 'Cra', 'f');
    roster.setAccountGameServer(second, 'rubilax');

    service.noticeCharacter('Oumbra');
    expect(service.activeServer()?.server.code).toBe('pandora');

    service.noticeCharacter('Autre');
    expect(service.activeServer()?.server.code).toBe('rubilax');
  });

  it('ignore un joueur qui n’appartient à aucun compte déclaré', async () => {
    const { service, roster, profile } = setup();
    await service.initialize();
    const accountId = roster.accounts()[0].id;
    roster.addCharacter(accountId, 'Oumbra', 'Iop', 'm');
    roster.setAccountGameServer(accountId, 'pandora');
    profile.setDefaultGameServer('rubilax');

    // Un autre joueur croisé en combat ne doit rien changer.
    service.noticeCharacter('InconnuDuRoster');

    expect(service.activeServer()?.source).toBe('default');
    expect(service.activeServer()?.server.code).toBe('rubilax');
  });

  it('retombe sur le défaut global si le compte du personnage n’a pas de serveur', async () => {
    const { service, roster, profile } = setup();
    await service.initialize();
    const accountId = roster.accounts()[0].id;
    roster.addCharacter(accountId, 'Oumbra', 'Iop', 'm');
    profile.setDefaultGameServer('pandora');

    service.noticeCharacter('Oumbra');

    // Surtout pas le serveur d'un autre compte : le défaut, signalé comme tel.
    expect(service.activeServer()).toEqual({ server: SERVERS[0], source: 'default' });
  });

  it('affiche un serveur déjà choisi même sans liste chargée (hors ligne)', () => {
    const { service, profile } = setup();
    profile.setDefaultGameServer('pandora');

    // Aucun `initialize()` : la liste est vide, mais le choix de l'utilisateur
    // ne doit pas disparaître pour autant.
    const active = service.activeServer();
    expect(active?.server.code).toBe('pandora');
    expect(active?.server.label).toBe('Pandora');
    expect(service.needsSetup()).toBe(false);
  });

  it('met la liste en cache pour le prochain démarrage', async () => {
    const first = setup();
    await first.service.initialize();

    TestBed.resetTestingModule();
    const second = setup({ servers: { ok: false, error: { kind: 'offline' } } });
    await second.service.initialize();

    expect(second.service.selectableServers().map((s) => s.code)).toEqual(['pandora', 'rubilax']);
  });
});
