import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { StatsStoreService } from './stats-store.service';
import { LogFileAccessService } from './log-file-access.service';
import { CharacterRosterService } from './character-roster.service';

const FIXTURES_DIR = join(process.cwd(), 'assets/logs/tests/fr');

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

    it('gère les achats d\'objets uniques et de gros montants (purchase_2.log)', () => {
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
        ' INFO 11:02:30,000 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 1 kamas.',
      ]);
      expect(stats.purchaseHistory()).toHaveLength(0);
      expect(stats.kamasLost()).toBe(500);
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
        { name: 'Feuilluchon de Fortune', quantity: 1 },
        { name: 'Havre-Gemme Marchande', quantity: 1 },
      ]);
      expect(trades[0].given).toEqual([{ name: 'Poudre', quantity: 1 }]);
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
      expect(trades[0].acquired).toEqual([{ name: 'Poudre', quantity: 1 }]);
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
      expect(trades[0].acquired).toEqual([{ name: "Les Doigts d'Enutrof", quantity: 1 }]);
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

    it('ignore un échange entre deux personnages du roster déclaré (et non plus dès qu\'un seul y figure)', () => {
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
        ' INFO 13:46:13,009 [AWT-EventQueue-0] (buN:229) - [Trade] Fin de l\'échange',
        ' INFO 13:46:13,012 [AWT-EventQueue-0] (buN:252) - [Trade] le joueur Suuke donne : 20K ; ',
        'le joueur Oumbra donne : 0K ; ',
        ' INFO 13:46:13,012 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 20 kamas.',
        ' INFO 13:46:13,013 [AWT-EventQueue-0] (buN:229) - [Trade] Fin de l\'échange',
        ' INFO 13:46:13,013 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] L\'échange s\'est correctement terminé.',
        ' INFO 13:46:13,013 [AWT-EventQueue-0] (Sk:162) - [Trade] Ending the exchange between Oumbra (id=11039330) and Suuke (id=5749879)',
        ' INFO 13:46:13,014 [AWT-EventQueue-0] (buN:252) - [Trade] le joueur Oumbra donne : 0K ; ',
        'le joueur Suuke donne : 20K ; ',
        ' INFO 13:46:13,015 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] L\'échange s\'est correctement terminé.',
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
      expect(trades[0].given).toEqual([{ name: 'Poudre', quantity: 1 }]);
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
      expect(fight.turns).toBeGreaterThanOrEqual(3);
      const lootNames = fight.loot.map((l) => l.name).sort();
      expect(lootNames).toEqual(
        ['Bottes Larvesques Vaseuses', 'Peau de Larve', 'Peau de Nutellarve', 'Perle', 'Plâjeton'].sort(),
      );
      expect(stats.combatsWon()).toBe(1);
      expect(stats.combatsLost()).toBe(0);
    });

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
      expect(stats.damageByAttacker().map((r) => r.name).sort()).toEqual(['Caliburnus', 'Chafer']);

      // L'utilisateur choisit explicitement l'onglet du combat 1.
      stats.selectDisplayedFight(1);
      expect(stats.displayedFightId()).toBe(1);
      expect(stats.damageByAttacker().map((r) => r.name).sort()).toEqual(['Blop', 'Oumbra']);

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

    it('combat multi-compte perdu : les dégâts dupliqués par les deux comptes ne sont comptés qu\'une fois (fight_multi-account_lost.log)', () => {
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
});
