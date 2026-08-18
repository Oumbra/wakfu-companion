import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { NavigationService } from './navigation.service';

/** Attend le tick programmé par `goTo()` pour désactiver `skipInitialTransition` après le tout
 * premier appel (voir son commentaire — un `setTimeout` réel, pas un timer simulé). */
const flushInitialTransitionFlip = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('NavigationService', () => {
  let nav: NavigationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    nav = TestBed.inject(NavigationService);
  });

  it('positionne directement une vue non-main dès le tout premier goTo(), sans passer par transitionPeer', () => {
    nav.goTo('profile');

    expect(nav.view()).toBe('profile');
    expect(nav.panelTransform('profile')).toBe('translateX(0%)');
    // Aucun "peer" de transition posé : le panneau `main` reste simplement hors écran, il n'anime
    // pas aux côtés de `profile` comme il le ferait pour une navigation normale.
    expect(nav.panelTransform('main')).toBe('translateX(-100%)');
  });

  it('place `main` sous la vue initiale (pas [view] seul) pour que le bouton "Retour" (pop()) fonctionne après un F5', () => {
    // Bug réel : un lien direct/F5 vers /profile plaçait la pile à ['profile'] seul, sans 'main'
    // en dessous — pop() (bouton "Retour" de <app-page>) est un no-op sur une pile à un élément
    // (voir son commentaire), le bouton restait donc bloqué sur profile après un rechargement.
    nav.goTo('profile');

    nav.pop();

    expect(nav.view()).toBe('main');
  });

  it('conserve `skipInitialTransition` actif jusqu’au tick suivant le premier goTo(), puis le désactive', async () => {
    expect(nav.skipInitialTransition()).toBe(true);

    nav.goTo('profile');
    expect(nav.skipInitialTransition()).toBe(true);

    await flushInitialTransitionFlip();
    expect(nav.skipInitialTransition()).toBe(false);
  });

  it("un premier goTo('main') ne modifie pas la pile mais désactive quand même skipInitialTransition ensuite", async () => {
    nav.goTo('main');
    expect(nav.view()).toBe('main');

    await flushInitialTransitionFlip();
    expect(nav.skipInitialTransition()).toBe(false);
  });

  it('un DEUXIÈME goTo() (après le premier) retrouve le comportement animé normal (push)', async () => {
    nav.goTo('profile');
    await flushInitialTransitionFlip();

    nav.goTo('legal');

    expect(nav.view()).toBe('legal');
    expect(nav.panelTransform('legal')).toBe('translateX(0%)');
    // `profile` est le transitionPeer en cours (direction 'forward') : sort par la gauche.
    expect(nav.panelTransform('profile')).toBe('translateX(-100%)');
  });
});
