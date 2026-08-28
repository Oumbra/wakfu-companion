import { Injectable, signal } from '@angular/core';

/**
 * Emplacement du tooltip par rapport à l'élément cible. Les variantes
 * `-left`/`-right` ancrent le tooltip sur le bord gauche/droit de l'élément
 * (au lieu de le centrer) pour éviter un débordement d'écran quand
 * l'élément est lui-même proche d'un bord — mêmes cas d'usage que les
 * anciennes classes `.tooltip-align-left`/`.tooltip-align-right` de
 * styles.css. `left`/`right` seuls placent le tooltip sur le côté de
 * l'élément (centré verticalement), pour un élément collé au bord haut/bas.
 */
export type TooltipPosition =
  'top' | 'top-left' | 'top-right' | 'bottom' | 'bottom-left' | 'bottom-right' | 'left' | 'right';

export interface TooltipRequest {
  readonly id: string;
  readonly text: string;
  /** Rect de l'élément cible au moment de l'affichage (`getBoundingClientRect`,
   * donc relatif au viewport — cohérent avec le `position: fixed` du tooltip). */
  readonly rect: DOMRect;
  readonly position: TooltipPosition;
  readonly multiline: boolean;
  /** Contenu en colonnes libellé/valeur (rendu en grille CSS par `TooltipComponent`), prioritaire
   * sur `text` quand non `null` — remplace le 2026-08-28 un ancien mécanisme par padding de texte
   * (police monospace + espaces insécables comptés en nombre de caractères), qui suppose une
   * largeur de libellé fixe et casse dès qu'une traduction produit un libellé plus long que prévu
   * (bug réel constaté en espagnol : "Intercambios recibidos"/"Casa de subastas" provoquaient un
   * retour à la ligne qui désalignait toute la colonne valeurs). Une grille CSS n'a pas ce problème
   * : chaque ligne garde sa valeur alignée dans sa propre colonne quelle que soit la longueur du
   * libellé, y compris si celui-ci doit lui-même passer sur 2 lignes. Voir
   * `SessionRecapComponent.buildKamasTooltipRows`. */
  readonly rows: readonly (readonly [string, string])[] | null;
}

/**
 * Point d'entrée unique pour afficher le tooltip générique de l'app. Rendu
 * une seule fois au niveau racine (`app.html`, `<app-tooltip />`), en
 * `position: fixed` calculé depuis `getBoundingClientRect()` — même principe
 * que `ClassPickerService` : ça échappe à la fois à tout ancêtre `overflow`
 * (le tooltip n'est JAMAIS un descendant DOM de l'élément survolé) et à tout
 * ancêtre `transform`/contexte d'empilement local (voir CLAUDE.md, gotcha
 * "position: fixed niché dans un ancêtre transform").
 *
 * Consommé via `TooltipDirective` (`[appTooltip]`) plutôt qu'appelé
 * directement par les composants métier.
 */
@Injectable({ providedIn: 'root' })
export class TooltipService {
  readonly request = signal<TooltipRequest | null>(null);

  show(req: TooltipRequest): void {
    this.request.set(req);
  }

  /** Ne masque que si c'est bien CE demandeur qui est affiché — évite qu'un
   * `hide()` tardif (ex. `blur` after `mouseleave` a déjà ouvert un autre
   * tooltip) n'efface le tooltip d'un autre élément. */
  hide(id: string): void {
    if (this.request()?.id === id) {
      this.request.set(null);
    }
  }
}
