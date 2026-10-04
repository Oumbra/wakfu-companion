import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogParser } from '../log-parser';
import { DamageEntry, LogEntry } from '../../models/log-entry.model';
import { mechanicsTriggeredBy } from './combat-mechanics';
import { IGNEMIKHAL_PROTECTION_POURPRE } from './ignemikhal.mechanic';

/** Combat réel contre Ignemikhal (fichier de test anonymisé du 2026-09-29, lignes de chat,
 * WARN/ERROR et traces Java retirées). */
const FIXTURE = join(
  process.cwd(),
  'tests/logs/fr/fight_single-account_ignemikhal_protection-pourpre.log',
);

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

const join_ = (time: string, name: string, id: number, ai: boolean) =>
  ` INFO ${time} [AWT-EventQueue-0] (fcb:1399) - [_FL_] fightId=1568078169 ${name} breed : 4534 [${id}] isControlledByAI=${ai} obstacleId : -1 join the fight at {Point3 : (-2, -60, 0)}`;
const combat = (time: string, text: string) =>
  ` INFO ${time} [AWT-EventQueue-0] (aNZ:174) - [Information (combat)] ${text}`;

/** Début de combat réel : ce sont les MONSTRES qui reçoivent le passif. */
function fightStart(boss: string): string[] {
  return [
    join_('21:36:50,460', 'Magilite', -20, true),
    join_('21:36:50,461', 'Elitendard', -18, true),
    join_('21:36:50,462', boss, -21, true),
    join_('21:36:50,463', 'Anonyme-Roublard1', 90000002, false),
    join_('21:36:50,464', 'Anonyme-Eniripsa1', 90000003, false),
    combat('21:37:50,592', 'Magilite: Protection pourpre (Niv. 1)'),
    combat('21:37:50,594', 'Elitendard: Protection pourpre (Niv. 1)'),
  ];
}

function damages(entries: LogEntry[]): DamageEntry[] {
  return entries.filter((e): e is DamageEntry => e.kind === 'damage');
}

describe('Mécanique Ignemikhal — Protection pourpre', () => {
  it('crédite le lanceur du sort qui a touché le monstre protégé, pas le dernier porteur du passif', () => {
    const entries = parseAll(new LogParser(), [
      ...fightStart('Ignemikhal'),
      combat('21:41:45,700', 'Anonyme-Roublard1 lance le sort Coup rapide (Critiques)'),
      combat('21:41:45,722', 'Ignemikhal: -1 048 PV (Neutre) (Protection pourpre)'),
      combat('21:41:45,723', 'Magilite: -1 048 PV  (Air)'),
    ]);
    expect(damages(entries)).toEqual([
      expect.objectContaining({
        target: 'Ignemikhal',
        attacker: 'Anonyme-Roublard1',
        spell: 'Protection pourpre',
        element: 'Neutre',
        amount: 1048,
        fightId: 1568078169,
      }),
      expect.objectContaining({ target: 'Magilite', attacker: 'Anonyme-Roublard1', amount: 1048 }),
    ]);
  });

  it("crédite l'allié frappé quand c'est sa riposte/son passif qui touche un monstre protégé", () => {
    const entries = parseAll(new LogParser(), [
      ...fightStart('Ignemikhal'),
      combat('21:43:44,480', 'Ignemikhal lance le sort Incinération'),
      combat('21:43:46,808', 'Anonyme-Eniripsa1: -1 100 PV (Feu)'),
      combat('21:43:47,207', 'Ignemikhal: -100 PV (Neutre) (Protection pourpre)'),
    ]);
    expect(damages(entries)[1]).toEqual(
      expect.objectContaining({
        target: 'Ignemikhal',
        attacker: 'Anonyme-Eniripsa1',
        spell: 'Protection pourpre',
        amount: 100,
      }),
    );
  });

  it("reste inactive dans un combat sans Ignemikhal : résolution générique (porteur de l'effet)", () => {
    const entries = parseAll(new LogParser(), [
      ...fightStart('Autre Boss'),
      combat('21:41:45,700', 'Anonyme-Roublard1 lance le sort Coup rapide (Critiques)'),
      combat('21:41:45,722', 'Autre Boss: -1 048 PV (Neutre) (Protection pourpre)'),
    ]);
    expect(damages(entries)).toEqual([
      expect.objectContaining({ target: 'Autre Boss', attacker: 'Elitendard' }),
    ]);
  });

  it("ne touche pas aux autres dégâts d'un combat contre Ignemikhal", () => {
    const entries = parseAll(new LogParser(), [
      ...fightStart('Ignemikhal'),
      combat('21:41:45,700', 'Anonyme-Roublard1 lance le sort Coup rapide'),
      combat('21:41:45,722', 'Ignemikhal: -300 PV (Air)'),
      combat('21:43:44,480', 'Ignemikhal lance le sort Incinération'),
      combat('21:43:46,808', 'Anonyme-Eniripsa1: -1 100 PV (Feu)'),
    ]);
    expect(damages(entries)).toEqual([
      expect.objectContaining({ attacker: 'Anonyme-Roublard1', spell: 'Coup rapide' }),
      expect.objectContaining({ attacker: 'Ignemikhal', spell: 'Incinération' }),
    ]);
  });

  it('sur le combat réel, crédite tous les dégâts répercutés à des joueurs, jamais à un monstre', () => {
    const lines = readFileSync(FIXTURE, 'utf-8').split(/\r?\n/);
    const pourpre = damages(parseAll(new LogParser(), lines)).filter(
      (e) => e.target === 'Ignemikhal' && e.spell === 'Protection pourpre',
    );
    const byAttacker: Record<string, number> = {};
    for (const e of pourpre) byAttacker[e.attacker] = (byAttacker[e.attacker] ?? 0) + e.amount;
    // 111 lignes dans le fichier, dont 9 copies d'un second client (multi-compte) dédoublonnées —
    // 6 d'entre elles portent une heure antérieure (10 à 113 ms) à la copie déjà lue, d'où le
    // dédoublonnage sur l'écart absolu (voir LogParser.isDuplicate).
    expect(pourpre.length).toBe(102);
    expect(byAttacker).toEqual({
      'Anonyme-Roublard1': 169742,
      'Anonyme-Sram1': 110747,
      'Anonyme-Pandawa1': 3380,
      'Anonyme-Ecaflip1': 1063,
      'Anonyme-Feca1': 452,
      'Anonyme-Eniripsa1': 100,
    });
  });

  it("n'est activée que par le nom Ignemikhal (casse indifférente)", () => {
    expect(mechanicsTriggeredBy('ignemikhal ')).toEqual([IGNEMIKHAL_PROTECTION_POURPRE]);
    expect(mechanicsTriggeredBy('Magilite')).toEqual([]);
  });
});
