import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  model,
  OnDestroy,
} from '@angular/core';
import { TooltipPosition, TooltipService } from '../../core/services/tooltip.service';

let nextId = 0;

/**
 * Tooltip générique de l'app — remplace à la fois l'ancien système CSS
 * `[title]`/`[attr.data-tooltip]` (`::after`, styles.css) et les
 * implémentations JS locales dupliquées (`nameTooltip`/`railTooltip` de
 * `profile-page`/`tracker-strip`). Rendu au niveau racine via
 * `TooltipService`/`<app-tooltip />` (`position: fixed`) : contrairement au
 * `::after` local, ÉCHAPPE à tout ancêtre `overflow: hidden`/`auto` (un
 * conteneur à défilement ne peut plus jamais rogner le tooltip) — c'est
 * précisément le problème que cette directive résout, voir CLAUDE.md.
 *
 * Usage : `[appTooltip]="'clé' | t"` (statique) ou `[appTooltip]="expr()"`
 * (dynamique), `[tooltipPosition]="'bottom-left'"` pour l'emplacement
 * (défaut `'top'`, centré au-dessus). `tooltipOnlyIfTruncated` réserve
 * l'affichage aux libellés réellement tronqués (`scrollWidth > clientWidth`)
 * — usage typique : noms de personnage/objet coupés par un `text-overflow:
 * ellipsis`.
 */
@Directive({
  selector: '[appTooltip]',
})
export class TooltipDirective implements OnDestroy {
  readonly appTooltip = model<string | null | undefined>();
  readonly tooltipPosition = input<TooltipPosition>('top');
  readonly tooltipMultiline = input(false);
  readonly tooltipMonospace = input(false);
  readonly tooltipOnlyIfTruncated = input(false);
  readonly tooltipDisabled = input(false);

  private readonly id = `app-tooltip-${nextId++}`;
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly tooltipService = inject(TooltipService);
  private visible = false;
  // Le tooltip étant en `position: fixed` calculé une fois à l'ouverture (pas
  // recalculé en continu), un défilement pendant qu'il est affiché le
  // laisserait "décroché" de sa cible (le scroll ne déclenche pas
  // `mouseleave`, contrairement à un vrai déplacement de souris) — on le
  // masque simplement dès qu'un défilement survient n'importe où (capture :
  // couvre aussi les conteneurs `overflow` internes, pas seulement la
  // fenêtre).
  private readonly onScroll = (): void => this.hide();

  @HostListener('mouseenter')
  protected onMouseEnter(): void {
    this.show();
  }

  // `:focus-visible` seulement (pas tout `focus`) : réplique le comportement
  // de l'ancien système CSS (`[title]:focus-visible::after`) — un focus
  // obtenu par clic souris ne doit pas afficher le tooltip, seulement la
  // navigation clavier (Tab).
  @HostListener('focus')
  protected onFocus(): void {
    if (this.el.nativeElement.matches(':focus-visible')) {
      this.show();
    }
  }

  @HostListener('mouseleave')
  @HostListener('blur')
  protected onHide(): void {
    this.hide();
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private show(): void {
    const text = this.appTooltip();
    if (!text || this.tooltipDisabled()) return;
    const el = this.el.nativeElement;
    if (this.tooltipOnlyIfTruncated() && el.scrollWidth <= el.clientWidth) return;
    this.visible = true;
    el.setAttribute('aria-describedby', this.id);
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.tooltipService.show({
      id: this.id,
      text,
      rect: el.getBoundingClientRect(),
      position: this.tooltipPosition(),
      multiline: this.tooltipMultiline(),
      monospace: this.tooltipMonospace(),
    });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.nativeElement.removeAttribute('aria-describedby');
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.tooltipService.hide(this.id);
  }
}
