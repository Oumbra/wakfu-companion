import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogFileAccessService } from './log-file-access.service';

/** Handle factice dont `getFile()` peut être piloté par le test (succès ou échec simulé). */
function createFakeHandle(): FileSystemFileHandle & { getFile: (...args: unknown[]) => Promise<File> } {
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
