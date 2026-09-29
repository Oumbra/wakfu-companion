import { describe, expect, it } from 'vitest';
import { LogParser } from '../log-parser';
import { LogEntry } from '../../models/log-entry.model';
import { mechanicsTriggeredBy } from './combat-mechanics';
import { IGNEMIKHAL_PROTECTION_POURPRE } from './ignemikhal.mechanic';

function parseAll(parser: LogParser, lines: string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const entry = parser.parseLine(line);
    if (entry) entries.push(entry);
  }
  const flushed = parser.flush();
  if (flushed) entries.push(flushed);
  return entries;
}

const join = (time: string, name: string, id: number, ai: boolean) =>
  ` INFO ${time} [AWT-EventQueue-0] (faw:1405) - [_FL_] fightId=42 ${name} breed : 100 [${id}] isControlledByAI=${ai} obstacleId : -1 join the fight at {P}`;
const combat = (time: string, text: string) =>
  ` INFO ${time} [AWT-EventQueue-0] (aPV:174) - [Information (combat)] ${text}`;

/** Début de combat : deux alliés reçoivent le passif, Anonyme-Iop2 en dernier. */
function fightStart(boss: string): string[] {
  return [
    join('20:00:00,000', 'Anonyme-Cra1', 1, false),
    join('20:00:00,001', 'Anonyme-Iop2', 2, false),
    join('20:00:00,002', boss, -1, true),
    join('20:00:00,003', 'Flamiche', -2, true),
    combat('20:00:01,000', 'Anonyme-Cra1: Protection pourpre (Niv. 1)'),
    combat('20:00:01,001', 'Anonyme-Iop2: Protection pourpre (Niv. 1)'),
  ];
}

function damages(entries: LogEntry[]) {
  return entries.filter((e) => e.kind === 'damage');
}

describe('Mécanique Ignemikhal — Protection pourpre', () => {
  it("crédite le lanceur du sort précédent, pas le dernier porteur du passif, même s'il vise un autre monstre", () => {
    const parser = new LogParser();
    const entries = parseAll(parser, [
      ...fightStart('Ignemikhal'),
      combat('20:00:05,000', 'Anonyme-Cra1 lance le sort Flèche ardente'),
      combat('20:00:05,100', 'Flamiche: -300 PV (Feu)'),
      combat('20:00:05,101', 'Ignemikhal: -150 PV (Feu) (Protection pourpre)'),
      combat('20:00:09,000', 'Anonyme-Iop2 lance le sort Épée divine'),
      combat('20:00:09,100', 'Ignemikhal: -80 PV (Air) (Protection pourpre)'),
    ]);
    expect(damages(entries)).toEqual([
      expect.objectContaining({ target: 'Flamiche', attacker: 'Anonyme-Cra1', amount: 300 }),
      expect.objectContaining({
        target: 'Ignemikhal',
        attacker: 'Anonyme-Cra1',
        spell: 'Protection pourpre',
        element: 'Feu',
        amount: 150,
        fightId: 42,
      }),
      expect.objectContaining({
        target: 'Ignemikhal',
        attacker: 'Anonyme-Iop2',
        spell: 'Protection pourpre',
        amount: 80,
      }),
    ]);
  });

  it("reste inactive dans un combat sans Ignemikhal : résolution générique (porteur de l'effet)", () => {
    const parser = new LogParser();
    const entries = parseAll(parser, [
      ...fightStart('Autre Boss'),
      combat('20:00:05,000', 'Anonyme-Cra1 lance le sort Flèche ardente'),
      combat('20:00:05,101', 'Autre Boss: -150 PV (Feu) (Protection pourpre)'),
    ]);
    expect(damages(entries)).toEqual([
      expect.objectContaining({ target: 'Autre Boss', attacker: 'Anonyme-Iop2' }),
    ]);
  });

  it("ne touche pas aux autres dégâts d'un combat contre Ignemikhal", () => {
    const parser = new LogParser();
    const entries = parseAll(parser, [
      ...fightStart('Ignemikhal'),
      combat('20:00:05,000', 'Anonyme-Cra1 lance le sort Flèche ardente'),
      combat('20:00:05,100', 'Ignemikhal: -300 PV (Feu)'),
      combat('20:00:06,000', 'Ignemikhal lance le sort Souffle'),
      combat('20:00:06,100', 'Anonyme-Cra1: -120 PV (Feu)'),
    ]);
    expect(damages(entries)).toEqual([
      expect.objectContaining({
        target: 'Ignemikhal',
        attacker: 'Anonyme-Cra1',
        spell: 'Flèche ardente',
      }),
      expect.objectContaining({ target: 'Anonyme-Cra1', attacker: 'Ignemikhal', spell: 'Souffle' }),
    ]);
  });

  it("s'abstient si le dernier sort est celui d'Ignemikhal", () => {
    expect(
      IGNEMIKHAL_PROTECTION_POURPRE.resolveDamage?.({
        target: 'Ignemikhal',
        effectTag: 'Protection pourpre',
        lastCast: { caster: 'Ignemikhal', spell: 'Souffle' },
      }),
    ).toBeNull();
  });

  it("n'est activée que par le nom Ignemikhal (casse indifférente)", () => {
    expect(mechanicsTriggeredBy('ignemikhal ')).toEqual([IGNEMIKHAL_PROTECTION_POURPRE]);
    expect(mechanicsTriggeredBy('Flamiche')).toEqual([]);
  });
});
