import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService, ApiResult } from '../api/api-client.service';
import { CharacterRosterService } from './character-roster.service';
import { GameServer, GameServerService } from './game-server.service';

/**
 * Déduction du serveur de jeu actif (lot 7, prompt 7.1).
 *
 * Le log Wakfu ne dit jamais sur quel serveur on joue : tout repose sur la
 * seule chaîne « personnage reconnu → compte du roster → serveur déclaré ».
 * Sans elle, rien n'est affiché — aucun repli, aucune valeur plausible.
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
  });

  it('déduit le serveur du compte auquel appartient le personnage reconnu', async () => {
    const { service, roster } = setup();
    await service.initialize();
    const accountId = roster.accounts()[0].id;
    roster.addCharacter(accountId, 'Oumbra', 'Iop', 'm');
    roster.setAccountGameServer(accountId, 'rubilax');

    service.noticeCharacter('Oumbra');

    expect(service.activeServer()).toEqual({ server: SERVERS[1], characterName: 'Oumbra' });
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
    const { service, roster } = setup();
    await service.initialize();
    const accountId = roster.accounts()[0].id;
    roster.addCharacter(accountId, 'Oumbra', 'Iop', 'm');
    roster.setAccountGameServer(accountId, 'pandora');

    // Un autre joueur croisé en combat ne doit rien changer.
    service.noticeCharacter('InconnuDuRoster');

    expect(service.activeServer()).toBeNull();
  });

  it('n’affiche rien si le compte du personnage reconnu n’a pas de serveur', async () => {
    const { service, roster } = setup();
    await service.initialize();
    const first = roster.accounts()[0].id;
    roster.addCharacter(first, 'Oumbra', 'Iop', 'm');
    const second = roster.addAccount();
    roster.addCharacter(second, 'Autre', 'Cra', 'f');
    roster.setAccountGameServer(second, 'pandora');

    service.noticeCharacter('Oumbra');

    // Surtout pas le serveur de l'autre compte : mieux vaut ne rien afficher.
    expect(service.activeServer()).toBeNull();
  });

  it('affiche un serveur déjà choisi même sans liste chargée (hors ligne)', () => {
    const { service, roster } = setup();
    const accountId = roster.accounts()[0].id;
    roster.addCharacter(accountId, 'Oumbra', 'Iop', 'm');
    roster.setAccountGameServer(accountId, 'pandora');

    // Aucun `initialize()` : la liste est vide, mais le choix de l'utilisateur
    // ne doit pas disparaître pour autant.
    service.noticeCharacter('Oumbra');
    const active = service.activeServer();
    expect(active?.server.code).toBe('pandora');
    expect(active?.server.label).toBe('Pandora');
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
