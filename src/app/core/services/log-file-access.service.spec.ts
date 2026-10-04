import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => vi.restoreAllMocks());

  it('publie en direct les lignes qu’un 2ᵉ client réécrit DERRIÈRE la fin déjà lue (wakfu.log partagé)', async () => {
    const service = TestBed.inject(LogFileAccessService);
    const handle = createFakeHandle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).handle = handle;
    service.status.set('connected');
    const emitted: { lines: string[]; isInitialLoad: boolean }[] = [];
    service.newLines$.subscribe((batch) => emitted.push(batch));

    let content = new Uint8Array(0);
    const encoder = new TextEncoder();
    // Chaque client écrit à SA position en écrasant ce qui s'y trouve (voir LogLineTracker).
    const writeAt = (offset: number, text: string): number => {
      const data = encoder.encode(text);
      if (offset + data.length > content.length) {
        const grown = new Uint8Array(offset + data.length);
        grown.set(content);
        content = grown;
      }
      content.set(data, offset);
      return offset + data.length;
    };
    handle.getFile = () => Promise.resolve(new File([content.slice()], 'wakfu.log'));
    const line = (time: string, text: string) =>
      ` INFO ${time} [AWT-EventQueue-0] (aNZ:174) - [Information (jeu)] ${text}\r\n`;
    let nowMs = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poll = () => (service as any).poll() as Promise<void>;

    // Client en tête : déjà loin dans le fichier (lancé avant, n'a pas été tronqué).
    let leader = 0;
    for (let i = 0; i < 5; i++) leader = writeAt(leader, line(`10:00:0${i},000`, `tête ${i}`));
    await poll();
    expect(emitted[0].isInitialLoad).toBe(true);
    expect(emitted[0].lines).toHaveLength(5);

    // Moins d'une seconde plus tard : simple lecture de fin.
    nowMs += 200;
    leader = writeAt(leader, line('10:00:05,000', 'tête 5'));
    await poll();
    expect(emitted[1]).toEqual({
      lines: [line('10:00:05,000', 'tête 5').trimEnd()],
      isInitialLoad: false,
    });

    // Client en retard (lancé en dernier : réécrit depuis 0) — invisible pour une lecture par
    // offset, rattrapé par la relecture complète suivante.
    let trailer = 0;
    trailer = writeAt(trailer, line('10:00:05,500', 'Vous avez ramassé 1x Corne d’Excarnus .'));
    nowMs += 1000;
    leader = writeAt(leader, line('10:00:06,000', 'tête 6'));
    await poll();
    expect(emitted[2]).toEqual({
      lines: [
        line('10:00:05,500', 'Vous avez ramassé 1x Corne d’Excarnus .').trimEnd(),
        line('10:00:06,000', 'tête 6').trimEnd(),
      ],
      isInitialLoad: false,
    });
    expect(trailer).toBeLessThan(leader);
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
