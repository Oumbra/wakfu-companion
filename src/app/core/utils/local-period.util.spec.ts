import {
  addLocalDays,
  addLocalMonths,
  addLocalYears,
  offsetForPeriodStart,
  periodBounds,
} from './local-period.util';

describe('local-period.util', () => {
  describe('addLocalDays', () => {
    it('franchit un changement de mois', () => {
      const aug30 = new Date(2026, 7, 30).getTime();
      expect(new Date(addLocalDays(aug30, 1)).getDate()).toBe(31);
      expect(new Date(addLocalDays(aug30, 1)).getMonth()).toBe(7); // août
      expect(new Date(addLocalDays(aug30, 2)).getDate()).toBe(1);
      expect(new Date(addLocalDays(aug30, 2)).getMonth()).toBe(8); // septembre
    });

    it('recule (offset négatif) en franchissant un changement d’année', () => {
      const jan1 = new Date(2026, 0, 1).getTime();
      const prev = new Date(addLocalDays(jan1, -1));
      expect(prev.getFullYear()).toBe(2025);
      expect(prev.getMonth()).toBe(11); // décembre
      expect(prev.getDate()).toBe(31);
    });
  });

  describe('addLocalMonths', () => {
    it('franchit un changement d’année (positif et négatif)', () => {
      const dec2026 = new Date(2026, 11, 1).getTime();
      const next = new Date(addLocalMonths(dec2026, 1));
      expect(next.getFullYear()).toBe(2027);
      expect(next.getMonth()).toBe(0); // janvier

      const jan2026 = new Date(2026, 0, 1).getTime();
      const prev = new Date(addLocalMonths(jan2026, -1));
      expect(prev.getFullYear()).toBe(2025);
      expect(prev.getMonth()).toBe(11); // décembre
    });
  });

  describe('addLocalYears', () => {
    it('décale l’année sans toucher au mois/jour (toujours 1er janvier)', () => {
      const y2026 = new Date(2026, 0, 1).getTime();
      const result = new Date(addLocalYears(y2026, -3));
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(1);
    });
  });

  describe('periodBounds', () => {
    it('jour : offset 0 couvre aujourd’hui jusqu’à demain minuit', () => {
      const now = new Date(2026, 7, 26, 14, 30, 0).getTime(); // 26 août 2026, 14h30
      const { start, end } = periodBounds('day', 0, now);
      expect(new Date(start)).toEqual(new Date(2026, 7, 26, 0, 0, 0));
      expect(new Date(end)).toEqual(new Date(2026, 7, 27, 0, 0, 0));
    });

    it('jour : offset -1 = hier, borne haute exclusive = début d’aujourd’hui', () => {
      const now = new Date(2026, 7, 26, 14, 30, 0).getTime();
      const { start, end } = periodBounds('day', -1, now);
      expect(new Date(start)).toEqual(new Date(2026, 7, 25, 0, 0, 0));
      expect(new Date(end)).toEqual(new Date(2026, 7, 26, 0, 0, 0));
    });

    it('mois : offset -1 depuis janvier bascule sur décembre de l’année précédente', () => {
      const now = new Date(2026, 0, 15).getTime(); // 15 janvier 2026
      const { start, end } = periodBounds('month', -1, now);
      expect(new Date(start)).toEqual(new Date(2025, 11, 1));
      expect(new Date(end)).toEqual(new Date(2026, 0, 1));
    });

    it('année : offset -2 couvre l’année civile complète 2 ans avant', () => {
      const now = new Date(2026, 5, 1).getTime();
      const { start, end } = periodBounds('year', -2, now);
      expect(new Date(start)).toEqual(new Date(2024, 0, 1));
      expect(new Date(end)).toEqual(new Date(2025, 0, 1));
    });
  });

  describe('offsetForPeriodStart', () => {
    it('jour : inverse exactement periodBounds sur plusieurs offsets', () => {
      const now = new Date(2026, 7, 26, 14, 30, 0).getTime();
      for (const offset of [0, -1, -5, -40]) {
        const { start } = periodBounds('day', offset, now);
        expect(offsetForPeriodStart('day', start, now)).toBe(offset);
      }
    });

    it('mois : inverse exactement periodBounds en franchissant un changement d’année', () => {
      const now = new Date(2026, 0, 15).getTime(); // 15 janvier 2026
      const { start } = periodBounds('month', -1, now);
      expect(offsetForPeriodStart('month', start, now)).toBe(-1);
    });

    it('année : inverse exactement periodBounds', () => {
      const now = new Date(2026, 5, 1).getTime();
      const { start } = periodBounds('year', -2, now);
      expect(offsetForPeriodStart('year', start, now)).toBe(-2);
    });

    it('jour : robuste à un changement d’heure été/hiver (pas de division ms directe)', () => {
      // 25 octobre 2026 → 26 octobre 2026 (Europe) : nuit à 25h (passage heure d'hiver).
      const now = new Date(2026, 9, 27, 10, 0, 0).getTime();
      const target = new Date(2026, 9, 25, 0, 0, 0).getTime();
      expect(offsetForPeriodStart('day', target, now)).toBe(-2);
    });
  });
});
