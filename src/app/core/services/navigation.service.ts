import { computed, Injectable, signal } from '@angular/core';

export type AppView = 'main' | 'profile' | 'legal' | 'account';

/** Onglets mobile du tableau de bord (voir `DashboardComponent`, sur `main`) — définis ici (plutôt
 * que dans le composant) pour que `NavigationService`/`RouteSyncService`/`app.routes.ts` puissent
 * s'y référer sans dépendre d'un composant `features/`. `'tracker'` est la racine (path `''`, pas
 * de segment dédié) — voir `pagePathFor`. Pas de `'damage'` : le combat en cours vit désormais dans
 * `'history'` (sous-onglet Combats, voir CLAUDE.md/FightHistoryComponent) plutôt que dans un onglet
 * dédié. `'history'` reste une seule valeur ici même si `DashboardComponent` y distingue plusieurs
 * onglets mobile (un par volet scindé, voir `DashboardLayoutService.historySplitKeys`) — la
 * granularité fine est portée par `historyTab` (ci-dessous), pas par cette union. `'recap'` (carte
 * Récap de session, voir CLAUDE.md) suit le même principe générique que `'chat'` dans `pagePathFor`
 * (`/${dashboardTab}`, pas de cas particulier) : contrairement à Historique, une seule carte possible,
 * pas besoin d'un sous-niveau. */
export type DashboardTab = 'tracker' | 'history' | 'chat' | 'recap';

/** Onglets du rail de la page profil (voir `ProfilePageComponent`, sur `profile`) — même raison
 * d'être ici que `DashboardTab`. `'avatar'` est la racine de `/profile` (pas de segment dédié). */
export type ProfileTab =
  'avatar' | 'customization' | 'colorblind' | 'connection' | 'alerts' | 'characters';

/** Segment d'URL de chaque `ProfileTab` — distinct de l'id interne pour `colorblind`, dont le
 * segment public est `accessibility` (le rail regroupe déjà plus que le seul mode daltonien sous ce
 * libellé, voir `profile.railAccessibility`) sans qu'il vaille la peine de renommer l'id interne
 * (encore utilisé tel quel par `ColorblindService`/le reste du composant). Les autres onglets
 * gardent leur id comme segment (mapping identité). */
const PROFILE_TAB_SEGMENT: Record<Exclude<ProfileTab, 'avatar'>, string> = {
  customization: 'customization',
  colorblind: 'accessibility',
  connection: 'connection',
  alerts: 'alerts',
  characters: 'characters',
};

/** Sous-onglets du panneau "Historique" (voir `HistoryComponent`, un cran sous `DashboardTab`
 * `'history'`) — même raison d'être ici que `DashboardTab`/`ProfileTab`. `'combats'` est la racine
 * de `/history` (pas de segment dédié), mais reste aussi joignable explicitement via `/history/fights`
 * (voir `app.routes.ts`) — alias accepté en entrée, jamais généré par `pagePathFor`. */
export type HistoryTab = 'combats' | 'purchases' | 'trades';

/** Segment d'URL de chaque `HistoryTab` non-racine — `'combats'` s'appelle `fights` côté URL (mot
 * public, cohérent avec `FightHistoryComponent`/`HistoryEventKind: 'fight'`) même si l'id interne
 * reste `combats` (déjà utilisé tel quel dans `HistoryComponent`). */
const HISTORY_TAB_SEGMENT: Record<Exclude<HistoryTab, 'combats'>, string> = {
  purchases: 'purchases',
  trades: 'trades',
};

type SlideDirection = 'forward' | 'backward';

/** Chemin de page (sans préfixe de langue) pour une vue donnée — partagé entre `RouteSyncService`
 * (état → URL) et `SeoService` (canonical/hreflang) pour que les deux restent forcément
 * synchronisés avec `app.routes.ts` plutôt que de dupliquer ce switch à deux endroits.
 *
 * `dashboardTab`/`profileTab` (ignorés hors de leur vue respective) ajoutent le segment de la
 * section active dans la page — omis quand elle vaut sa valeur "racine" (`tracker`/`avatar`) pour
 * que l'URL par défaut reste la même qu'avant cette fonctionnalité (`/fr`, `/fr/profile`).
 * `historyTab` n'est lu que quand `dashboardTab === 'history'` (sous-niveau propre à ce seul
 * onglet) — même règle de racine omise pour `'combats'`. */
export function pagePathFor(
  view: AppView,
  legalKind: 'notice' | 'privacy' | 'terms' | null,
  dashboardTab: DashboardTab | null = null,
  profileTab: ProfileTab | null = null,
  historyTab: HistoryTab | null = null,
): string {
  switch (view) {
    case 'profile':
      return profileTab && profileTab !== 'avatar'
        ? `/profile/${PROFILE_TAB_SEGMENT[profileTab]}`
        : '/profile';
    case 'account':
      return '/account';
    case 'legal':
      if (legalKind === 'privacy') return '/privacy-policy';
      if (legalKind === 'terms') return '/terms-of-service';
      return '/legal-notice';
    case 'main':
      if (!dashboardTab || dashboardTab === 'tracker') return '';
      if (dashboardTab === 'history') {
        return historyTab && historyTab !== 'combats'
          ? `/history/${HISTORY_TAB_SEGMENT[historyTab]}`
          : '/history';
      }
      return `/${dashboardTab}`;
    default:
      return '';
  }
}

/**
 * Vue actuellement affichée et mécanique de navigation avec animation directionnelle : chaque vue
 * (main/profile/legal) est un panneau toujours monté, positionné en absolu et translaté
 * individuellement (voir app.html/app.css `.view-panel`, un par AppView) — c'est `panelTransform`
 * ci-dessous qui calcule la position de CHAQUE panneau à chaque changement de navigation.
 *
 * `view` est le sommet d'une vraie pile (`stack`), pas un simple couple courant/précédent : un
 * couple courant/précédent unique se corrompt dès qu'on enchaîne 2 navigations (ex. légal ouvert
 * depuis profil, puis retour, puis retour à nouveau depuis profil vers main — testé en session,
 * le second retour renvoyait à tort vers légal). La pile garantit qu'un `pop()` retrouve toujours
 * exactement la vue d'où l'on venait, quelle que soit la profondeur déjà parcourue.
 *
 * `transitionPeer`/`direction` sont en revanche purement transitoires : ils ne servent qu'à savoir
 * quel AUTRE panneau anime aux côtés du panneau courant pendant LA transition en cours (sort par
 * la gauche en avançant, par la droite en revenant), recalculés à chaque `push`/`pop` à partir de
 * l'état de la pile à cet instant — jamais réutilisés pour décider où va un `pop()` ultérieur.
 *
 * Règle de positionnement de chaque panneau (voir `panelTransform`), volontairement indépendante
 * de tout ordre figé entre les vues : elle reste correcte quel que soit le chemin de navigation
 * réel (main→profil, main→légal, profil→légal, légal→profil...) sans avoir besoin de connaître à
 * l'avance "l'ordre" des pages :
 *  - la vue courante est toujours à `translateX(0%)` ;
 *  - l'autre vue impliquée dans la transition en cours (`transitionPeer`) sort par la gauche si on
 *    avance (`forward`), par la droite si on revient en arrière (`backward`) ;
 *  - toute vue inactive (ni courante ni `transitionPeer`) repose du côté par lequel elle entrera
 *    un jour : `main` (jamais atteinte que par un retour, elle n'est jamais poussée sur la pile)
 *    repose à gauche, les autres (toujours atteintes par une action d'ouverture explicite)
 *    reposent à droite.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly stack = signal<AppView[]>(['main']);
  private readonly transitionPeer = signal<AppView | null>(null);
  private readonly direction = signal<SlideDirection>('forward');
  /** Vues jamais retirées une fois ajoutées (contrairement à `stack`, qui ne retient que le
   * chemin de retour) — pilote le chargement différé de `profile`/`legal` (voir app.html, `@defer
   * (when nav.hasVisited(...))`) : leur code n'est chargé qu'à la première navigation vers eux,
   * puis reste monté pour de bon (même règle que "panneau toujours monté" ci-dessus, désormais
   * vraie seulement après la première visite plutôt que dès le démarrage). */
  private readonly visited = signal<ReadonlySet<AppView>>(new Set(['main']));

  /** Vrai depuis la construction du service jusqu'à peu après la toute première résolution de vue
   * depuis l'URL (`goTo()`, appelé par `RouteBridgeComponent` — lien direct ou F5, voir son
   * commentaire) : couvre TOUT l'écart, potentiellement asynchrone (ex. `fileConnectedGuard` qui
   * attend `LogFileAccessService.ready`, voir son commentaire), entre le tout premier paint de
   * `.view-panel` (valeur par défaut du panneau ciblé, souvent hors écran) et le moment où
   * `goTo()` fixe sa position finale. Posé en CSS via `[class.no-transition]` sur chaque
   * `.view-panel` (voir app.html/app.css) : sans lui, ce premier positionnement se ferait glisser
   * comme une vraie navigation en cours d'utilisation — alors qu'il n'y a rien à faire glisser
   * "depuis" sur un chargement, la page doit apparaître directement dans sa position finale. */
  readonly skipInitialTransition = signal(true);
  private initialViewResolved = false;

  /** Consommé une seule fois par `ProfilePageComponent` : force l'onglet Connexion (section
   * Discord/Google, voir CLAUDE.md) à la prochaine ouverture de la page profil. Remplace l'ancienne
   * vue de connexion dédiée (`AppView` 'login', supprimée) — la page compte (état invité) déclenche
   * `requestProfileConnectionTab()` avant de naviguer vers `profile`. */
  readonly profileConnectionTabRequested = signal(false);

  readonly view = computed(() => {
    const s = this.stack();
    return s[s.length - 1];
  });

  /** Section active de `main`/`profile` — source unique de vérité, lue/écrite directement par
   * `DashboardComponent`/`ProfilePageComponent` (leur `activeTab` local a été remplacé par un
   * alias vers ces signaux) ET par `RouteBridgeComponent`/`RouteSyncService` (URL ↔ état) : mêmes
   * signaux des deux côtés, pas de synchronisation à maintenir entre deux copies. Valeur par
   * défaut = section "racine" de chaque page (voir `pagePathFor`). */
  readonly dashboardTab = signal<DashboardTab>('tracker');
  readonly profileTab = signal<ProfileTab>('avatar');
  /** Même principe, un cran sous `dashboardTab === 'history'` — voir `HistoryComponent`. */
  readonly historyTab = signal<HistoryTab>('combats');

  hasVisited(view: AppView): boolean {
    return this.visited().has(view);
  }

  openProfile(): void {
    this.push('profile');
  }

  openLegal(): void {
    this.push('legal');
  }

  requestProfileConnectionTab(): void {
    this.profileConnectionTabRequested.set(true);
  }

  /** Même mécanisme que ci-dessus, pour l'onglet Personnages : c'est là que se déclare le serveur
   * de jeu (lot 7), et le badge du header y renvoie quand rien n'est renseigné. */
  readonly profileCharactersTabRequested = signal(false);

  requestProfileCharactersTab(): void {
    this.profileCharactersTabRequested.set(true);
  }

  /** Page compte (identité, sessions, données, suppression). */
  openAccount(): void {
    this.push('account');
  }

  /** Remplace la vue courante par `view` sans empiler (le retour ramène donc là d'où l'on venait
   * AVANT la vue courante). Utilisé au retour de connexion : passer de « connexion » à « compte »
   * ne doit pas laisser la page de connexion dans le chemin de retour, elle n'a plus de sens une
   * fois connecté. */
  replace(view: AppView): void {
    const s = this.stack();
    const top = s[s.length - 1];
    if (top === view) return;
    this.direction.set('forward');
    this.transitionPeer.set(top);
    this.stack.set([...s.slice(0, -1), view]);
    if (!this.visited().has(view)) {
      this.visited.set(new Set([...this.visited(), view]));
    }
  }

  /** Retire le sommet de la pile pour révéler la vue précédente — ne fait rien s'il n'y a nulle
   * part où revenir (déjà sur `main`, la racine). */
  pop(): void {
    const s = this.stack();
    if (s.length <= 1) return;
    this.direction.set('backward');
    this.transitionPeer.set(s[s.length - 1]);
    this.stack.set(s.slice(0, -1));
  }

  /** Rejoint `view` par le chemin le plus court dans la pile plutôt que d'empiler aveuglément —
   * utilisé par `RouteSyncService` (URL dédiée par page, voir app.routes.ts) pour réconcilier une
   * navigation venue de l'URL (lien direct, F5, précédent/suivant du navigateur) avec cette pile :
   *  - déjà au sommet : ne fait rien ;
   *  - `view` est plus bas dans la pile (ex. légal → profil alors que profil précède déjà légal) :
   *    dépile jusqu'à `view`, comme un retour classique (anime en arrière) ;
   *  - sinon (vue jamais visitée sur ce chemin, ex. lien direct `/profil` au tout premier chargement) :
   *    empile normalement (anime en avant), même comportement que `openProfile()` etc.
   *
   * Cas particulier du TOUT premier appel (voir `skipInitialTransition`) : c'est systématiquement
   * `RouteBridgeComponent` qui traduit la toute première résolution d'URL (lien direct/F5) en
   * appel à cette méthode — place directement `view` en sommet de pile (avec `main` en dessous,
   * PAS `[view]` seul : le bouton "Retour" de `<app-page>` doit pouvoir dépiler, voir plus bas),
   * sans passer par `transitionPeer`/`push`, pour qu'aucune transition ne puisse s'y accrocher.
   * Les appels suivants (navigation réelle en cours d'utilisation, y compris un futur changement
   * d'URL) retrouvent le comportement normal ci-dessus. */
  goTo(view: AppView): void {
    if (!this.initialViewResolved) {
      this.initialViewResolved = true;
      if (view !== 'main') {
        // `['main', view]`, PAS `[view]` seul : sans `main` en dessous, le bouton "Retour" de
        // `<app-page>` (qui appelle `pop()`) ne trouverait rien à dépiler sur un lien direct/F5
        // vers une page non-main (bug réel corrigé en session — `pop()` ignore une pile à un seul
        // élément, voir son commentaire) alors que l'utilisateur doit pouvoir revenir au tableau
        // de bord comme s'il y était passé normalement.
        this.stack.set(['main', view]);
        if (!this.visited().has(view)) {
          this.visited.set(new Set([...this.visited(), view]));
        }
      }
      // Laisse ce premier positionnement (sans transition) être peint avant de réactiver les
      // transitions pour les navigations suivantes, celles-là réellement déclenchées en cours
      // d'utilisation.
      setTimeout(() => this.skipInitialTransition.set(false));
      return;
    }
    const s = this.stack();
    const top = s[s.length - 1];
    if (top === view) return;
    const idx = s.lastIndexOf(view);
    if (idx !== -1) {
      this.direction.set('backward');
      this.transitionPeer.set(top);
      this.stack.set(s.slice(0, idx + 1));
      return;
    }
    this.push(view);
  }

  /** Empile `view` — ignore silencieusement si on y est déjà (ex. changer de contenu légal alors
   * qu'on est déjà sur la page légale ne doit pas ré-empiler ni ré-animer). */
  private push(view: AppView): void {
    const s = this.stack();
    const top = s[s.length - 1];
    if (top === view) return;
    this.direction.set('forward');
    this.transitionPeer.set(top);
    this.stack.set([...s, view]);
    if (!this.visited().has(view)) {
      this.visited.set(new Set([...this.visited(), view]));
    }
  }

  /** Position (transform CSS) du panneau `view` — voir la doc de classe pour la règle. */
  panelTransform(view: AppView): string {
    if (this.view() === view) return 'translateX(0%)';
    if (this.transitionPeer() === view) {
      return this.direction() === 'forward' ? 'translateX(-100%)' : 'translateX(100%)';
    }
    return view === 'main' ? 'translateX(-100%)' : 'translateX(100%)';
  }
}
