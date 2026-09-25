import { OnboardingIconName } from '../../shared/onboarding-icon/onboarding-icon.component';

/**
 * Contenu du pas-à-pas d'onboarding (voir OnboardingTourService pour l'état, OnboardingTourComponent
 * pour le rendu) : 22 diapositives réparties en 6 chapitres, chacune composée de blocs typés (héros
 * annoté, zigzag, mosaïque, image, astuce) plutôt que d'un couple GIF + description.
 *
 * Illustrations : captures STATIQUES annotées (encadrés + pastilles numérotées posés sur les vrais
 * éléments DOM par un script Playwright hors dépôt, voir `public/assets/SOURCES.md`), en JPEG. Elles ont
 * remplacé les 7 GIF d'origine (43 Mo) le 2026-09-24 : une image fixe se lit à son rythme, se
 * charge vite, et permet de pointer un élément précis.
 *
 * ⚠ Données FACTICES uniquement dans ces captures (RGPD) : `chat.gif` a été publié pendant plusieurs
 * semaines avec les pseudonymes réels et les messages intégraux d'une vingtaine de joueurs tiers
 * (constaté à l'audit du 2026-09-20). Les captures actuelles sont générées depuis `tests/wakfu.log`
 * (déjà pseudonymisé) plus des lignes synthétiques aux noms inventés. `tools/check-fixtures.mjs` ne
 * voit pas une image : avant de remplacer une capture, relire chaque image (pseudos, messages de
 * chat, partenaires d'échange, noms de personnages) — c'est une diffusion publique de données de
 * tiers sans base légale, pas un simple détail cosmétique.
 *
 * Textes : toutes les clés vivent dans `translations.ts` sous `onboarding.<id de diapositive>.*`
 * (4 locales). Les textes de blocs sont du HTML (`<b>Titre</b> texte`), rendus via `tHtml`.
 * Les captures, elles, restent en français quelle que soit la locale.
 */

export type OnboardingChapterId = 'start' | 'tracker' | 'fight' | 'history' | 'chat' | 'custom';

export interface OnboardingChapter {
  readonly id: OnboardingChapterId;
  readonly icon: OnboardingIconName;
  /** `onboarding.chapter.<id>.label` / `.desc`. */
  readonly labelKey: string;
  readonly descKey: string;
}

/** Loupe : la même image, agrandie dans un médaillon — `x`/`y` = point visé (0..1), `scale` =
 * facteur d'agrandissement, `side` = coin où poser le médaillon. */
export interface OnboardingLens {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly side: 'left' | 'right';
}

export interface OnboardingImage {
  readonly src: string;
  /** Dimensions réelles du fichier (captures en 2x) — posées en attributs `width`/`height` pour
   * réserver la place avant chargement (pas de saut de mise en page). */
  readonly width: number;
  readonly height: number;
  /** Afficher à sa taille naturelle (moitié des pixels, captures en 2x) plutôt qu'étirée sur toute
   * la largeur disponible — pour les petites captures (popover, carte) qui deviendraient floues. */
  readonly natural?: boolean;
  readonly lens?: OnboardingLens;
}

/** Ligne de texte d'un bloc : clé HTML, avec une pastille numérotée optionnelle (même numéro que
 * celui posé sur la capture). */
export interface OnboardingText {
  readonly key: string;
  readonly badge?: number;
}

export interface OnboardingHeroBlock {
  readonly kind: 'hero';
  readonly image: OnboardingImage;
  /** Légende numérotée : l'élément i porte la pastille i+1, comme sur la capture. */
  readonly legend: readonly string[];
}

export interface OnboardingZigzagRow {
  readonly image: OnboardingImage;
  /** Petite capture complémentaire affichée sous la principale (popover, menu). */
  readonly extra?: OnboardingImage;
  readonly titleKey: string;
  readonly lines: readonly OnboardingText[];
}

export interface OnboardingZigzagBlock {
  readonly kind: 'zigzag';
  readonly rows: readonly OnboardingZigzagRow[];
}

export interface OnboardingMosaicCell {
  readonly image?: OnboardingImage;
  readonly badge?: number;
  readonly key: string;
}

export interface OnboardingMosaicBlock {
  readonly kind: 'mosaic';
  readonly columns: number;
  /** Captures de téléphone (format portrait) : hauteur plafonnée plutôt que pleine largeur. */
  readonly phones?: boolean;
  readonly cells: readonly OnboardingMosaicCell[];
}

export interface OnboardingImageBlock {
  readonly kind: 'image';
  readonly image: OnboardingImage;
  /** Largeur max en px — pour une capture en bandeau (ex. la bande de suivi). */
  readonly maxWidth: number;
}

export interface OnboardingTipBlock {
  readonly kind: 'tip';
  readonly tone: 'info' | 'note';
  readonly key: string;
}

export type OnboardingBlock =
  | OnboardingHeroBlock
  | OnboardingZigzagBlock
  | OnboardingMosaicBlock
  | OnboardingImageBlock
  | OnboardingTipBlock;

export interface OnboardingSlide {
  readonly id: string;
  /** `null` pour les 2 diapositives de bord (bienvenue/fin), rendues par un gabarit dédié. */
  readonly chapter: OnboardingChapterId | null;
  /** Incluse dans le parcours « Essentiel » (en plus du parcours « Complet »). */
  readonly essential: boolean;
  /** Sommaire : `onboarding.<id>.toc` ; titre : `.title` ; chapeau : `.lede` si `hasLede`. */
  readonly hasLede: boolean;
  readonly blocks: readonly OnboardingBlock[];
}

export type OnboardingTrack = 'full' | 'essential';

export const ONBOARDING_CHAPTERS: readonly OnboardingChapter[] = (
  [
    ['start', 'map-pin'],
    ['tracker', 'trending-up'],
    ['fight', 'swords'],
    ['history', 'clock-long'],
    ['chat', 'chat-bubble'],
    ['custom', 'person'],
  ] as const
).map(([id, icon]) => ({
  id,
  icon,
  labelKey: `onboarding.chapter.${id}.label`,
  descKey: `onboarding.chapter.${id}.desc`,
}));

const img = (
  name: string,
  width: number,
  height: number,
  extra: Partial<Pick<OnboardingImage, 'natural' | 'lens'>> = {},
): OnboardingImage => ({ src: `assets/onboarding/${name}.jpg`, width, height, ...extra });

/** Lignes numérotées `onboarding.<slide>.<prefix><n>` avec pastille n (de `from` à `to`). */
const numbered = (slide: string, prefix: string, from: number, to: number): OnboardingText[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    key: `onboarding.${slide}.${prefix}${from + i}`,
    badge: from + i,
  }));

const line = (slide: string, key: string): OnboardingText => ({
  key: `onboarding.${slide}.${key}`,
});

const legend = (slide: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `onboarding.${slide}.l${i + 1}`);

const cell = (
  slide: string,
  key: string,
  image?: OnboardingImage,
  badge?: number,
): OnboardingMosaicCell => ({ key: `onboarding.${slide}.${key}`, image, badge });

const tip = (slide: string, tone: 'info' | 'note' = 'info'): OnboardingTipBlock => ({
  kind: 'tip',
  tone,
  key: `onboarding.${slide}.tip`,
});

export const ONBOARDING_SLIDES: readonly OnboardingSlide[] = [
  { id: 'welcome', chapter: null, essential: true, hasLede: false, blocks: [] },

  // --- Démarrer ---
  {
    id: 'setup',
    chapter: 'start',
    essential: true,
    hasLede: true,
    blocks: [
      { kind: 'hero', image: img('setup-annot', 2120, 840), legend: legend('setup', 4) },
      {
        kind: 'mosaic',
        columns: 3,
        cells: [
          cell('setup', 'm1', img('setup-reconnect', 1280, 650)),
          cell('setup', 'm2', img('setup-unsupported', 1280, 564)),
          cell('setup', 'm3'),
        ],
      },
    ],
  },
  {
    id: 'header',
    chapter: 'start',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('header-left', 1240, 132),
            extra: img('reset-pop', 1040, 400, { natural: true }),
            titleKey: 'onboarding.header.r1',
            lines: numbered('header', 'n', 1, 3),
          },
          {
            image: img('header-right', 440, 132, { natural: true }),
            extra: img('help-menu', 600, 780, { natural: true }),
            titleKey: 'onboarding.header.r2',
            lines: numbered('header', 'n', 4, 7),
          },
        ],
      },
    ],
  },

  // --- Suivi ---
  {
    id: 'trackAdd',
    chapter: 'tracker',
    essential: true,
    hasLede: true,
    blocks: [
      { kind: 'hero', image: img('add-form', 2200, 340), legend: legend('trackAdd', 4) },
      {
        kind: 'mosaic',
        columns: 1,
        cells: [cell('trackAdd', 'm1', img('add-search', 1800, 1040))],
      },
    ],
  },
  {
    id: 'trackModes',
    chapter: 'tracker',
    essential: true,
    hasLede: true,
    blocks: [
      { kind: 'image', image: img('strip-modes', 1120, 240), maxWidth: 560 },
      {
        kind: 'mosaic',
        columns: 3,
        cells: [
          cell('trackModes', 'm1', undefined, 1),
          cell('trackModes', 'm2', img('toast-countdown', 1152, 362), 2),
          cell('trackModes', 'm3', img('toast-goal', 1128, 362), 3),
        ],
      },
      tip('trackModes', 'note'),
    ],
  },
  {
    id: 'trackManage',
    chapter: 'tracker',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('strip-expanded', 1520, 240),
            titleKey: 'onboarding.trackManage.r1',
            lines: [...numbered('trackManage', 'a', 1, 3), line('trackManage', 'a4')],
          },
          {
            image: img('strip-bulk', 1800, 300),
            titleKey: 'onboarding.trackManage.r2',
            lines: [...numbered('trackManage', 'b', 1, 2), line('trackManage', 'b3')],
          },
        ],
      },
    ],
  },
  {
    id: 'recipe',
    chapter: 'tracker',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('add-search-recipe', 1800, 600),
            titleKey: 'onboarding.recipe.r1',
            lines: numbered('recipe', 'a', 1, 1),
          },
          {
            image: img('recipe-modal', 880, 928, { natural: true }),
            titleKey: 'onboarding.recipe.r2',
            lines: numbered('recipe', 'b', 1, 3),
          },
        ],
      },
    ],
  },

  // --- Combats ---
  {
    id: 'fightLive',
    chapter: 'fight',
    essential: true,
    hasLede: true,
    blocks: [
      { kind: 'hero', image: img('live-annot', 1884, 1600), legend: legend('fightLive', 4) },
      tip('fightLive'),
    ],
  },
  {
    id: 'fightViews',
    chapter: 'fight',
    essential: false,
    hasLede: false,
    blocks: [
      {
        kind: 'mosaic',
        columns: 3,
        cells: [
          cell('fightViews', 'm1', img('live-spells', 1884, 1600)),
          cell('fightViews', 'm2', img('live-turn', 1884, 1600)),
          cell('fightViews', 'm3', img('live-armor', 1884, 1400)),
        ],
      },
    ],
  },
  {
    id: 'fightFix',
    chapter: 'fight',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('reassign', 1280, 840),
            titleKey: 'onboarding.fightFix.r1',
            lines: [line('fightFix', 'a1')],
          },
          {
            image: img('class-picker', 634, 432, { natural: true }),
            titleKey: 'onboarding.fightFix.r2',
            lines: [line('fightFix', 'b1')],
          },
        ],
      },
      tip('fightFix'),
    ],
  },
  {
    id: 'fightHistory',
    chapter: 'fight',
    essential: true,
    hasLede: true,
    blocks: [
      { kind: 'hero', image: img('hist-list', 1884, 1600), legend: legend('fightHistory', 4) },
      {
        kind: 'mosaic',
        columns: 2,
        cells: [
          cell(
            'fightHistory',
            'm1',
            img('hist-expanded', 1884, 2168, {
              lens: { x: 0.27, y: 0.67, scale: 2.6, side: 'right' },
            }),
          ),
          cell('fightHistory', 'm2', img('fight-group-auth', 1888, 138)),
        ],
      },
    ],
  },

  // --- Historique & récap ---
  {
    id: 'ledger',
    chapter: 'history',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'mosaic',
        columns: 3,
        cells: [
          cell('ledger', 'm1', img('purchase-menu', 954, 870)),
          cell('ledger', 'm2', img('trades', 954, 690)),
          cell('ledger', 'm3', img('pact', 954, 690)),
        ],
      },
    ],
  },
  {
    id: 'recap',
    chapter: 'history',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('recap-session', 954, 698),
            titleKey: 'onboarding.recap.r1',
            lines: [line('recap', 'a1')],
          },
          {
            image: img('recap-month', 954, 698),
            extra: img('period-picker', 560, 404, { natural: true }),
            titleKey: 'onboarding.recap.r2',
            lines: numbered('recap', 'b', 1, 3),
          },
        ],
      },
    ],
  },

  // --- Chat & alertes ---
  {
    id: 'chat',
    chapter: 'chat',
    essential: true,
    hasLede: true,
    blocks: [
      { kind: 'hero', image: img('chat', 954, 690), legend: legend('chat', 3) },
      { kind: 'mosaic', columns: 1, cells: [cell('chat', 'm1', img('rail', 1040, 200))] },
    ],
  },
  {
    id: 'alerts',
    chapter: 'chat',
    essential: true,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('toast-loot', 1060, 358, { natural: true }),
            titleKey: 'onboarding.alerts.r1',
            lines: [line('alerts', 'a1')],
          },
          {
            image: img('alerts-tight', 1996, 860),
            titleKey: 'onboarding.alerts.r2',
            lines: numbered('alerts', 'b', 1, 4),
          },
        ],
      },
    ],
  },

  // --- Personnaliser ---
  {
    id: 'identity',
    chapter: 'custom',
    essential: false,
    hasLede: true,
    blocks: [{ kind: 'hero', image: img('id-tight', 1996, 890), legend: legend('identity', 3) }],
  },
  {
    id: 'layout',
    chapter: 'custom',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'mosaic',
        columns: 2,
        cells: [
          cell('layout', 'm1', img('lay-grid0', 1948, 620)),
          cell('layout', 'm2', img('lay-grid1', 1948, 622)),
          cell('layout', 'm3', img('lay-hist', 1948, 680)),
          cell('layout', 'm4', img('lay-grid2', 1948, 766)),
        ],
      },
      {
        kind: 'mosaic',
        columns: 2,
        cells: [
          cell('layout', 'm5', img('layout-left', 2880, 2000)),
          cell('layout', 'm6', img('layout-equal', 2880, 2000)),
        ],
      },
      tip('layout'),
    ],
  },
  {
    id: 'themes',
    chapter: 'custom',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'mosaic',
        columns: 5,
        cells: [
          cell('themes', 'm1', img('theme-dark', 2880, 1640)),
          cell('themes', 'm2', img('theme-lighta', 2880, 1640)),
          cell('themes', 'm3', img('theme-lightb', 2880, 1640)),
          cell('themes', 'm4', img('theme-lightc', 2880, 1640)),
          cell('themes', 'm5', img('theme-lightd', 2880, 1640)),
        ],
      },
      { kind: 'mosaic', columns: 1, cells: [cell('themes', 'm6', img('access-tight', 1996, 864))] },
    ],
  },
  {
    id: 'roster',
    chapter: 'custom',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('chars-tight', 2440, 1400),
            titleKey: 'onboarding.roster.r1',
            lines: [line('roster', 'a1'), line('roster', 'a2'), line('roster', 'a3')],
          },
          {
            image: img('chars-add', 1122, 838, { natural: true }),
            titleKey: 'onboarding.roster.r2',
            lines: [line('roster', 'b1')],
          },
        ],
      },
    ],
  },
  {
    id: 'account',
    chapter: 'custom',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'zigzag',
        rows: [
          {
            image: img('conn-guest', 1980, 746),
            titleKey: 'onboarding.account.r1',
            lines: [line('account', 'a1')],
          },
          {
            image: img('conn-auth', 1964, 1892),
            titleKey: 'onboarding.account.r2',
            lines: [1, 2, 3, 4].map((n) => line('account', `b${n}`)),
          },
        ],
      },
      tip('account'),
    ],
  },
  {
    id: 'mobile',
    chapter: 'custom',
    essential: false,
    hasLede: true,
    blocks: [
      {
        kind: 'mosaic',
        columns: 4,
        phones: true,
        cells: [
          cell('mobile', 'm1', img('m-dash', 1170, 2532)),
          cell('mobile', 'm2', img('m-tracker', 1170, 2532)),
          cell('mobile', 'm3', img('m-burger', 1170, 2532)),
          cell('mobile', 'm4', img('m-sheet', 1170, 2532)),
        ],
      },
    ],
  },

  { id: 'done', chapter: null, essential: true, hasLede: false, blocks: [] },
];
