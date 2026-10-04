import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogLineTracker } from './log-line-tracker.util';
import { StatsStoreService } from '../services/stats-store.service';
import { LogFileAccessService } from '../services/log-file-access.service';

/**
 * `wakfu.log` partagé par plusieurs clients : chacun écrit à SA position, en écrasant ce qui s'y
 * trouve ; le dernier lancé tronque le fichier (voir la doc de `LogLineTracker`).
 */
class SharedLogFile {
  bytes = new Uint8Array(0);
  private readonly pointers: number[];
  private readonly encoder = new TextEncoder();

  constructor(initialPointers: number[]) {
    this.pointers = [...initialPointers];
  }

  write(writer: number, text: string): void {
    const data = this.encoder.encode(text);
    const end = this.pointers[writer] + data.length;
    if (end > this.bytes.length) {
      const grown = new Uint8Array(end);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes.set(data, this.pointers[writer]);
    this.pointers[writer] = end;
  }

  /** Lancement d'un client : fichier tronqué, ce client réécrit depuis 0. */
  truncateFor(writer: number): void {
    this.bytes = new Uint8Array(0);
    this.pointers[writer] = 0;
  }
}

const line = (time: string, text: string) =>
  ` INFO ${time} [AWT-EventQueue-0] (aNZ:174) - [Information (jeu)] ${text}\r\n`;

describe('LogLineTracker', () => {
  it('émet chaque ligne complète une seule fois, reliquat compris une fois terminé', () => {
    const tracker = new LogLineTracker();
    const file = new SharedLogFile([0]);
    file.write(0, line('10:00:00,000', 'a') + ' INFO 10:00:01,000 [x');
    expect(tracker.scanFull(file.bytes)).toHaveLength(1);
    file.write(0, '] (y) - b\r\n');
    const from = tracker.tailOffset - 1;
    expect(tracker.scanTail(file.bytes.subarray(from), from)).toEqual([
      ' INFO 10:00:01,000 [x] (y) - b',
    ]);
    expect(tracker.scanFull(file.bytes)).toEqual([]);
  });

  it('rattrape les lignes réécrites derrière la fin déjà lue, sans rejouer les autres', () => {
    const tracker = new LogLineTracker();
    // Client 0 en retard (lancé en dernier, réécrit depuis 0), client 1 en tête.
    const file = new SharedLogFile([0, 0]);
    for (let i = 0; i < 6; i++) file.write(1, line(`10:00:0${i},000`, `tête ${i}`));
    tracker.scanFull(file.bytes);

    file.write(0, line('10:00:06,000', 'Vous avez ramassé 1x Corne .'));
    file.write(1, line('10:00:06,500', 'tête 6'));
    const fresh = tracker.scanFull(file.bytes);
    // La ligne du client en retard, puis celle du client en tête — et rien d'autre : ni les lignes
    // déjà lues, ni le reste de l'ancienne ligne écrasée (fragment sans en-tête).
    expect(fresh).toEqual([
      line('10:00:06,000', 'Vous avez ramassé 1x Corne .').trimEnd(),
      line('10:00:06,500', 'tête 6').trimEnd(),
    ]);

    // Le client en retard continue : le fragment qu'il recouvre n'est jamais émis.
    file.write(0, line('10:00:07,000', 'Vous avez ramassé 1x Karne .'));
    expect(tracker.scanFull(file.bytes)).toEqual([
      line('10:00:07,000', 'Vous avez ramassé 1x Karne .').trimEnd(),
    ]);
  });

  it("un trou d'octets nuls (troncature prolongée par un autre client) sépare les lignes", () => {
    const tracker = new LogLineTracker();
    const file = new SharedLogFile([0, 0]);
    file.write(1, line('10:00:00,000', 'avant'));
    file.write(1, line('10:00:01,000', 'avant 2'));
    tracker.scanFull(file.bytes);

    file.truncateFor(0); // nouveau client lancé
    file.write(1, line('10:00:02,000', 'client 1 continue'));
    file.write(0, line('10:00:02,100', 'démarrage client 0'));
    expect(tracker.scanFull(file.bytes)).toEqual([
      line('10:00:02,100', 'démarrage client 0').trimEnd(),
      line('10:00:02,000', 'client 1 continue').trimEnd(),
    ]);
  });

  it('scanTail refuse une jonction réécrite (relecture complète nécessaire)', () => {
    const tracker = new LogLineTracker();
    const file = new SharedLogFile([0, 0]);
    file.write(1, line('10:00:00,000', 'a'));
    tracker.scanFull(file.bytes);
    const from = tracker.tailOffset - 1;
    file.write(0, 'xx'.repeat(40)); // écrase la fin de la ligne connue
    expect(tracker.scanTail(file.bytes.subarray(from), from)).toBeNull();
  });
});

describe('LogLineTracker — combats en parallèle sur un wakfu.log partagé (fixture réelle)', () => {
  const FIXTURE = join(
    process.cwd(),
    'tests/logs/fr/fight_multi-account_parallel-fights_shared-file.log',
  );
  const TIME_RE = /^\s*(?:INFO|WARN|ERROR)\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/;
  const WATCHED_ITEMS = ["Corne d'Excarnus", 'Karne de Trool', 'Archive Pelle', 'Poil de Trool'];

  /**
   * Les trois flux du fichier : client A (2 personnages sur Excarnus, lancé en dernier : il a
   * tronqué le fichier et réécrit depuis 0, lignes 1-5017), client B (même groupe, ses lignes
   * survivantes 5018-5506) et client C (Ouginak, combat Troolk en parallèle, 5508-fin — la ligne
   * 5507 est coupée par l'écrasement). Fusionnés par horodatage.
   */
  function writerEvents(): { writer: number; line: string }[] {
    const raw = readFileSync(FIXTURE, 'utf-8').split('\n');
    const segments = [raw.slice(0, 5017), raw.slice(5017, 5506), raw.slice(5507)];
    const events: { writer: number; timeMs: number; order: number; line: string }[] = [];
    segments.forEach((segment, writer) => {
      let timeMs = 0;
      for (const rawLine of segment) {
        if (!rawLine) continue;
        const match = TIME_RE.exec(rawLine);
        if (match) timeMs = ((+match[1] * 60 + +match[2]) * 60 + +match[3]) * 1000 + +match[4];
        events.push({ writer, timeMs, order: events.length, line: rawLine.replace(/\r$/, '') });
      }
    });
    return events.sort((a, b) => a.timeMs - b.timeMs || a.order - b.order);
  }

  function setup(): { stats: StatsStoreService; access: LogFileAccessService } {
    const stats = TestBed.inject(StatsStoreService);
    const access = TestBed.inject(LogFileAccessService);
    stats.addWatchedEnemy('Excarnus');
    for (const item of WATCHED_ITEMS) stats.addWatchedItem(item);
    access.newLines$.next({ lines: [], isInitialLoad: true });
    return { stats, access };
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('les lignes du client en retard alimentent le suivi en direct comme celles du client en tête', () => {
    const events = writerEvents();

    // Référence : chaque ligne de chaque client vue une fois, dans l'ordre chronologique.
    const reference = setup();
    reference.access.newLines$.next({ lines: events.map((e) => e.line), isInitialLoad: false });
    const expected = reference.stats.watchlist().map((w) => [w.name, w.count]);
    expect(expected).toEqual([
      ['Excarnus', 3],
      ["Corne d'Excarnus", 12],
      ['Karne de Trool', 6],
      ['Archive Pelle', 6],
      ['Poil de Trool', 18],
    ]);
    const expectedFightCount = reference.stats.fightHistory().length;
    expect(expectedFightCount).toBe(4);

    TestBed.resetTestingModule();
    localStorage.clear();
    TestBed.configureTestingModule({});

    // Lecture réelle d'un fichier partagé : A réécrit depuis 0, B et C écrivent bien plus loin.
    const { stats, access } = setup();
    const file = new SharedLogFile([0, 1_000_000, 2_000_000]);
    const tracker = new LogLineTracker();
    let index = 0;
    while (index < events.length) {
      const batchEnd = Math.min(events.length, index + 40);
      for (; index < batchEnd; index++)
        file.write(events[index].writer, `${events[index].line}\r\n`);
      access.newLines$.next({ lines: tracker.scanFull(file.bytes), isInitialLoad: false });
    }

    expect(stats.watchlist().map((w) => [w.name, w.count])).toEqual(expected);
    expect(stats.fightHistory()).toHaveLength(expectedFightCount);
  });
});
