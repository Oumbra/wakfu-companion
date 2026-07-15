import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { PersistenceService } from './persistence.service';

export type LogFileStatus =
  | 'idle'
  | 'unsupported'
  | 'needs-reconnect'
  | 'connecting'
  | 'connected'
  | 'error';

const STORAGE_KEY = 'wakfu-log-handle';
const POLL_INTERVAL_MS = 1000;

/**
 * Ouvre `wakfu_chat.log` via la File System Access API (Chrome/Edge) et le
 * relit en direct par sondage périodique. Le handle est mémorisé en
 * IndexedDB pour proposer une reconnexion en un clic à la prochaine visite
 * (la permission navigateur n'est jamais conservée automatiquement).
 */
@Injectable({ providedIn: 'root' })
export class LogFileAccessService {
  readonly status = signal<LogFileStatus>('idle');
  readonly fileName = signal<string | null>(null);
  readonly fileSize = signal<number>(0);
  readonly errorMessage = signal<string | null>(null);

  /** Lignes complètes nouvellement lues, émises par lot à chaque sondage. */
  readonly newLines$ = new Subject<string[]>();

  private handle: FileSystemFileHandle | null = null;
  private lastOffset = 0;
  private carry = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly decoder = new TextDecoder('utf-8');

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  }

  constructor(private readonly persistence: PersistenceService) {}

  /** À appeler au démarrage de l'application. */
  async init(): Promise<void> {
    if (!this.isSupported()) {
      this.status.set('unsupported');
      return;
    }
    const stored = await this.persistence.getFileHandle(STORAGE_KEY);
    if (!stored) {
      this.status.set('idle');
      return;
    }
    this.handle = stored;
    this.fileName.set(stored.name);
    const permission = await stored.queryPermission({ mode: 'read' });
    if (permission === 'granted') {
      await this.connect(stored);
    } else {
      this.status.set('needs-reconnect');
    }
  }

  /** Ouvre un sélecteur de fichier natif (geste utilisateur requis). */
  async pickFile(): Promise<void> {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Log de chat Wakfu',
            accept: { 'text/plain': ['.log', '.txt'] },
          },
        ],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      await this.persistence.setFileHandle(STORAGE_KEY, handle);
      await this.connect(handle);
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        this.setError(err);
      }
    }
  }

  /** Traite un fichier glissé-déposé (nécessite le support getAsFileSystemHandle). */
  async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    const item = dataTransfer.items?.[0];
    const withHandle = item as
      | (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
      | undefined;

    if (!withHandle?.getAsFileSystemHandle) {
      this.status.set('error');
      this.errorMessage.set(
        "Ce navigateur ne supporte pas le suivi en direct par glisser-déposer. Utilisez le bouton de sélection de fichier.",
      );
      return;
    }

    try {
      const handle = await withHandle.getAsFileSystemHandle();
      if (!handle || handle.kind !== 'file') {
        this.setError(new Error('Le fichier déposé est invalide.'));
        return;
      }
      const fileHandle = handle as FileSystemFileHandle;
      await this.persistence.setFileHandle(STORAGE_KEY, fileHandle);
      await this.connect(fileHandle);
    } catch (err) {
      this.setError(err);
    }
  }

  /** Redemande la permission sur le handle mémorisé (geste utilisateur requis). */
  async reconnect(): Promise<void> {
    if (!this.handle) {
      this.status.set('idle');
      return;
    }
    try {
      const permission = await this.handle.requestPermission({ mode: 'read' });
      if (permission === 'granted') {
        await this.connect(this.handle);
      } else {
        this.status.set('needs-reconnect');
        this.errorMessage.set('Permission refusée par le navigateur.');
      }
    } catch (err) {
      this.setError(err);
    }
  }

  /** Oublie le fichier mémorisé et revient à l'écran de sélection. */
  async forgetFile(): Promise<void> {
    this.stopPolling();
    await this.persistence.clearFileHandle(STORAGE_KEY);
    this.handle = null;
    this.lastOffset = 0;
    this.carry = '';
    this.status.set('idle');
    this.fileName.set(null);
    this.fileSize.set(0);
    this.errorMessage.set(null);
  }

  private async connect(handle: FileSystemFileHandle): Promise<void> {
    this.handle = handle;
    this.fileName.set(handle.name);
    this.lastOffset = 0;
    this.carry = '';
    this.errorMessage.set(null);
    this.status.set('connected');
    this.stopPolling();
    await this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.handle) return;
    try {
      const file = await this.handle.getFile();

      if (file.size < this.lastOffset) {
        // Fichier tronqué ou remplacé (rotation du log) : on repart de zéro.
        this.lastOffset = 0;
        this.carry = '';
      }

      if (file.size > this.lastOffset) {
        const chunk = file.slice(this.lastOffset, file.size);
        const buffer = await chunk.arrayBuffer();
        const text = this.decoder.decode(buffer);
        this.lastOffset = file.size;
        this.fileSize.set(file.size);

        const combined = this.carry + text;
        const parts = combined.split(/\r?\n/);
        this.carry = parts.pop() ?? '';
        const lines = parts.filter((line) => line.length > 0);
        if (lines.length > 0) {
          this.newLines$.next(lines);
        }
      }
    } catch (err) {
      this.setError(err);
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private setError(err: unknown): void {
    this.status.set('error');
    this.errorMessage.set(err instanceof Error ? err.message : String(err));
  }
}
