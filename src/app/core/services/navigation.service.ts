import { computed, Injectable, signal } from '@angular/core';

export type AppView = 'main' | 'profile' | 'legal' | 'account';

type SlideDirection = 'forward' | 'backward';

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

  /** Consommé une seule fois par `ProfilePageComponent` : force l'onglet Connexion (section
   * Discord/Google, voir CLAUDE.md) à la prochaine ouverture de la page profil. Remplace l'ancienne
   * vue de connexion dédiée (`AppView` 'login', supprimée) — la page compte (état invité) déclenche
   * `requestProfileConnectionTab()` avant de naviguer vers `profile`. */
  readonly profileConnectionTabRequested = signal(false);

  readonly view = computed(() => {
    const s = this.stack();
    return s[s.length - 1];
  });

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
   *    empile normalement (anime en avant), même comportement que `openProfile()` etc. */
  goTo(view: AppView): void {
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
