import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from '../i18n/translations';
import { ONBOARDING_CHAPTERS, ONBOARDING_SLIDES, OnboardingBlock } from './onboarding-slides.data';

/** Toutes les clés i18n référencées par le contenu du pas-à-pas (hors diapositives de bord, dont
 * les clés sont écrites en dur dans le template). */
function slideKeys(): string[] {
  const keys: string[] = [];
  for (const chapter of ONBOARDING_CHAPTERS) keys.push(chapter.labelKey, chapter.descKey);
  for (const slide of ONBOARDING_SLIDES) {
    if (slide.chapter === null) continue;
    keys.push(`onboarding.${slide.id}.toc`, `onboarding.${slide.id}.title`);
    if (slide.hasLede) keys.push(`onboarding.${slide.id}.lede`);
    for (const block of slide.blocks) keys.push(...blockKeys(block));
  }
  return keys;
}

function blockKeys(block: OnboardingBlock): string[] {
  switch (block.kind) {
    case 'hero':
      return [...block.legend];
    case 'zigzag':
      return block.rows.flatMap((row) => [row.titleKey, ...row.lines.map((l) => l.key)]);
    case 'mosaic':
      return block.cells.map((c) => c.key);
    case 'tip':
      return [block.key];
    case 'image':
      return [];
  }
}

describe('ONBOARDING_SLIDES', () => {
  it('a une traduction pour chaque clé, dans les 4 locales', () => {
    const missing = (['fr', 'en', 'es', 'pt'] as const).flatMap((locale) =>
      slideKeys()
        .filter((key) => !TRANSLATIONS[locale][key])
        .map((key) => `${locale}:${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('commence par la bienvenue et finit par le résumé, tous deux dans le parcours Essentiel', () => {
    const first = ONBOARDING_SLIDES[0];
    const last = ONBOARDING_SLIDES[ONBOARDING_SLIDES.length - 1];
    expect([first.id, first.essential]).toEqual(['welcome', true]);
    expect([last.id, last.essential]).toEqual(['done', true]);
  });

  it('numérote les pastilles des légendes zigzag sans doublon au sein d’une ligne', () => {
    for (const slide of ONBOARDING_SLIDES) {
      for (const block of slide.blocks) {
        if (block.kind !== 'zigzag') continue;
        for (const row of block.rows) {
          const badges = row.lines.flatMap((l) => (l.badge === undefined ? [] : [l.badge]));
          expect(new Set(badges).size).toBe(badges.length);
        }
      }
    }
  });
});
