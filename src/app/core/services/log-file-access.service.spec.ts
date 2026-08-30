import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogFileAccessService } from './log-file-access.service';

/** Handle factice dont `getFile()` peut être piloté par le test (succès ou échec simulé). */
function createFakeHandle(): FileSystemFileHandle & {
  getFile: (...args: unknown[]) => Promise<File>;
} {
  return {
    kind: 'file',
    name: 'wakfu.log',
    getFile: () => Promise.resolve(new File([''], 'wakfu.log')),
  } as unknown as FileSystemFileHandle & { getFile: (...args: unknown[]) => Promise<File> };
}

describe('LogFileAccessService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('ignore les NotReadableError isolées (fichier momentanément verrouillé) sans quitter l’état connecté', async () => {
    const service = TestBed.inject(LogFileAccessService);
    const handle = createFakeHandle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).handle = handle;
    service.status.set('connected');

    handle.getFile = () => Promise.reject(new DOMException('locked', 'NotReadableError'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).poll();

    expect(service.status()).toBe('connected');
    expect(service.errorMessage()).toBeNull();
  });

  it('bascule en erreur après trop d’échecs consécutifs, puis se rétablit dès qu’une lecture réussit', async () => {
    const service = TestBed.inject(LogFileAccessService);
    const handle = createFakeHandle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).handle = handle;
    service.status.set('connected');

    handle.getFile = () => Promise.reject(new DOMException('locked', 'NotReadableError'));
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).poll();
    }

    expect(service.status()).toBe('error');
    expect(service.errorMessage()).toContain('locked');

    handle.getFile = () => Promise.resolve(new File([''], 'wakfu.log'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).poll();

    expect(service.status()).toBe('connected');
    expect(service.errorMessage()).toBeNull();
  });

  it('signale l’interprétation initiale en cours entre le début de connect() et la fin du tout premier poll()', async () => {
    const service = TestBed.inject(LogFileAccessService);
    const handle = createFakeHandle();
    // `getFile()` volontairement en attente (résolue plus tard) : simule une lecture disque encore
    // en cours, le temps de vérifier que `initialReadPending` est déjà passé à `true` avant que le
    // contenu ne soit disponible — voir la doc du signal (FightHistoryComponent en dépend pour
    // afficher un spinner pendant ce court intervalle).
    let resolveFile!: (file: File) => void;
    handle.getFile = () => new Promise<File>((resolve) => (resolveFile = resolve));

    expect(service.initialReadPending()).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectPromise = (service as any).connect(handle);
    expect(service.initialReadPending()).toBe(true);

    resolveFile(new File(['une ligne'], 'wakfu.log'));
    await connectPromise;

    expect(service.initialReadPending()).toBe(false);
    // `connect()` démarre un vrai `setInterval` de sondage (voir son code) : l'arrêter pour ne pas
    // laisser un minuteur tourner après la fin du test (autre instance de service au prochain test,
    // via `TestBed.configureTestingModule` en `beforeEach`, mais le minuteur réel, lui, survivrait).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).stopPolling();
  });

  it('ne bloque jamais `initialReadPending` en cas d’échec du tout premier poll()', async () => {
    const service = TestBed.inject(LogFileAccessService);
    const handle = createFakeHandle();
    handle.getFile = () => Promise.reject(new DOMException('locked', 'NotReadableError'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).connect(handle);

    expect(service.initialReadPending()).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).stopPolling();
  });

  it('remonte immédiatement une erreur non transitoire (ex. permission révoquée)', async () => {
    const service = TestBed.inject(LogFileAccessService);
    const handle = createFakeHandle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).handle = handle;
    service.status.set('connected');

    handle.getFile = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).poll();

    expect(service.status()).toBe('error');
    expect(service.errorMessage()).toContain('denied');
  });
});
