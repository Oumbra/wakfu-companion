import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsStoreService } from './stats-store.service';
import { LogFileAccessService } from './log-file-access.service';
import { CharacterRosterService } from './character-roster.service';
import { LootAlertService } from './loot-alert.service';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { HistorySyncService } from '../sync/history-sync.service';

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
      // Le log Wakfu n'écrit que l'heure : StatsStoreService lui recolle la date
      // du jour de LECTURE. Si cette date entrait dans la clé déterministe, un
      // fichier encore ouvert le lendemain réenverrait tout en double — d'où une
      // signature bâtie sur la seule heure du log (voir history-event.model.ts).
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
