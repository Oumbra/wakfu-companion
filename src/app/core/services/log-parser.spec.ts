import { describe, expect, it } from 'vitest';
import { LogParser } from './log-parser';
import { LogEntry } from '../models/log-entry.model';

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

describe('LogParser — filtrage WARN/ERROR', () => {
  it('ignore systématiquement les lignes WARN et ERROR', () => {
    const parser = new LogParser();
    const lines = [
      ' WARN 11:02:26,931 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez perdu 340 kamas.',
      ' ERROR 11:02:26,932 [AWT-EventQueue-0] (aPV:174) - Une erreur quelconque non liée au jeu',
      ' INFO 11:02:26,933 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 10 kamas.',
    ];
    const entries = parseAll(parser, lines);
    expect(entries).toEqual([
      { kind: 'kama-gain', time: '11:02:26,933', amount: 10, fightId: null },
    ]);
  });

  it("n'interrompt pas une ligne multi-lignes en cours si une ligne WARN/ERROR s'intercale", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 11:20:33,092 [AWT-EventQueue-0] (Sk:64) - [Trade] Starting an exchange between Suuke (id=1) and Oumbra (id=2)',
      ' WARN 11:20:33,100 [AWT-EventQueue-0] (x:1) - bruit sans rapport',
      ' INFO 11:21:41,941 [AWT-EventQueue-0] (buN:252) - [Trade] le joueur Suuke donne : 0K ; 1xPoudre (refId=27093) ',
      'le joueur Oumbra donne : 0K ; 1xPain (refId=1) ',
      ' INFO 11:21:41,950 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez gagné 1 kamas.',
    ];
    const entries = parseAll(parser, lines);
    const trade = entries.find((e) => e.kind === 'trade-completed');
    expect(trade).toBeTruthy();
  });
});

describe('LogParser — parsing de base (non-régression)', () => {
  it('parse dégâts, sorts et butin', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 11:58:32,313 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Larve Verte lance le sort Mucus Acide',
      ' INFO 11:58:33,180 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Ebenus Sagittarius: -8 PV (Terre)',
      ' INFO 11:58:52,422 [AWT-EventQueue-0] (aPV:174) - [Information (jeu)] Vous avez ramassé 3x Peau de Larve .',
      ' INFO 11:58:52,432 [AWT-EventQueue-0] (aPV:174) - [Proximité] Bob : bonjour',
    ];
    const entries = parseAll(parser, lines);
    expect(entries).toEqual([
      {
        kind: 'spell-cast',
        time: '11:58:32,313',
        caster: 'Larve Verte',
        spell: 'Mucus Acide',
        critical: false,
        fightId: null,
      },
      {
        kind: 'damage',
        time: '11:58:33,180',
        target: 'Ebenus Sagittarius',
        attacker: 'Larve Verte',
        spell: 'Mucus Acide',
        element: 'Terre',
        amount: 8,
        fightId: null,
      },
      { kind: 'loot', time: '11:58:52,422', item: 'Peau de Larve', quantity: 3, fightId: null },
      {
        kind: 'chat',
        time: '11:58:52,432',
        channel: 'proximite',
        channelLabel: 'Proximité',
        author: 'Bob',
        message: 'bonjour',
      },
    ]);
  });
});

describe('LogParser — session marchand/HDV (market-occupation)', () => {
  it("parse l'ouverture et la fermeture d'une session marchand, hors de toute enveloppe [Catégorie]", () => {
    const parser = new LogParser();
    const lines = [
      " INFO 00:29:26,867 [AWT-EventQueue-0] (bmI:41) - Lancement de l'occupation MARKET sur la board [bDk id=31547]{Point3 : (-1, -12, -47)}",
      " INFO 00:29:37,899 [AWT-EventQueue-0] (bmI:77) - On arrête l'occupation MARKET sur la board [bDk id=31547]{Point3 : (-1, -12, -47)}",
    ];
    const entries = parseAll(parser, lines);
    expect(entries).toEqual([
      { kind: 'market-occupation', time: '00:29:26,867', active: true },
      { kind: 'market-occupation', time: '00:29:37,899', active: false },
    ]);
  });
});

describe('LogParser — multi-combat (fightId)', () => {
  it('rattache jointure et fin de combat au bon fightId', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 11:58:21,848 [AWT-EventQueue-0] (faw:1405) - [_FL_] fightId=111 Oumbra breed : 4 [999] isControlledByAI=false obstacleId : -1 join the fight at {Point3 : (0,0,0)}',
      ' INFO 11:58:21,849 [AWT-EventQueue-0] (faw:1405) - [_FL_] fightId=111 Larve Verte breed : 125 [-1] isControlledByAI=true obstacleId : -1 join the fight at {Point3 : (0,0,0)}',
      ' INFO 11:58:53,629 [AWT-EventQueue-0] (aWF:91) - [FIGHT] End fight with id 111',
    ];
    const entries = parseAll(parser, lines);
    expect(entries[0]).toMatchObject({
      kind: 'fighter-joined',
      fightId: 111,
      name: 'Oumbra',
      breed: 4,
      fighterId: 999,
      isControlledByAI: false,
    });
    expect(entries[1]).toMatchObject({
      kind: 'fighter-joined',
      fightId: 111,
      name: 'Larve Verte',
      isControlledByAI: true,
    });
    expect(entries[2]).toEqual({
      kind: 'combat-end',
      time: '11:58:53,629',
      fightId: 111,
      result: 'won',
    });
  });

  it('isole deux combats concurrents : la jointure du second ne pollue pas le premier', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Blop breed : 4777 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:05,000 [T] (a:1) - [_FL_] fightId=2 Caliburnus breed : 8 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:05,001 [T] (a:1) - [_FL_] fightId=2 Blop breed : 4777 [-2] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:06,000 [T] (a:1) - [Information (combat)] Oumbra lance le sort Frappe',
      ' INFO 10:00:06,500 [T] (a:1) - [Information (combat)] Blop: -100 PV (Terre)',
      ' INFO 10:00:20,000 [T] (a:1) - [FIGHT] End fight with id 2',
      ' INFO 10:00:21,000 [T] (a:1) - [FIGHT] End fight with id 1',
    ];
    const entries = parseAll(parser, lines);
    const damage = entries.find((e) => e.kind === 'damage');
    // Oumbra (fight 1) vient de lancer un sort : le dégât qui suit immédiatement lui est attribué, et donc rattaché au combat 1.
    expect(damage).toMatchObject({ attacker: 'Oumbra', fightId: 1 });
    const ends = entries.filter((e) => e.kind === 'combat-end');
    expect(ends.map((e: any) => e.fightId)).toEqual([2, 1]);
  });

  it("rattache le butin au combat restant quand un combat concurrent vient de se terminer sans qu'aucun sort/dégât n'ait ré-ancré le combat courant (bug réel : butin de fin de combat manquant)", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=1 Piou breed : 87 [1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:00,001 [T] (a:1) - [_FL_] fightId=1 Sagitta breed : 9 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:05,000 [T] (a:1) - [_FL_] fightId=2 Bouftou breed : 1 [3] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:05,001 [T] (a:1) - [_FL_] fightId=2 Oumbra breed : 4 [4] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      // Un sort/XP ancre currentFightId sur le combat 1 (Piou) juste avant sa fin.
      " INFO 10:00:10,000 [T] (a:1) - [Information (combat)] Sagitta : +100 points d'XP. ",
      ' INFO 10:00:11,000 [T] (a:1) - [FIGHT] End fight with id 1',
      // Entre la fin du combat 1 et ce butin, AUCUNE ligne à nom résolvable (seulement des statuts) :
      // avant le fix, currentFightId restait à null et ce butin (du combat 2, encore actif) se perdait.
      ' INFO 10:00:12,000 [T] (a:1) - [Information (combat)] Oumbra: 1 PA (Force vitale)',
      ' INFO 10:00:13,000 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Peau de Bouftou .',
    ];
    const entries = parseAll(parser, lines);
    const loot = entries.find((e) => e.kind === 'loot');
    expect(loot).toEqual({
      kind: 'loot',
      time: '10:00:13,000',
      item: 'Peau de Bouftou',
      quantity: 1,
      fightId: 2,
    });
  });

  it('déclare une défaite via "Lancement de l\'occupation" même sans marqueur "vaincu(e)"', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 12:05:32,796 [T] (a:1) - [_FL_] fightId=5 Oumbra breed : 4 [1] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 12:05:32,797 [T] (a:1) - [_FL_] fightId=5 Sagittarius Caecus breed : 9 [2] isControlledByAI=false obstacleId : -1 join the fight at {P}',
      ' INFO 12:05:38,613 [T] (a:1) - [Information (combat)] Sagittarius Caecus est KO !',
      " INFO 12:05:40,897 [T] (bmX:89) - [DEATH] Lancement de l'occupation pour le joueur Oumbra Sram",
      ' INFO 12:05:40,908 [T] (aWF:91) - [FIGHT] End fight with id 5',
    ];
    const entries = parseAll(parser, lines);
    const end = entries.find((e) => e.kind === 'combat-end');
    expect(end).toEqual({ kind: 'combat-end', time: '12:05:40,908', fightId: 5, result: 'lost' });
  });

  it('détecte une mise hors-combat ennemie même sans "est KO !"', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 10:00:00,000 [T] (a:1) - [_FL_] fightId=9 Larve Bleue breed : 123 [-1] isControlledByAI=true obstacleId : -1 join the fight at {P}',
      ' INFO 10:00:01,000 [T] (a:1) - [Information (combat)] Larve Bleue est hors-combat !',
    ];
    const entries = parseAll(parser, lines);
    const defeat = entries.find((e) => e.kind === 'enemy-defeated');
    expect(defeat).toEqual({
      kind: 'enemy-defeated',
      time: '10:00:01,000',
      name: 'Larve Bleue',
      fightId: 9,
    });
  });
});

describe('LogParser — dédoublonnage multi-compte', () => {
  it("ignore un dégât identique répété moins d'une seconde plus tard", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 15:16:23,058 [T] (a:1) - [Information (combat)] Sagitta Tenebrarum: -489 PV (Air)',
      ' INFO 15:16:23,064 [T] (a:1) - [Information (combat)] Sagitta Tenebrarum: -489 PV (Air)',
    ];
    const entries = parseAll(parser, lines);
    expect(entries.filter((e) => e.kind === 'damage')).toHaveLength(1);
  });

  it('ne dédoublonne pas le butin (répétition légitime possible en farm)', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 15:01:49,570 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Fausse note .',
      ' INFO 15:01:49,572 [T] (a:1) - [Information (jeu)] Vous avez ramassé 1x Fausse note .',
    ];
    const entries = parseAll(parser, lines);
    expect(entries.filter((e) => e.kind === 'loot')).toHaveLength(2);
  });

  it('ne dédoublonne pas au-delà de la fenêtre de tolérance', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 15:16:23,000 [T] (a:1) - [Information (combat)] Sagitta Tenebrarum: -489 PV (Air)',
      ' INFO 15:16:25,000 [T] (a:1) - [Information (combat)] Sagitta Tenebrarum: -489 PV (Air)',
    ];
    const entries = parseAll(parser, lines);
    expect(entries.filter((e) => e.kind === 'damage')).toHaveLength(2);
  });

  it("dédoublonne un message de chat répété en multi-compte (même auteur, même message, moins d'1s)", () => {
    const parser = new LogParser();
    const lines = Array.from(
      { length: 10 },
      (_, i) => ` INFO 15:16:23,0${i}0 [T] (a:1) - [Proximité] Bob : Coucou`,
    );
    const entries = parseAll(parser, lines);
    expect(entries.filter((e) => e.kind === 'chat')).toHaveLength(1);
  });

  it("ne dédoublonne pas deux messages de chat différents envoyés à quelques ms d'écart", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 15:16:23,000 [T] (a:1) - [Proximité] Bob : Coucou',
      ' INFO 15:16:23,010 [T] (a:1) - [Proximité] Alice : Salut',
    ];
    const entries = parseAll(parser, lines);
    expect(entries.filter((e) => e.kind === 'chat')).toHaveLength(2);
  });
});

describe('LogParser — échanges multi-lignes', () => {
  it('reconstitue un échange dont le résumé final est réparti sur deux lignes physiques', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 11:20:33,092 [T] (Sk:64) - [Trade] Starting an exchange between Suuke (id=1) and Oumbra (id=2)',
      ' INFO 11:21:41,941 [T] (buN:252) - [Trade] le joueur Suuke donne : 0K ; 1xFeuilluchon de Fortune (refId=13360) 1xHavre-Gemme Marchande (refId=4262) ',
      'le joueur Oumbra donne : 0K ; 1xPoudre (refId=27093) ',
      " INFO 11:21:41,941 [T] (aPV:174) - [Information (jeu)] L'échange s'est correctement terminé.",
    ];
    const entries = parseAll(parser, lines);
    const trade = entries.find((e) => e.kind === 'trade-completed');
    expect(trade).toMatchObject({
      kind: 'trade-completed',
      sides: [
        {
          playerName: 'Suuke',
          items: [
            { name: 'Feuilluchon de Fortune', quantity: 1 },
            { name: 'Havre-Gemme Marchande', quantity: 1 },
          ],
        },
        { playerName: 'Oumbra', items: [{ name: 'Poudre', quantity: 1 }] },
      ],
    });
  });

  it('capture les kamas échangés de chaque côté', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 13:46:13,012 [T] (buN:252) - [Trade] le joueur Suuke donne : 20K ; ',
      'le joueur Oumbra donne : 0K ; ',
    ];
    const entries = parseAll(parser, lines);
    const trade = entries.find((e) => e.kind === 'trade-completed');
    expect(trade).toMatchObject({
      sides: [
        { playerName: 'Suuke', kamas: 20, items: [] },
        { playerName: 'Oumbra', kamas: 0, items: [] },
      ],
    });
  });

  it('ignore le résumé final réémis avec les deux "donne" dans l\'ordre inverse (doublon multi-compte)', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 13:46:13,012 [T] (buN:252) - [Trade] le joueur Suuke donne : 20K ; ',
      'le joueur Oumbra donne : 0K ; ',
      ' INFO 13:46:13,014 [T] (buN:252) - [Trade] le joueur Oumbra donne : 0K ; ',
      'le joueur Suuke donne : 20K ; ',
    ];
    const entries = parseAll(parser, lines);
    expect(entries.filter((e) => e.kind === 'trade-completed')).toHaveLength(1);
  });
});

describe('LogParser — soin donné (onglet Soin)', () => {
  it("rattache un soin résultant directement d'un sort au lanceur, pas à la cible soignée", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 12:34:24,027 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Cura Pictor lance le sort Revitalisation (Critiques)',
      ' INFO 12:34:24,735 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Scutum Tutelare: +169 PV (Eau)',
    ];
    const entries = parseAll(parser, lines);
    expect(entries[1]).toEqual({
      kind: 'heal',
      time: '12:34:24,735',
      target: 'Scutum Tutelare',
      attacker: 'Cura Pictor',
      spell: 'Revitalisation',
      element: 'Eau',
      amount: 169,
      fightId: null,
    });
  });

  it("rattache un soin \"Délai\" (effet posé par un sort déjà lancé) à l'auteur du sort d'origine, pas au porteur de l'effet", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 12:34:24,027 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Cura Pictor lance le sort Revitalisation (Critiques)',
      ' INFO 12:34:24,735 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Scutum Tutelare: +169 PV (Eau)',
      ' INFO 12:34:24,740 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Scutum Tutelare: Délai (+169 Niv.)',
      ' INFO 12:34:48,657 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Scutum Tutelare: +338 PV (Neutre) (Délai)',
    ];
    const entries = parseAll(parser, lines);
    const delayedHeal = entries.find((e) => e.kind === 'heal' && e.amount === 338);
    expect(delayedHeal).toEqual({
      kind: 'heal',
      time: '12:34:48,657',
      target: 'Scutum Tutelare',
      attacker: 'Cura Pictor',
      spell: 'Délai',
      element: 'Neutre',
      amount: 338,
      fightId: null,
    });
  });

  it('rattache un soin passif non suivi (ex. "Digestion") à l\'entité qui le porte, jamais au dernier lanceur de sort connu', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 10:58:09,286 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Merkator: -188 PV (Air) (Parade !)',
      ' INFO 10:58:19,151 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Zoroark Shiny: +234 PV (Neutre) (Digestion)',
    ];
    const entries = parseAll(parser, lines);
    expect(entries[1]).toEqual({
      kind: 'heal',
      time: '10:58:19,151',
      target: 'Zoroark Shiny',
      attacker: 'Zoroark Shiny',
      spell: 'Digestion',
      element: 'Neutre',
      amount: 234,
      fightId: null,
    });
  });
});

describe('LogParser — armure donnée (onglet Armure)', () => {
  it("ignore une perte d'armure (signe négatif) : seule l'armure donnée est suivie", () => {
    const parser = new LogParser();
    const entries = parseAll(parser, [
      ' INFO 15:38:47,729 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Oumbra Canin: -276 Armure',
    ]);
    expect(entries).toEqual([]);
  });

  it("rattache un bouclier de feca (nom d'effet ne reprenant que partiellement le nom du sort) au lanceur du sort", () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 12:35:09,848 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Scutum Tutelare lance le sort Orbe défensif',
      ' INFO 12:35:10,856 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Cartarum Lusor: Bouclier Orbe défensif (+1 892 Niv.)',
      ' INFO 12:35:10,867 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Cartarum Lusor: 956 Armure (Bouclier Orbe défensif)',
    ];
    const entries = parseAll(parser, lines);
    const armor = entries.find((e) => e.kind === 'armor');
    expect(armor).toEqual({
      kind: 'armor',
      time: '12:35:10,867',
      target: 'Cartarum Lusor',
      attacker: 'Scutum Tutelare',
      spell: 'Bouclier Orbe défensif',
      amount: 956,
      fightId: null,
    });
  });

  it('rattache une armure passive non suivie (ex. "Art Canin") à l\'entité elle-même, même si un autre combattant vient de lancer un sort juste avant', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 10:59:20,101 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Piou Rouge lance le sort Picorage Ardent',
      ' INFO 10:59:20,105 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Kralaman: -1 556 PV (Lumière) (Air) (Contre-attaque)',
      ' INFO 10:59:20,106 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Zoroark Shiny: 605 Armure (Art Canin)',
    ];
    const entries = parseAll(parser, lines);
    const armor = entries.find((e) => e.kind === 'armor');
    expect(armor).toEqual({
      kind: 'armor',
      time: '10:59:20,106',
      target: 'Zoroark Shiny',
      attacker: 'Zoroark Shiny',
      spell: 'Art Canin',
      amount: 605,
      fightId: null,
    });
  });

  it('rattache une armure sans tag au dernier lanceur de sort (auto-buff)', () => {
    const parser = new LogParser();
    const lines = [
      ' INFO 10:59:03,137 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Zoroark Shiny lance le sort Molosse',
      ' INFO 10:59:04,447 [AWT-EventQueue-0] (aPV:174) - [Information (combat)] Zoroark Shiny: 312 Armure',
    ];
    const entries = parseAll(parser, lines);
    expect(entries[1]).toEqual({
      kind: 'armor',
      time: '10:59:04,447',
      target: 'Zoroark Shiny',
      attacker: 'Zoroark Shiny',
      spell: 'Molosse',
      amount: 312,
      fightId: null,
    });
  });
});
