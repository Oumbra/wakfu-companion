import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { PersistenceService } from './persistence.service';

export type LogFileStatus =
  'idle' | 'unsupported' | 'needs-reconnect' | 'connecting' | 'connected' | 'error';

const STORAGE_KEY = 'wakfu-log-handle';
const POLL_INTERVAL_MS = 1000;
const EXPECTED_FILE_NAME_RE = /^wakfu\.log$/i;
/** Nombre de sondages consécutifs en échec « NotReadableError » tolérés avant de basculer en erreur visible. */
const MAX_TRANSIENT_READ_FAILURES = 5;

/**
 * Ouvre `wakfu.log` via la File System Access API (Chrome/Edge/Opera) et le
 * relit en direct par sondage périodique — seul mode de lecture supporté
 * (voir README de session : le sélecteur classique `<input type="file">` a
 * été retiré, il ne permettait aucune lecture continue). Contrairement à
 * `wakfu_chat.log`, ce fichier technique du client contient aussi les
 * marqueurs fiables de début/fin de combat (indispensables pour distinguer
 * proprement plusieurs combats, y compris les entraînements contre un
 * mannequin qui n'affichent jamais l'écran de fin de combat côté chat). Le
 * handle est mémorisé en IndexedDB pour proposer une reconnexion en un clic
 * à la prochaine visite (la permission navigateur n'est jamais conservée
 * automatiquement).
 *
 * Chrome/Edge bloquent le sélecteur natif (`showOpenFilePicker`) pour tout
 * fichier situé sous `%AppData%\Roaming` — précisément le dossier par défaut
 * des logs Wakfu — mais PAS le glisser-déposer (`getAsFileSystemHandle`),
 * qui reste donc la solution de repli à recommander à l'utilisateur si le
 * clic échoue pour cette raison (voir errorMessage dans pickFile()).
 */
@Injectable({ providedIn: 'root' })
export class LogFileAccessService {
  readonly status = signal<LogFileStatus>('idle');
  readonly fileName = signal<string | null>(null);
  readonly fileSize = signal<number>(0);
  readonly errorMessage = signal<string | null>(null);

  /**
   * Lignes complètes nouvellement lues, émises par lot à chaque sondage.
   * `isInitialLoad` est vrai uniquement pour le tout premier lot d'une
   * connexion (contenu déjà présent dans le fichier avant l'ouverture) :
   * permet de ne pas re-compter dans les suivis un historique déjà vécu.
   */
  readonly newLines$ = new Subject<{ lines: string[]; isInitialLoad: boolean }>();

  private handle: FileSystemFileHandle | null = null;
  private lastOffset = 0;
  private carry = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly decoder = new TextDecoder('utf-8');
  private isFirstRead = true;
  private consecutiveTransientReadFailures = 0;

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
    if (!this.isAcceptedFileName(stored.name)) {
      // Ancien handle mémorisé avant la bascule vers wakfu.log (ex. wakfu_chat.log) : on l'oublie.
      await this.persistence.clearFileHandle(STORAGE_KEY);
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

  /** Ouvre le sélecteur natif du navigateur (clic sur la zone de sélection). */
  async pickFile(): Promise<void> {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Wakfu log', accept: { 'text/plain': ['.log', '.txt'] } }],
      });
      if (!this.isAcceptedFileName(handle.name)) {
        this.rejectWrongFile(handle.name);
        return;
      }
      await this.persistence.setFileHandle(STORAGE_KEY, handle);
      await this.connect(handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // L'utilisateur a fermé le sélecteur sans choisir de fichier : pas une erreur.
        return;
      }
      this.status.set('error');
      this.errorMessage.set(
        "Le sélecteur de fichier n'a pas pu ouvrir wakfu.log (dossier protégé par le navigateur, " +
          'notamment sous %AppData%\\Roaming). Essayez de glisser-déposer le fichier directement ' +
          'dans la zone ci-dessus : ce mode fonctionne même quand le sélecteur est bloqué.',
      );
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
        'Ce navigateur ne supporte pas le suivi en direct par glisser-déposer. Utilisez le bouton de sélection de fichier.',
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
      if (!this.isAcceptedFileName(fileHandle.name)) {
        this.rejectWrongFile(fileHandle.name);
        return;
      }
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
    this.isFirstRead = true;
    this.consecutiveTransientReadFailures = 0;
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
    this.isFirstRead = true;
    this.consecutiveTransientReadFailures = 0;
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
      this.consecutiveTransientReadFailures = 0;
      if (this.status() === 'error') {
        this.status.set('connected');
        this.errorMessage.set(null);
      }
      await this.processFile(file);
    } catch (err) {
      if (this.isTransientReadError(err)) {
        this.consecutiveTransientReadFailures++;
        if (this.consecutiveTransientReadFailures <= MAX_TRANSIENT_READ_FAILURES) {
          // Fichier momentanément verrouillé (écriture concurrente du jeu) : le sondage
          // suivant (déjà planifié, ~1s) réessaiera de lui-même sans interrompre l'utilisateur.
          return;
        }
      }
      this.setError(err);
      this.stopPolling();
    }
  }

  private isTransientReadError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'NotReadableError';
  }

  /** Découpe/décode la portion nouvellement écrite d'un fichier (depuis `lastOffset`) et publie les lignes complètes. */
  private async processFile(file: File): Promise<void> {
    const isInitialLoad = this.isFirstRead;
    this.isFirstRead = false;

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
        this.newLines$.next({ lines, isInitialLoad });
      }
    }
  }

  private isAcceptedFileName(name: string): boolean {
    return EXPECTED_FILE_NAME_RE.test(name);
  }

  private rejectWrongFile(name: string): void {
    this.status.set('error');
    this.errorMessage.set(
      `« ${name} » n'est pas le bon fichier. Sélectionnez « wakfu.log » (et non wakfu_chat.log), ` +
        'situé dans %AppData%\\zaap\\gamesLogs\\wakfu\\logs\\.',
    );
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
