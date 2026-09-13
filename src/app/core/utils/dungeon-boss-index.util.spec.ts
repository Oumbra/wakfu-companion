import { indexDungeonsByBossMonsterId } from './dungeon-boss-index.util';

describe('indexDungeonsByBossMonsterId', () => {
  const FLAQUEUX = { id: 142, type: 'TWO_ROOMS', bossMonsterId: [4720] };
  const CACTERRE = { id: 83, type: 'TWO_ROOMS', bossMonsterId: [2972] };
  const FRIGOST_ULTIMATE = { id: 170, type: 'ULTIMATE_BREACH', bossMonsterId: [2464, 2972, 4720] };
  const BREACH_NO_BOSS = { id: 160, type: 'BREACH', bossMonsterId: [] };

  it('préfère toujours le donjon classique à une brèche, quel que soit l’ordre d’entrée', () => {
    const inBreachFirstOrder = indexDungeonsByBossMonsterId([FRIGOST_ULTIMATE, FLAQUEUX, CACTERRE]);
    const inClassicFirstOrder = indexDungeonsByBossMonsterId([
      FLAQUEUX,
      CACTERRE,
      FRIGOST_ULTIMATE,
    ]);

    for (const index of [inBreachFirstOrder, inClassicFirstOrder]) {
      expect(index.get(4720)?.id).toBe(142);
      expect(index.get(2972)?.id).toBe(83);
    }
  });

  it('retombe sur la brèche pour un boss qu’aucun donjon classique ne réclame', () => {
    const index = indexDungeonsByBossMonsterId([FRIGOST_ULTIMATE, FLAQUEUX, BREACH_NO_BOSS]);

    expect(index.get(2464)?.id).toBe(170);
  });

  it('garde le premier donjon classique en cas de doublon entre donjons classiques', () => {
    const DUPLICATE = { id: 999, type: 'THREE_ROOMS', bossMonsterId: [4720] };
    const index = indexDungeonsByBossMonsterId([FLAQUEUX, DUPLICATE]);

    expect(index.get(4720)?.id).toBe(142);
  });
});
