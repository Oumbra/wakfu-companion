import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HDV_KAMAS_SALE_ITEM, StatsStoreService } from './stats-store.service';
import { LogFileAccessService } from './log-file-access.service';
import { CharacterRosterService } from './character-roster.service';
import { LootAlertService } from './loot-alert.service';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { HistorySyncService } from '../sync/history-sync.service';

const FIXTURES_DIR = join(process.cwd(), 'tests/logs/fr');

function readFixture(name: string): string[] {
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8');
  return content.split(/\r?\n/).filter((line) => line.length > 0);
}

function feed(access: LogFileAccessService, lines: string[]): void {
  access.newLines$.next({ lines, isInitialLoad: true });
}

/** Simule un nouveau lot de lignes sur une connexion déjà active (isInitialLoad=false), sans réinitialiser la session — contrairement à `feed`. */
function feedMore(access: LogFileAccessService, lines: string[]): void {
  access.newLines$.next({ lines, isInitialLoad: false });
}

describe('StatsStoreService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  describe('Historique Achats (assets/logs/tests/fr/purchase*.log)', () => {
    it('détecte les achats du jeu de test purchase.log (perte de kamas + ramassage immédiat)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('purchase.log'));

      const purchases = stats.purchaseHistory();
      expect(purchases).toHaveLength(3);
      // L'historique est le plus récent en tête : le fichier liste 340, 1440, 1400 kamas dans cet ordre.
      expect(purchases.map((p) => p.totalCost)).toEqual([1400, 1440, 340]);
      expect(purchases.map((p) => p.item)).toEqual(['Poudre', 'Pain Complet', 'Pain Complet']);
      expect(purchases.map((p) => p.quantity)).toEqual([100, 16, 4]);
    });

    it("gère les achats d'objets uniques et de gros montants (purchase_2.log)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('purchase_2.log'));

      const purchases = stats.purchaseHistory();
      expect(purchases).toHaveLength(2);
      expect(purchases.map((p) => p.totalCost)).toEqual([29999, 29999]);
      expect(purchases.map((p) => p.item)).toEqual([
        "Aura de l'Epée de Sufokia",
        'Aura des Bottes Cérémoniales du Seigneur des Rats',
      ]);
    });

    it('enchaîne plusieurs achats consécutifs sans les mélanger (purchase_3.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('purchase_3.log'));

      const purchases = stats.purchaseHistory();
      expect(purchases).toHaveLength(3);
      expect(purchases.map((p) => p.totalCost)).toEqual([54898, 48997, 46990]);
      expect(purchases.map((p) => p.item)).toEqual([
        'Aura des Coques Luche',
        'Aura des Bottes Répané',
        "Aura de l'Amulette du Mak Assutra",
      ]);
    });

    it("n'enregistre pas de perte de kamas isolée (sans ramassage) comme un achat", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 11:02:26,931 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez perdu 500 kamas.',
        ' INFO 11:02:30,000 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez ramassé 1x Poudre .',
      ]);
      expect(stats.purchaseHistory()).toHaveLength(0);
      expect(stats.kamasLost()).toBe(500);
    });
  });

  describe("Historique Achats — récupération de kamas à l'Hôtel de vente (HDV_KAMAS_SALE_ITEM)", () => {
    it('enregistre un gain de kamas isolé (hors combat, hors échange) comme un achat "Hôtel de vente"', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 11:02:26,931 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 1500 kamas.',
      ]);
      const purchases = stats.purchaseHistory();
      expect(purchases).toHaveLength(1);
      expect(purchases[0]).toMatchObject({
        item: HDV_KAMAS_SALE_ITEM,
        catalogId: null,
        quantity: 0,
        totalCost: 1500,
      });
      expect(stats.kamasEarned()).toBe(1500);
    });

    it('committe plusieurs récupérations HDV consécutives sans les mélanger', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 11:02:26,931 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 1500 kamas.',
        ' INFO 11:02:27,000 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 320 kamas.',
      ]);
      expect(stats.purchaseHistory().map((p) => p.totalCost)).toEqual([320, 1500]);
    });

    it("n'enregistre jamais un gain de kamas issu du butin de combat comme un achat (fight_multi-account_end_after-all-monsters-play.log)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_multi-account_end_after-all-monsters-play.log'));

      expect(stats.purchaseHistory().filter((p) => p.item === HDV_KAMAS_SALE_ITEM)).toHaveLength(0);
    });

    it("n'enregistre jamais un gain de kamas issu d'un échange comme un achat, quel que soit l'ordre des lignes (trade_3.log, trade_multi-account.log)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [...readFixture('trade_3.log'), ...readFixture('trade_multi-account.log')]);

      expect(stats.purchaseHistory().filter((p) => p.item === HDV_KAMAS_SALE_ITEM)).toHaveLength(0);
    });
  });

  describe('Historique Echanges (assets/logs/tests/fr/trade*.log)', () => {
    function withOumbraRoster(): void {
      const roster = TestBed.inject(CharacterRosterService);
      const accountId = roster.accounts()[0].id;
      roster.addCharacter(accountId, 'Oumbra', 'Sram', 'm');
    }

    it('attribue correctement acquis/cédés (trade.log, deux objets reçus contre un donné)', () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('trade.log'));

      const trades = stats.tradeHistory();
      expect(trades).toHaveLength(1);
      expect(trades[0].characterName).toBe('Suuke');
      expect(trades[0].acquired).toEqual([
        { name: 'Feuilluchon de Fortune', catalogId: null, quantity: 1 },
        { name: 'Havre-Gemme Marchande', catalogId: null, quantity: 1 },
      ]);
      expect(trades[0].given).toEqual([{ name: 'Poudre', catalogId: null, quantity: 1 }]);
    });

    it('gère un échange où le compte courant ne donne rien (trade_2.log)', () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('trade_2.log'));

      const trades = stats.tradeHistory();
      expect(trades).toHaveLength(1);
      expect(trades[0].characterName).toBe('Suuke');
      expect(trades[0].given).toEqual([]);
      expect(trades[0].acquired).toEqual([{ name: 'Poudre', catalogId: null, quantity: 1 }]);
    });

    it('gère un échange incluant des kamas côté partenaire (trade_3.log)', () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('trade_3.log'));

      const trades = stats.tradeHistory();
      expect(trades).toHaveLength(1);
      expect(trades[0].selfName).toBe('Oumbra');
      expect(trades[0].characterName).toBe('Briggitt');
      expect(trades[0].acquired).toEqual([
        { name: "Les Doigts d'Enutrof", catalogId: null, quantity: 1 },
      ]);
      expect(trades[0].kamasAcquired).toBe(10);
      expect(trades[0].kamasGiven).toBe(0);
      // Les 10 kamas gagnés sont comptés séparément (kamasEarned), en plus du détail sur le TradeRecord.
      expect(stats.kamasEarned()).toBe(10);
    });

    it('ne classe jamais un personnage du roster déclaré comme "characterName" (jamais Oumbra)', () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [...readFixture('trade.log'), ...readFixture('trade_3.log')]);

      const names = stats.tradeHistory().map((t) => t.characterName);
      expect(names).not.toContain('Oumbra');
    });

    it("ignore un échange entre deux personnages du roster déclaré (et non plus dès qu'un seul y figure)", () => {
      const roster = TestBed.inject(CharacterRosterService);
      const accountId = roster.accounts()[0].id;
      roster.addCharacter(accountId, 'Oumbra', 'Sram', 'm');
      roster.addCharacter(accountId, 'Suuke', 'Iop', 'm');
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('trade.log'));

      expect(stats.tradeHistory()).toHaveLength(0);
    });

    it('tolère des lignes de chat/multi-compte intercalées dans la négociation', () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      const lines = readFixture('trade.log');
      const noisyLines = [
        lines[0],
        ' INFO 11:20:34,000 [AWT-EventQueue-0] (aPV:174) - [Proximité] AutreCompte : coucou',
        ...lines.slice(1),
      ];
      feed(access, noisyLines);
      expect(stats.tradeHistory()).toHaveLength(1);
    });

    it("n'enregistre l'échange qu'une seule fois quand le résumé final est réémis avec l'ordre des deux \"donne\" inversé (observation multi-compte, cas réel signalé)", () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 13:45:55,483 [AWT-EventQueue-0] (Sk:64) - [Trade] Starting an exchange between Oumbra (id=11039330) and Suuke (id=5749879)',
        ' INFO 13:46:13,009 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez perdu 20 kamas.',
        " INFO 13:46:13,009 [AWT-EventQueue-0] (buN:229) - [Trade] Fin de l'échange",
        ' INFO 13:46:13,012 [AWT-EventQueue-0] (buN:252) - [Trade] le joueur Suuke donne : 20K ; ',
        'le joueur Oumbra donne : 0K ; ',
        ' INFO 13:46:13,012 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 20 kamas.',
        " INFO 13:46:13,013 [AWT-EventQueue-0] (buN:229) - [Trade] Fin de l'échange",
        " INFO 13:46:13,013 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] L'échange s'est correctement terminé.",
        ' INFO 13:46:13,013 [AWT-EventQueue-0] (Sk:162) - [Trade] Ending the exchange between Oumbra (id=11039330) and Suuke (id=5749879)',
        ' INFO 13:46:13,014 [AWT-EventQueue-0] (buN:252) - [Trade] le joueur Oumbra donne : 0K ; ',
        'le joueur Suuke donne : 20K ; ',
        " INFO 13:46:13,015 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] L'échange s'est correctement terminé.",
        ' INFO 13:46:13,016 [AWT-EventQueue-0] (Sk:162) - [Trade] Ending the exchange between Oumbra (id=11039330) and Suuke (id=5749879)',
      ]);

      const trades = stats.tradeHistory();
      expect(trades).toHaveLength(1);
      expect(trades[0].kamasAcquired).toBe(20);
      expect(trades[0].kamasGiven).toBe(0);
      expect(trades[0].characterName).toBe('Suuke');
      expect(trades[0].selfName).toBe('Oumbra');
    });

    it('rejoue le cas réel signalé (deux échanges dans un log multi-compte bruyant) sans doublon (trade_multi-account.log)', () => {
      withOumbraRoster();
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('trade_multi-account.log'));

      const trades = stats.tradeHistory();
      expect(trades).toHaveLength(2);
      // Le plus récent en tête : l'échange de 13:48 (Oumbra donne 10K + Poudre) puis celui de 13:46 (Oumbra reçoit 20K).
      expect(trades[0].selfName).toBe('Oumbra');
      expect(trades[0].characterName).toBe('Suuke');
      expect(trades[0].kamasGiven).toBe(10);
      expect(trades[0].kamasAcquired).toBe(0);
      expect(trades[0].given).toEqual([{ name: 'Poudre', catalogId: null, quantity: 1 }]);
      expect(trades[0].acquired).toEqual([]);

      expect(trades[1].kamasAcquired).toBe(20);
      expect(trades[1].kamasGiven).toBe(0);
      expect(trades[1].given).toEqual([]);
      expect(trades[1].acquired).toEqual([]);
    });
  });

  describe('Combats (assets/logs/tests/fr/fight*.log)', () => {
    it('victoire simple compte solo : allies/enemies/loot/tours corrects (fight_single-account_end_after-all-monsters-play.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_single-account_end_after-all-monsters-play.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      const fight = fights[0];
      expect(fight.id).toBe(1616283520);
      expect(fight.result).toBe('won');
      // Tour = round-robin (voir registerFightTurn) : Larve Verte puis Larve Violette puis
      // Sagittarius Caecus jouent chacun une fois, le combat se termine avant qu'aucun ne rejoue —
      // le tour reste donc à 1, quel que soit le nombre de sorts lancés par chacun entre-temps.
      expect(fight.turns).toBe(1);
      const lootNames = fight.loot.map((l) => l.name).sort();
      expect(lootNames).toEqual(
        [
          'Bottes Larvesques Vaseuses',
          'Peau de Larve',
          'Peau de Nutellarve',
          'Perle',
          'Plâjeton',
        ].sort(),
      );
      expect(stats.combatsWon()).toBe(1);
      expect(stats.combatsLost()).toBe(0);
    });

    it('rattache les kamas gagnés pendant le combat au FightRecord (fight_multi-account_end_after-all-monsters-play.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_multi-account_end_after-all-monsters-play.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].kamas).toBe(4);
    });

    it("n'attribue aucun kama à un combat quand rien n'a été gagné (fight_single-account_end_after-all-monsters-play.log)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_single-account_end_after-all-monsters-play.log'));

      expect(stats.fightHistory()[0].kamas).toBe(0);
    });

    it(
      'utilise la date CALENDAIRE réelle du fichier (ligne d\'ancrage "build -1 [...]", voir ' +
        'LogDateAnchorEntry) plutôt que la date système du jour de lecture (bug réel : un combat ' +
        'consulté un autre jour que celui où il a eu lieu affichait systématiquement la date du ' +
        'jour de LECTURE au lieu de la date réelle du combat)',
      () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // Date système très différente de la date réelle du fichier (voir ligne d'ancrage
        // ci-dessous) : si le combat récupère malgré tout cette date système, le test échoue.
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        try {
          const stats = TestBed.inject(StatsStoreService);
          const access = TestBed.inject(LogFileAccessService);
          feed(access, [
            ' INFO 14:18:46,005 [main] (eEt:113) - 1.92 (build -1 [2026-08-20 @ 14H18min45])',
            ' INFO 15:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 15:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            ' INFO 15:00:10,000 [T] (a:1) - [FIGHT] End fight with id 1',
          ]);

          const fights = stats.fightHistory();
          expect(fights).toHaveLength(1);
          expect(fights[0].fullTimestampMs).toBe(new Date(2026, 7, 20, 15, 0, 0, 0).getTime());
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it(
      'inclut bien une entité dont le `obstacleId` de jointure diffère de -1 (contrairement à une ' +
        'hypothèse initiale fausse : vérifié sur un vrai fichier, la majorité des MONSTRES RÉELS ' +
        "d'un combat ont un obstacleId non -1, sans rapport avec leur nature de combattant — voir " +
        'CLAUDE.md, FIGHTER_JOIN_RE) — un ancien filtre sur ce champ faisait disparaître la majorité ' +
        'des ennemis de nombreux combats réels et a été retiré',
      () => {
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        access.newLines$.next({
          lines: [
            ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : 7 join the fight at {P}',
            // Sort effectivement lancé (pas juste une ligne de dégâts orpheline) : nécessaire depuis
            // le filtre de bruit "ennemi inconnu du référentiel + jamais touché" (voir
            // StatsStoreService.computeInertEnemyNoiseNames) pour que Bouftou soit bien reconnu
            // comme ayant encaissé des dégâts, sans quoi ce fixture minimal (catalogue non chargé
            // dans ce test) le ferait passer à tort pour du bruit décoratif et disparaître du récap
            // — sans rapport avec ce que ce test vérifie réellement (obstacleId).
            ' INFO 10:00:02,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
            ' INFO 10:00:02,500 [T] (a:1) - [Information (combat)] Bouftou: -40 PV (Terre)',
            ' INFO 10:00:10,000 [T] (a:1) - [FIGHT] End fight with id 1',
          ],
          isInitialLoad: true,
        });

        const fights = stats.fightHistory();
        expect(fights).toHaveLength(1);
        const names = fights[0].rows.map((r) => r.name);
        expect(names.sort()).toEqual(['Bouftou', 'Oumbra']);
      },
    );

    it(
      'traite une invocation (annonce "X: Invoque un(e) Y" suivie de sa jointure) comme un sort ' +
        'de son invocateur : jamais sa propre ligne dans le récap, ses dégâts crédités à ' +
        "l'invocateur avec le nom de l'invocation comme libellé de sort — voir CLAUDE.md",
      () => {
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        access.newLines$.next({
          lines: [
            ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Lapino',
            ' INFO 10:00:01,500 [T] (a:1) - [Information (combat)] Oumbra: Invoque un(e) Dark Lapino ',
            " INFO 10:00:01,510 [T] (eXG:1) - Instanciation d'une nouvelle invocation avec un id de 2",
            ' INFO 10:00:01,520 [T] (a:1) - [_FL_] fightId=1 Dark Lapino breed : 5528 [2] isControlledByAI=true obstacleId : 6 join the fight at {P}',
            ' INFO 10:00:02,000 [T] (a:1) - [Information (combat)] Dark Lapino lance le sort Griffe',
            ' INFO 10:00:02,500 [T] (a:1) - [Information (combat)] Bouftou: -40 PV (Terre)',
            ' INFO 10:00:10,000 [T] (a:1) - [FIGHT] End fight with id 1',
          ],
          isInitialLoad: true,
        });

        const fights = stats.fightHistory();
        expect(fights).toHaveLength(1);
        const names = fights[0].rows.map((r) => r.name);
        expect(names).not.toContain('Dark Lapino');
        expect(names.sort()).toEqual(['Bouftou', 'Oumbra']);
        const oumbra = fights[0].rows.find((r) => r.name === 'Oumbra')!;
        expect(oumbra.spells.map((s) => s.spell)).toContain('Dark Lapino');
        expect(oumbra.spells.find((s) => s.spell === 'Dark Lapino')!.total).toBe(40);
      },
    );

    it(
      "exclut du récap final un ennemi inconnu du référentiel qui n'a NI infligé NI encaissé le " +
        'moindre dégât sur tout le combat (bruit décoratif, ex. les invocations "Rocher" d\'un ' +
        'mécanisme de boss sans annonce "Invoque" détectable — voir CLAUDE.md/computeInertEnemyNoiseNames), ' +
        "tout en gardant un vrai combattant qui n'a fait qu'ENCAISSER des dégâts",
      () => {
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        access.newLines$.next({
          lines: [
            ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            // "Rocher" rejoint comme un vrai combattant IA (obstacleId non -1, comme dans le vrai
            // fichier ayant révélé le bug) mais n'agit jamais et n'est jamais visé individuellement.
            ' INFO 10:00:00,002 [T] (a:1) - [_FL_] fightId=1 Rocher breed : 5875 [3] isControlledByAI=true obstacleId : 8 join the fight at {P}',
            ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
            ' INFO 10:00:01,500 [T] (a:1) - [Information (combat)] Bouftou: -40 PV (Terre)',
            ' INFO 10:00:10,000 [T] (a:1) - [FIGHT] End fight with id 1',
          ],
          isInitialLoad: true,
        });

        const fights = stats.fightHistory();
        expect(fights).toHaveLength(1);
        const names = fights[0].rows.map((r) => r.name);
        expect(names).not.toContain('Rocher');
        expect(names.sort()).toEqual(['Bouftou', 'Oumbra']);
      },
    );

    it(
      "n'accorde jamais l'XP d'un combat concurrent à un personnage qui n'a pas rejoint CE combat " +
        '(même garde-fou que pour les dégâts/allié-ennemi)',
      () => {
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        access.newLines$.next({
          lines: [
            ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:05,000 [T] (a:1) - [_FL_] fightId=2 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:05,001 [T] (a:1) - [_FL_] fightId=2 Bwork breed : 9 [-2] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            // "Caliburnus" n'a jamais rejoint le combat 1 : son XP ne doit jamais y apparaître,
            // même si le fightId résolu par erreur pointait dessus (repli sur le dernier combat
            // courant, nom ambigu...).
            " INFO 10:00:06,000 [T] (a:1) - [Information (combat)] Caliburnus : +100 points d'XP. ",
            " INFO 10:00:07,000 [T] (a:1) - [Information (combat)] Oumbra : +50 points d'XP. ",
            ' INFO 10:00:10,000 [T] (a:1) - [FIGHT] End fight with id 1',
            ' INFO 10:00:11,000 [T] (a:1) - [FIGHT] End fight with id 2',
          ],
          isInitialLoad: true,
        });

        const fights = stats.fightHistory();
        const fight1 = fights.find((f) => f.id === 1);
        expect(fight1).toBeTruthy();
        expect(fight1!.xp.map((x) => x.name)).toEqual(['Oumbra']);
      },
    );

    it(
      "n'attribue jamais au combat suivant le butin resté en attente d'un combat-end reçu SANS " +
        "combat connu (ex. combat déjà en cours à l'ouverture du fichier, dont les lignes de " +
        "jointure sont antérieures au début du log lu) — bug réel : butin d'un combat totalement " +
        'sans rapport, jamais suivi par cette session, affiché sous le combat réel suivant',
      () => {
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        access.newLines$.next({
          lines: [
            ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            // Butin ramassé pendant que le combat 1 (le seul combat SUIVI) est actif — le parser
            // l'y rattache par défaut, mais il appartient en réalité à un combat 999 jamais vu
            // rejoindre (jointure antérieure au début de ce log).
            ' INFO 10:00:05,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Objet Fantome .',
            ' INFO 10:00:05,500 [T] (a:1) - [FIGHT] End fight with id 999',
            // Butin du VRAI combat 1, ramassé juste avant sa propre fin.
            ' INFO 10:00:09,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Peau de Bouftou .',
            ' INFO 10:00:10,000 [T] (a:1) - [FIGHT] End fight with id 1',
          ],
          isInitialLoad: true,
        });

        const fights = stats.fightHistory();
        expect(fights).toHaveLength(1);
        const lootNames = fights[0].loot.map((l) => l.name);
        expect(lootNames).toEqual(['Peau de Bouftou']);
        expect(lootNames).not.toContain('Objet Fantome');
      },
    );

    it(
      "sépare correctement le butin de deux combats concurrents dont l'activité s'entrelace " +
        "(bug réel signalé : butin d'un donjon affiché sous le combat d'un AUTRE donjon tournant " +
        'en parallèle) — chaque butin reste collé à la fin du combat qui le précède immédiatement',
      () => {
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        access.newLines$.next({
          lines: [
            ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Bouftou breed : 1 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:05,000 [T] (a:1) - [_FL_] fightId=2 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
            ' INFO 10:00:05,001 [T] (a:1) - [_FL_] fightId=2 Bwork breed : 9 [-2] isControlledByAI=true obstacleId : -1 join the fight at {P}',
            // Butin du combat 2, ramassé (et le combat clos) alors que le combat 1 tourne toujours.
            ' INFO 10:00:06,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Dent de Bwork .',
            ' INFO 10:00:06,500 [T] (a:1) - [FIGHT] End fight with id 2',
            // Butin du combat 1, ramassé juste avant sa propre fin — bien après celle du combat 2.
            ' INFO 10:00:20,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Peau de Bouftou .',
            ' INFO 10:00:21,000 [T] (a:1) - [FIGHT] End fight with id 1',
          ],
          isInitialLoad: true,
        });

        const fights = stats.fightHistory();
        const fight1 = fights.find((f) => f.id === 1);
        const fight2 = fights.find((f) => f.id === 2);
        expect(fight1!.loot.map((l) => l.name)).toEqual(['Peau de Bouftou']);
        expect(fight2!.loot.map((l) => l.name)).toEqual(['Dent de Bwork']);
      },
    );

    it('défaite compte solo (fight_single-account_lost.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_single-account_lost.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].result).toBe('lost');
      expect(stats.combatsLost()).toBe(1);
    });

    it('abandon de combat compte solo compté comme une défaite malgré l\'absence de "vaincu(e)" (fight_single-account_give-up.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_single-account_give-up.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].result).toBe('lost');
    });

    it('deux combats strictement concurrents (fightId différents) restent isolés (fight_multi-account_twice-fight-simultaneously.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_multi-account_twice-fight-simultaneously.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(2);
      const ids = fights.map((f) => f.id).sort();
      expect(ids).toEqual([1584117474, 1584117475]);
      // Bug historique : le second "CREATION DU COMBAT" concluait à tort le premier combat en "won"
      // avant même sa vraie fin. Les deux combats doivent chacun avoir des dégâts non vides.
      for (const fight of fights) {
        expect(fight.rows.length).toBeGreaterThan(0);
      }
      expect(stats.combatsWon()).toBe(2);
    });

    it("n'attribue jamais un achat (perte de kamas + ramassage immédiat) au butin de combat, même si un combat est actif au même moment (cas réel multi-compte : achat sur un compte pendant qu'un autre combat)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
        // Achat détecté (perte de kamas suivie de très près d'un ramassage) alors qu'un combat
        // est en cours : ne doit apparaître ni dans le butin du combat ni dans le butin de
        // session, seulement dans l'historique des achats.
        ' INFO 10:00:05,000 [T] (a:1) - [Information (jeu)] Vous avez perdu 500 kamas.',
        ' INFO 10:00:05,100 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Pain Complet .',
        // Vrai butin de combat (pas précédé d'une perte de kamas) : doit rester compté.
        ' INFO 10:00:10,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 2x Laine de Bouftou .',
        ' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 1',
      ]);
      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].loot).toEqual([{ name: 'Laine de Bouftou', catalogId: null, quantity: 2 }]);
      expect(stats.sessionLoot().map((l) => l.name)).toEqual(['Laine de Bouftou']);
      expect(stats.purchaseHistory()).toHaveLength(1);
      expect(stats.purchaseHistory()[0].item).toBe('Pain Complet');
    });

    it("exclut du butin de combat TOUT ramassage survenant pendant une session marchand/HDV ouverte, même sans perte de kamas juste avant (achat groupé — cas réel : plusieurs unités achetées à la suite à l'Hôtel des ventes pendant qu'un combat est actif)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
        " INFO 10:00:05,000 [T] (a:1) - Lancement de l'occupation MARKET sur la board [bDk id=1]{P}",
        // Premier achat : perte de kamas immédiatement suivie du ramassage (prix connu).
        ' INFO 10:00:06,000 [T] (a:1) - [Information (jeu)] Vous avez perdu 1 000 kamas.',
        ' INFO 10:00:06,001 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Baguette du Mage Rouge .',
        // Ramassages suivants du même achat groupé, SANS perte de kamas adjacente (plus de 2s
        // d'écart avec la dernière perte, ou aucune perte du tout) : doivent quand même être
        // exclus du butin de combat car la session marchand est toujours ouverte.
        ' INFO 10:00:15,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Baguette du Mage Rouge .',
        ' INFO 10:00:16,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Baguette du Mage Rouge .',
        " INFO 10:00:17,000 [T] (a:1) - On arrête l'occupation MARKET sur la board [bDk id=1]{P}",
        // Vrai butin de combat, ramassé après la fermeture de la session marchand : doit rester compté.
        ' INFO 10:00:20,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 2x Laine de Bouftou .',
        ' INFO 10:00:30,000 [T] (a:1) - [FIGHT] End fight with id 1',
      ]);
      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].loot).toEqual([{ name: 'Laine de Bouftou', catalogId: null, quantity: 2 }]);
      expect(stats.sessionLoot().map((l) => l.name)).toEqual(['Laine de Bouftou']);
      // Seul le ramassage au prix connu (perte de kamas adjacente) devient un achat identifiable.
      expect(stats.purchaseHistory()).toHaveLength(1);
      expect(stats.purchaseHistory()[0].item).toBe('Baguette du Mage Rouge');
      expect(stats.purchaseHistory()[0].quantity).toBe(1);
    });

    it('expose les combats actifs pour les onglets et permet de choisir lequel afficher', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);

      // Deux combats démarrent (fightId 1 puis 2), tous deux encore en cours.
      feed(access, [
        ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:05,000 [T] (a:1) - [_FL_] fightId=2 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:05,001 [T] (a:1) - [_FL_] fightId=2 Chafer breed : 4742 [-2] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ]);

      expect(stats.activeFightIds()).toEqual([1, 2]);
      // Suivi automatique : le dernier combat touché (2, le plus récent).
      expect(stats.displayedFightId()).toBe(2);
      expect(
        stats
          .damageByAttacker()
          .map((r) => r.name)
          .sort(),
      ).toEqual(['Caliburnus', 'Chafer']);

      // L'utilisateur choisit explicitement l'onglet du combat 1.
      stats.selectDisplayedFight(1);
      expect(stats.displayedFightId()).toBe(1);
      expect(
        stats
          .damageByAttacker()
          .map((r) => r.name)
          .sort(),
      ).toEqual(['Blop', 'Oumbra']);

      // De nouvelles lignes touchant le combat 2 ne doivent pas faire perdre le choix explicite.
      feedMore(access, [
        ' INFO 10:00:10,000 [T] (a:1) - [Information (combat)] Caliburnus lance le sort Frappe',
        ' INFO 10:00:10,500 [T] (a:1) - [Information (combat)] Chafer: -100 PV (Terre)',
      ]);
      expect(stats.displayedFightId()).toBe(1);

      // Le combat 1 se termine : le choix explicite n'est plus valide, retour au suivi automatique (combat 2).
      feedMore(access, [' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 1']);
      expect(stats.activeFightIds()).toEqual([2]);
      expect(stats.displayedFightId()).toBe(2);
    });

    it("rejoue le cas réel signalé : le butin de fin de combat n'est plus perdu quand un combat concurrent vient de se terminer sans ligne à nom résolvable entre les deux (fight_multi-account_loot-after-concurrent-end.log)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_multi-account_loot-after-concurrent-end.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(4);

      // Combat 1616298256 (Bouftou) : son butin arrive juste après la fin du combat concurrent
      // 1616298253 (Piou), sans qu'aucune ligne à nom résolvable ne s'intercale — c'était le cas cassé.
      const bouftouFight = fights.find((f) => f.id === 1616298256);
      expect(bouftouFight).toBeTruthy();
      const bouftouLoot = new Map(bouftouFight!.loot.map((l) => [l.name, l.quantity]));
      expect(bouftouLoot.get('Peau de Bouftou')).toBe(19);
      expect(bouftouLoot.get('Amulette du Bouftou')).toBe(3);
      expect(bouftouLoot.get('Boufmarteau')).toBe(1);
      expect(bouftouLoot.get('Corne de Bouftou')).toBe(1);
      expect(bouftouLoot.get('Havre-Gemme Marchande')).toBe(1);

      // Le combat concurrent (Piou) garde bien son propre butin, non mélangé avec celui du Bouftou.
      const piouFight = fights.find((f) => f.id === 1616298253);
      expect(piouFight).toBeTruthy();
      const piouLootNames = piouFight!.loot.map((l) => l.name);
      expect(piouLootNames).not.toContain('Peau de Bouftou');
      expect(piouLootNames).toContain('Bec de Piou');
    });

    it("combat multi-compte perdu : les dégâts dupliqués par les deux comptes ne sont comptés qu'une fois (fight_multi-account_lost.log)", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_multi-account_lost.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].result).toBe('lost');
      // "Ebenus Sagittarius: -1 058 PV (Feu)" apparaît deux fois consécutives (doublon d'observation
      // multi-compte) : un comptage naïf doublerait ce total.
      const ebenus = fights[0].rows.find((r) => r.name === 'Ebenus Sagittarius');
      expect(ebenus).toBeTruthy();
      const feuSpell = ebenus!.spells.find((s) => (s.byElement as Record<string, number>)['Feu']);
      expect(feuSpell?.byElement.Feu).toBeLessThan(20000);
    });

    it('combat multi-compte abandonné : compté comme défaite (fight_multi-account_give-up.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_multi-account_give-up.log'));

      const fights = stats.fightHistory();
      expect(fights).toHaveLength(1);
      expect(fights[0].result).toBe('lost');
      // Doublons de jointure (deux "CREATION DU COMBAT" pour le même fightId) : chaque allié n'apparaît qu'une fois.
      const names = fights[0].rows.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('combat encore en cours (pas de marqueur de fin) alimente la vue "combat en cours" sans apparaître dans l\'historique (fight_single-account_end_before-monsters-play.log)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, readFixture('fight_single-account_end_before-monsters-play.log'));

      expect(stats.fightHistory()).toHaveLength(0);
      expect(stats.damageByAttacker().length).toBeGreaterThan(0);
    });
  });

  describe('Ventilation des dégâts par tour (SpellBreakdownRow.byTurn, switch Total/Tour)', () => {
    it('ventile chaque sort par tour de jeu, sans altérer son total cumulé', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,002 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
        // Tour 1 : Oumbra puis Caliburnus jouent chacun une fois (round-robin, voir registerFightTurn).
        ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
        ' INFO 10:00:01,500 [T] (a:1) - [Information (combat)] Blop: -100 PV (Terre)',
        ' INFO 10:00:02,000 [T] (a:1) - [Information (combat)] Caliburnus lance le sort Tacle',
        ' INFO 10:00:02,500 [T] (a:1) - [Information (combat)] Blop: -50 PV (Terre)',
        // Tour 2 : Oumbra rejoue (le siège a déjà joué ce tour-ci => bascule au tour suivant).
        ' INFO 10:00:03,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
        ' INFO 10:00:03,500 [T] (a:1) - [Information (combat)] Blop: -30 PV (Terre)',
        ' INFO 10:00:04,000 [T] (a:1) - [Information (combat)] Caliburnus lance le sort Tacle',
        ' INFO 10:00:04,500 [T] (a:1) - [Information (combat)] Blop: -20 PV (Terre)',
        ' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 1',
      ]);

      const fight = stats.fightHistory().find((f) => f.id === 1)!;
      expect(fight.turns).toBe(2);

      const oumbraFrappe = fight.rows
        .find((r) => r.name === 'Oumbra')!
        .spells.find((s) => s.spell === 'Frappe')!;
      expect(oumbraFrappe.total).toBe(130);
      // Le total cumulé reste la somme de tous les tours, jamais recalculé depuis byTurn.
      expect(oumbraFrappe.byTurn.reduce((sum, t) => sum + t.total, 0)).toBe(oumbraFrappe.total);
      expect(oumbraFrappe.byTurn).toEqual([
        { turn: 1, total: 100, byElement: { Terre: 100 } },
        { turn: 2, total: 30, byElement: { Terre: 30 } },
      ]);

      const caliburnusTacle = fight.rows
        .find((r) => r.name === 'Caliburnus')!
        .spells.find((s) => s.spell === 'Tacle')!;
      expect(caliburnusTacle.total).toBe(70);
      expect(caliburnusTacle.byTurn).toEqual([
        { turn: 1, total: 50, byElement: { Terre: 50 } },
        { turn: 2, total: 20, byElement: { Terre: 20 } },
      ]);
    });

    it('une réattribution de sort fusionne les ventilations par tour des deux côtés (tour commun cumulé, tour propre à la source ajouté tel quel)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, [
        ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,002 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
        // Tour 1 : Oumbra ET Caliburnus font chacun un "Frappe" (attribution automatique erronée
        // côté Oumbra, à corriger). Tour 2 : seul Oumbra en refait un.
        ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
        ' INFO 10:00:01,500 [T] (a:1) - [Information (combat)] Blop: -40 PV (Terre)',
        ' INFO 10:00:02,000 [T] (a:1) - [Information (combat)] Caliburnus lance le sort Frappe',
        ' INFO 10:00:02,500 [T] (a:1) - [Information (combat)] Blop: -25 PV (Terre)',
        ' INFO 10:00:03,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
        ' INFO 10:00:03,500 [T] (a:1) - [Information (combat)] Blop: -10 PV (Terre)',
        ' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 1',
      ]);

      const beforeFight = stats.fightHistory().find((f) => f.id === 1)!;
      expect(beforeFight.turns).toBe(2);

      stats.reassignSpell(
        1,
        'Frappe',
        { name: 'Oumbra', instanceIndex: 1 },
        { name: 'Caliburnus', instanceIndex: 1 },
      );

      const fight = stats.fightHistory().find((f) => f.id === 1)!;
      expect(fight.rows.find((r) => r.name === 'Oumbra')!.spells).toHaveLength(0);
      const caliburnusFrappe = fight.rows
        .find((r) => r.name === 'Caliburnus')!
        .spells.find((s) => s.spell === 'Frappe')!;
      expect(caliburnusFrappe.total).toBe(75);
      expect(caliburnusFrappe.byTurn).toEqual([
        { turn: 1, total: 65, byElement: { Terre: 65 } },
        { turn: 2, total: 10, byElement: { Terre: 10 } },
      ]);
    });
  });

  describe('Réattribution de dégâts : persistance entre (re)connexions (voir CLAUDE.md, gating isInitialLoad)', () => {
    const lines = [
      ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:00,002 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
      ' INFO 10:00:01,500 [T] (a:1) - [Information (combat)] Blop: -100 PV (Terre)',
      ' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 1',
    ];

    it('une réattribution manuelle reste appliquée après une (re)connexion complète (nouvelle instance du service, relecture localStorage)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, lines);

      const fight = stats.fightHistory().find((f) => f.id === 1)!;
      expect(fight.rows.find((r) => r.name === 'Oumbra')!.spells.map((s) => s.spell)).toContain(
        'Frappe',
      );

      stats.reassignSpell(
        1,
        'Frappe',
        { name: 'Oumbra', instanceIndex: 1 },
        { name: 'Caliburnus', instanceIndex: 1 },
      );
      const afterReassign = stats.fightHistory().find((f) => f.id === 1)!;
      expect(afterReassign.rows.find((r) => r.name === 'Oumbra')!.spells).toHaveLength(0);
      expect(
        afterReassign.rows.find((r) => r.name === 'Caliburnus')!.spells.map((s) => s.spell),
      ).toContain('Frappe');

      // Simule un F5/rechargement : nouvelle instance du service (pas seulement un nouveau lot de
      // lignes sur l'instance existante), qui doit recharger le journal des réattributions depuis
      // localStorage à la construction et le rejouer après le lot initial.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const reloadedStats = TestBed.inject(StatsStoreService);
      const reloadedAccess = TestBed.inject(LogFileAccessService);
      feed(reloadedAccess, lines);

      const reloadedFight = reloadedStats.fightHistory().find((f) => f.id === 1)!;
      expect(reloadedFight.rows.find((r) => r.name === 'Oumbra')!.spells).toHaveLength(0);
      expect(
        reloadedFight.rows.find((r) => r.name === 'Caliburnus')!.spells.map((s) => s.spell),
      ).toContain('Frappe');
    });

    it('resetStats() efface aussi le journal des réattributions persistées', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      feed(access, lines);
      stats.reassignSpell(
        1,
        'Frappe',
        { name: 'Oumbra', instanceIndex: 1 },
        { name: 'Caliburnus', instanceIndex: 1 },
      );
      stats.resetStats();

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const reloadedStats = TestBed.inject(StatsStoreService);
      const reloadedAccess = TestBed.inject(LogFileAccessService);
      feed(reloadedAccess, lines);

      // Sans correction rejouée, l'attribution automatique d'origine (Oumbra) est restaurée.
      const reloadedFight = reloadedStats.fightHistory().find((f) => f.id === 1)!;
      expect(
        reloadedFight.rows.find((r) => r.name === 'Oumbra')!.spells.map((s) => s.spell),
      ).toContain('Frappe');
    });
  });

  describe('Robustesse : tous les jeux de test se parsent sans erreur', () => {
    it('ingère chaque fichier fight*.log/trade*.log/purchase*.log sans exception', () => {
      for (const file of readdirSync(FIXTURES_DIR)) {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({});
        const stats = TestBed.inject(StatsStoreService);
        const access = TestBed.inject(LogFileAccessService);
        expect(() => feed(access, readFixture(file)), file).not.toThrow();
        void stats;
      }
    });
  });

  describe('Suivi (watchlist) : mode décompte', () => {
    it("une entrée nouvellement suivie démarre en mode 'up' (comportement historique inchangé)", () => {
      const stats = TestBed.inject(StatsStoreService);
      stats.addWatchedItem('Laine de Bouftou');

      const entry = stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!;
      expect(entry.mode).toBe('up');
      expect(entry.count).toBe(0);
    });

    it("basculer en mode 'down' initialise le compteur à countdownTarget (fixé via setWatchlistCountdownTarget)", () => {
      const stats = TestBed.inject(StatsStoreService);
      stats.addWatchedItem('Laine de Bouftou');
      stats.setWatchlistCountdownTarget('Laine de Bouftou', 5);
      stats.setWatchlistMode('Laine de Bouftou', 'down');

      const entry = stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!;
      expect(entry.mode).toBe('down');
      expect(entry.count).toBe(5);
      expect(entry.countdownTarget).toBe(5);
    });

    it("un ramassage décrémente le compteur en mode 'down' au lieu de l'incrémenter", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      stats.addWatchedItem('Laine de Bouftou');
      stats.setWatchlistCountdownTarget('Laine de Bouftou', 5);
      stats.setWatchlistMode('Laine de Bouftou', 'down');

      // isInitialLoad=false : simule un ramassage après une connexion déjà active (voir
      // gating isInitialLoad, CLAUDE.md) — `feed` (isInitialLoad=true) ne doit rien décrémenter.
      feedMore(access, [
        'INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 2x Laine de Bouftou.',
      ]);

      const entry = stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!;
      expect(entry.count).toBe(3);
    });

    it("déclenche l'alerte (LootAlertService, reason 'countdown') exactement quand le compteur atteint 0, jamais en dessous", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      const lootAlert = TestBed.inject(LootAlertService);
      stats.addWatchedItem('Laine de Bouftou');
      stats.setWatchlistCountdownTarget('Laine de Bouftou', 2);
      stats.setWatchlistMode('Laine de Bouftou', 'down');

      feed(access, [
        'INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 1x Laine de Bouftou.',
      ]);
      expect(lootAlert.current()).toBeNull();

      feedMore(access, [
        'INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 1x Laine de Bouftou.',
        'INFO 12:00:01,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 1x Laine de Bouftou.',
      ]);

      expect(stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!.count).toBe(0);
      expect(lootAlert.current()).toEqual({
        name: 'Laine de Bouftou',
        quantity: 0,
        kind: 'item',
        reason: 'countdown',
        id: null,
      });
    });

    it("resetWatchedCount restaure countdownTarget (pas 0) pour une entrée en mode 'down'", () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      stats.addWatchedItem('Laine de Bouftou');
      stats.setWatchlistCountdownTarget('Laine de Bouftou', 3);
      stats.setWatchlistMode('Laine de Bouftou', 'down');
      feedMore(access, [
        'INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 2x Laine de Bouftou.',
      ]);
      expect(stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!.count).toBe(1);

      stats.resetWatchedCount('Laine de Bouftou');

      expect(stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!.count).toBe(3);
    });

    it('le contenu déjà présent au premier chargement (isInitialLoad) ne décrémente pas le compteur', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      stats.addWatchedItem('Laine de Bouftou');
      stats.setWatchlistCountdownTarget('Laine de Bouftou', 5);
      stats.setWatchlistMode('Laine de Bouftou', 'down');

      feed(access, [
        'INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 2x Laine de Bouftou.',
      ]);

      expect(stats.watchlist().find((w) => w.name === 'Laine de Bouftou')!.count).toBe(5);
    });
  });

  describe('Suivi (watchlist) : homonymes distingués par catalogId', () => {
    it('deux entrées de même nom mais d\'id différent coexistent (ex. les deux "Larme d\'Ogrest")', () => {
      const stats = TestBed.inject(StatsStoreService);
      stats.addWatchedItem("Larme d'Ogrest", 24029);
      stats.addWatchedItem("Larme d'Ogrest", 21602);

      const matches = stats.watchlist().filter((w) => w.name === "Larme d'Ogrest");
      expect(matches).toHaveLength(2);
      expect(matches.map((w) => w.catalogId).sort()).toEqual([21602, 24029]);
    });

    it('refuse un vrai doublon (même id) mais accepte un id différent', () => {
      const stats = TestBed.inject(StatsStoreService);
      stats.addWatchedItem("Larme d'Ogrest", 24029);
      stats.addWatchedItem("Larme d'Ogrest", 24029); // même id : refusé
      stats.addWatchedItem("Larme d'Ogrest", 21602); // id différent : accepté

      expect(stats.watchlist().filter((w) => w.name === "Larme d'Ogrest")).toHaveLength(2);
    });

    it('supprimer une entrée par (nom, catalogId) ne retire pas son homonyme', () => {
      const stats = TestBed.inject(StatsStoreService);
      stats.addWatchedItem("Larme d'Ogrest", 24029);
      stats.addWatchedItem("Larme d'Ogrest", 21602);

      stats.removeWatched("Larme d'Ogrest", 24029);

      const remaining = stats.watchlist().filter((w) => w.name === "Larme d'Ogrest");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].catalogId).toBe(21602);
    });

    it('un ramassage crédite toutes les entrées homonymes (le log ne permet pas de les distinguer)', () => {
      const stats = TestBed.inject(StatsStoreService);
      const access = TestBed.inject(LogFileAccessService);
      stats.addWatchedItem("Larme d'Ogrest", 24029);
      stats.addWatchedItem("Larme d'Ogrest", 21602);

      feedMore(access, [
        "INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 1x Larme d'Ogrest.",
      ]);

      const matches = stats.watchlist().filter((w) => w.name === "Larme d'Ogrest");
      expect(matches.every((w) => w.count === 1)).toBe(true);
    });

    it('removeWatched sans catalogId (repli historique) retire toutes les entrées de ce nom', () => {
      const stats = TestBed.inject(StatsStoreService);
      stats.addWatchedItem("Larme d'Ogrest", 24029);
      stats.addWatchedItem("Larme d'Ogrest", 21602);

      stats.removeWatched("Larme d'Ogrest");

      expect(stats.watchlist().filter((w) => w.name === "Larme d'Ogrest")).toHaveLength(0);
    });
  });

  /**
   * Test exigé sans ambiguïté par le prompt 8.1 : « rejouer deux fois le même
   * lot de lignes de log produit exactement le même nombre d'enregistrements
   * côté serveur. Un test qui ne couvre pas ce cas ne vaut rien ici. »
   *
   * Le faux serveur ci-dessous reproduit la seule chose qui compte du vrai :
   * `UNIQUE (user_id, client_key)` + `INSERT ... ON CONFLICT DO NOTHING`. Si la
   * clé déterministe (core/sync/) cesse d'être déterministe, le compte de
   * lignes double et le test tombe.
   */
  describe("Envoi de l'historique au compte : idempotence (lot 8)", () => {
    /**
     * Reproduit le comportement du vrai serveur : `UNIQUE (user_id,
     * client_key)` + `ON CONFLICT DO NOTHING` sur la ligne d'événement, mais
     * `ON CONFLICT DO UPDATE` sur le détail d'un combat (`fight_participants`)
     * — c'est ce qui permet à une réattribution manuelle de remonter au compte
     * sans créer de seconde ligne.
     */
    class FakeHistoryServer {
      private readonly tables = new Map<string, Map<string, Record<string, unknown>>>();
      /** Nombre de lignes réellement insérées, par requête reçue — 0 signifie « tout était déjà là ». */
      readonly insertedPerRequest: number[] = [];

      ingest(path: string, entries: { clientKey: string }[]): number {
        const table = this.tables.get(path) ?? new Map<string, Record<string, unknown>>();
        this.tables.set(path, table);
        let inserted = 0;
        for (const entry of entries) {
          const existing = table.get(entry.clientKey);
          if (existing) {
            // Seul le détail se rafraîchit ; l'événement lui-même est immuable.
            const refreshed = entry as unknown as Record<string, unknown>;
            existing['participants'] = refreshed['participants'];
            continue;
          }
          table.set(entry.clientKey, entry as unknown as Record<string, unknown>);
          inserted += 1;
        }
        this.insertedPerRequest.push(inserted);
        return inserted;
      }

      rowCount(path: string): number {
        return this.tables.get(path)?.size ?? 0;
      }

      row(path: string, index = 0): Record<string, unknown> | undefined {
        return [...(this.tables.get(path)?.values() ?? [])][index];
      }

      totals(): { fights: number; purchases: number; trades: number } {
        return {
          fights: this.rowCount('/history/fights'),
          purchases: this.rowCount('/history/purchases'),
          trades: this.rowCount('/history/trades'),
        };
      }
    }

    function configureWithServer(server: FakeHistoryServer): void {
      const api: Partial<ApiClientService> = {
        setUnauthorizedHandler: () => undefined,
        // Aucun GET n'a de sens ici (catalogue, serveurs de jeu) : le mode
        // hors-ligne est la réponse la plus neutre possible.
        getJson: async () => ({ ok: false, error: { kind: 'offline' } }) as ApiResult<never>,
        requestJson: async <T>(
          path: string,
          options: { method: string; body?: unknown },
        ): Promise<ApiResult<T>> => {
          const entries = (options.body as { entries?: { clientKey: string }[] })?.entries ?? [];
          const inserted = server.ingest(path, entries);
          return {
            ok: true,
            data: { accepted: entries.map((e) => e.clientKey), inserted } as T,
          };
        },
      };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    }

    /** Un jeu de lignes couvrant les trois types d'historique d'un coup. */
    const lines = [
      ...readFixture('fight_single-account_end_after-all-monsters-play.log'),
      ...readFixture('purchase.log'),
      ...readFixture('trade.log'),
    ];

    function declareRoster(): void {
      const roster = TestBed.inject(CharacterRosterService);
      roster.addCharacter(roster.accounts()[0].id, 'Oumbra', 'Sram', 'm');
    }

    async function replayOnce(server: FakeHistoryServer): Promise<void> {
      const stats = TestBed.inject(StatsStoreService);
      const sync = TestBed.inject(HistorySyncService);
      await sync.enable('utilisateur-de-test');
      feed(TestBed.inject(LogFileAccessService), lines);
      await sync.flush();
      void stats;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejouer deux fois le même lot de lignes produit exactement le même nombre d'enregistrements côté serveur", async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();

      await replayOnce(server);
      const afterFirst = server.totals();
      expect(afterFirst.fights).toBeGreaterThan(0);
      expect(afterFirst.purchases).toBeGreaterThan(0);
      expect(afterFirst.trades).toBeGreaterThan(0);

      // Une (re)connexion relit tout le fichier depuis le début et reconstruit
      // l'historique complet (principe d'architecture n°2, CLAUDE.md) : tout
      // repart au serveur, qui ne doit pourtant rien insérer de plus.
      const sync = TestBed.inject(HistorySyncService);
      feed(TestBed.inject(LogFileAccessService), lines);
      await sync.flush();

      expect(server.totals()).toEqual(afterFirst);
      // Et la preuve que c'est bien l'idempotence qui joue, pas un envoi
      // silencieusement sauté : le second envoi a bien eu lieu, sans rien insérer.
      expect(server.insertedPerRequest.at(-1)).toBe(0);
    });

    it("un rechargement complet de l'application (nouvelle instance des services) ne recrée aucun doublon", async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();
      await replayOnce(server);
      const afterFirst = server.totals();

      // F5 : tous les services repartent de zéro, seul le stockage local persiste.
      configureWithServer(server);
      await replayOnce(server);

      expect(server.totals()).toEqual(afterFirst);
    });

    it('relire le même fichier un autre jour ne recrée aucun doublon (la clé ignore la date système)', async () => {
      // Le jeu de lignes ci-dessus ne contient pas la ligne d'ancrage de date réelle du fichier
      // (voir LogDateAnchorEntry) : StatsStoreService retombe donc sur son ancien repli, la date du
      // jour de LECTURE. Si cette date entrait dans la clé déterministe, un fichier encore ouvert le
      // lendemain réenverrait tout en double — d'où une signature bâtie sur la seule heure du log
      // (voir history-event.model.ts), qu'une date d'ancrage soit disponible ou non.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-11T22:00:00Z'));

      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();
      await replayOnce(server);
      const afterFirst = server.totals();

      vi.setSystemTime(new Date('2026-08-12T09:00:00Z'));
      configureWithServer(server);
      await replayOnce(server);

      expect(server.totals()).toEqual(afterFirst);
    });

    it('en mode invité, aucun historique ne part vers le serveur', async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();

      // Pas d'appel à `enable()` : c'est exactement la définition du mode
      // invité — aucune donnée ne quitte l'appareil.
      TestBed.inject(StatsStoreService);
      feed(TestBed.inject(LogFileAccessService), lines);
      await TestBed.inject(HistorySyncService).flush();

      expect(server.totals()).toEqual({ fights: 0, purchases: 0, trades: 0 });
      expect(server.insertedPerRequest).toEqual([]);
    });

    it('envoie la ventilation par sort (et par élément) ainsi que le butin du combat', async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();
      await replayOnce(server);

      const fight = server.row('/history/fights') as {
        participants: {
          name: string;
          damage: number;
          spells: { spell: string; total: number; byElement: Record<string, number> }[];
        }[];
        loot: { itemName: string; quantity: number }[];
      };

      const attaquant = fight.participants.find((p) => p.spells.length > 0);
      expect(attaquant, 'au moins un participant doit porter sa ventilation').toBeDefined();
      expect(attaquant!.spells[0].spell).toBeTruthy();
      // La ventilation par sort doit rendre compte du total de la ligne.
      expect(attaquant!.spells.reduce((sum, s) => sum + s.total, 0)).toBe(attaquant!.damage);
      // Et chaque sort porte sa répartition par élément (Terre, Feu, ...).
      expect(Object.keys(attaquant!.spells[0].byElement).length).toBeGreaterThan(0);
      // Le butin du combat part avec lui (fixture : combat gagné avec ramassage).
      expect(fight.loot.length).toBeGreaterThan(0);
      expect(fight.loot[0].quantity).toBeGreaterThan(0);
    });

    it('envoie les kamas gagnés pendant le combat (kamasGained), pas null (fight_multi-account_end_after-all-monsters-play.log)', async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);

      const sync = TestBed.inject(HistorySyncService);
      TestBed.inject(StatsStoreService);
      await sync.enable('utilisateur-de-test');
      feed(
        TestBed.inject(LogFileAccessService),
        readFixture('fight_multi-account_end_after-all-monsters-play.log'),
      );
      await sync.flush();

      const fight = server.row('/history/fights') as { kamasGained: number };
      expect(fight.kamasGained).toBe(4);
    });

    it("envoie l'XP rattachée à chaque personnage, et non un simple total", async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();

      const sync = TestBed.inject(HistorySyncService);
      TestBed.inject(StatsStoreService);
      await sync.enable('utilisateur-de-test');
      feed(
        TestBed.inject(LogFileAccessService),
        readFixture('fight_multi-account_end_after-all-monsters-play.log'),
      );
      await sync.flush();

      const fight = server.row('/history/fights') as {
        xpGained: number;
        participants: { name: string; side: string; xpGained: number }[];
      };
      const beneficiaires = fight.participants.filter((p) => p.xpGained > 0);
      expect(beneficiaires.length).toBeGreaterThan(1);
      // Chaque bénéficiaire est nommé…
      expect(beneficiaires.every((p) => p.name.length > 0)).toBe(true);
      // …aucun ennemi n'en reçoit…
      expect(beneficiaires.every((p) => p.side === 'ally')).toBe(true);
      // …et la ventilation redonne exactement le total du combat.
      expect(beneficiaires.reduce((sum, p) => sum + p.xpGained, 0)).toBe(fight.xpGained);
    });

    it("tout bénéficiaire d'XP correspond à un participant du combat (tous les jeux de test)", () => {
      // C'est l'hypothèse qui autorise à rattacher l'XP au participant plutôt
      // qu'à une table dédiée : le log nomme le bénéficiaire exactement comme le
      // combattant. Si un jeu de test la prend en défaut un jour, la ventilation
      // perdrait cette ligne (le total du combat, lui, resterait juste).
      for (const file of readdirSync(FIXTURES_DIR).filter((name) => name.startsWith('fight'))) {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({});
        const stats = TestBed.inject(StatsStoreService);
        feed(TestBed.inject(LogFileAccessService), readFixture(file));

        for (const record of stats.fightHistory()) {
          const noms = new Set(record.rows.map((row) => row.name));
          for (const xp of record.xp) {
            expect(noms.has(xp.name), `${file} : ${xp.name} absent des participants`).toBe(true);
          }
        }
      }
    });

    it('une réattribution de dégâts renvoie le combat corrigé, sans créer de doublon', async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();

      const stats = TestBed.inject(StatsStoreService);
      const sync = TestBed.inject(HistorySyncService);
      await sync.enable('utilisateur-de-test');
      feed(TestBed.inject(LogFileAccessService), [
        ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:00,002 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
        ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
        ' INFO 10:00:01,500 [T] (a:1) - [Information (combat)] Blop: -100 PV (Terre)',
        ' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 1',
      ]);
      await sync.flush();

      const avant = server.row('/history/fights') as {
        participants: { name: string; damage: number; spells: { spell: string }[] }[];
      };
      expect(
        avant.participants.find((p) => p.name === 'Oumbra')!.spells.map((s) => s.spell),
      ).toEqual(['Frappe']);

      stats.reassignSpell(
        1,
        'Frappe',
        { name: 'Oumbra', instanceIndex: 1 },
        { name: 'Caliburnus', instanceIndex: 1 },
      );
      await sync.flush();

      // Toujours un seul combat archivé…
      expect(server.rowCount('/history/fights')).toBe(1);
      // …mais la correction a bien remonté.
      const apres = server.row('/history/fights') as {
        participants: { name: string; damage: number; spells: { spell: string }[] }[];
      };
      expect(apres.participants.find((p) => p.name === 'Oumbra')!.spells).toEqual([]);
      expect(
        apres.participants.find((p) => p.name === 'Caliburnus')!.spells.map((s) => s.spell),
      ).toEqual(['Frappe']);
    });

    it("une connexion survenue en cours de session envoie l'historique déjà reconstruit", async () => {
      const server = new FakeHistoryServer();
      configureWithServer(server);
      declareRoster();

      // Le fichier est lu AVANT toute connexion.
      TestBed.inject(StatsStoreService);
      feed(TestBed.inject(LogFileAccessService), lines);
      expect(server.totals()).toEqual({ fights: 0, purchases: 0, trades: 0 });

      const sync = TestBed.inject(HistorySyncService);
      await sync.enable('utilisateur-de-test');
      await sync.flush();

      const totals = server.totals();
      expect(totals.fights).toBeGreaterThan(0);
      expect(totals.purchases).toBeGreaterThan(0);
      expect(totals.trades).toBeGreaterThan(0);
    });
  });
});
