import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { fileConnectedGuard } from './file-connected.guard';
import { LogFileAccessService } from '../services/log-file-access.service';

/**
 * `LogFileAccessService.init()` (asynchrone) n'est jamais appelé dans ces tests : on pilote
 * `ready` à la main pour simuler les deux ordres d'arrivée possibles (résolution avant/après
 * l'évaluation du garde) — exactement la course que ce garde doit désormais gérer (voir son
 * commentaire).
 */
function controlledReady(service: LogFileAccessService): () => void {
  let resolve!: () => void;
  const ready = new Promise<void>((r) => {
    resolve = r;
  });
  Object.defineProperty(service, 'ready', { value: ready, configurable: true });
  return resolve;
}

function fakeRoute(lang: string): ActivatedRouteSnapshot {
  return { parent: { paramMap: { get: () => lang } } } as unknown as ActivatedRouteSnapshot;
}

describe('fileConnectedGuard', () => {
  let logFileAccess: LogFileAccessService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    logFileAccess = TestBed.inject(LogFileAccessService);
    router = TestBed.inject(Router);
  });

  it("n'accède pas immédiatement à status() : attend que `ready` se résolve avant de trancher", async () => {
    const resolveReady = controlledReady(logFileAccess);
    logFileAccess.status.set('idle'); // valeur par défaut au moment d'un F5, avant que init() n'ait tranché

    let settled = false;
    const resultPromise = TestBed.runInInjectionContext(() =>
      fileConnectedGuard(fakeRoute('fr'), null as never),
    ) as Promise<boolean | UrlTree>;
    void resultPromise.then(() => {
      settled = true;
    });

    // Le garde ne doit pas trancher tant que `ready` n'est pas résolue, même si `status()` vaut
    // déjà 'idle' (valeur par défaut) — c'est exactement la régression corrigée.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    // Une fois `ready` résolue avec un fichier bien connecté entre-temps (cas du F5 sur une
    // session déjà connectée avant rechargement), le garde doit laisser passer.
    logFileAccess.status.set('connected');
    resolveReady();

    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it('redirige vers `/:lang` si `ready` se résout sans connexion établie', async () => {
    const resolveReady = controlledReady(logFileAccess);
    logFileAccess.status.set('idle');

    const resultPromise = TestBed.runInInjectionContext(() =>
      fileConnectedGuard(fakeRoute('en'), null as never),
    ) as Promise<boolean | UrlTree>;

    resolveReady();
    const result = await resultPromise;

    expect(result).not.toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/en');
  });

  it('ne bloque pas si `ready` est déjà résolue (navigation programmatique)', async () => {
    logFileAccess.status.set('connected');
    // `ready` par défaut (posée par le service à sa construction) n'est jamais résolue dans ce
    // test puisqu'on n'appelle pas init() — on la résout explicitement ici pour représenter le cas
    // réel où l'app a déjà démarré depuis longtemps.
    const resolveReady = controlledReady(logFileAccess);
    resolveReady();

    const result = await (TestBed.runInInjectionContext(() =>
      fileConnectedGuard(fakeRoute('fr'), null as never),
    ) as Promise<boolean | UrlTree>);

    expect(result).toBe(true);
  });
});
