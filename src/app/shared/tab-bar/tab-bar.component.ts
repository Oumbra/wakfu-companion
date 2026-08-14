import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { HelpModalService, HelpSection } from '../../core/services/help-modal.service';
import { TabSheetService } from '../../core/services/tab-sheet.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

export interface TabBarItem {
  id: string;
  /** Clé i18n ou texte déjà résolu (ex. un nom de compte saisi par l'utilisateur) — toujours passé
   * dans le pipe `t`, qui renvoie la chaîne telle quelle si elle ne correspond à aucune clé
   * connue (voir I18nService.t) : les deux cas sont donc sans risque. */
  label: string;
  /** Tooltip optionnel (ex. le libellé complet d'un compte, toujours affiché — pas seulement en
   * cas de troncature) — même règle que `label` (clé ou texte déjà résolu). */
  tooltip?: string;
  /** Icône d'aide "?" imbriquée dans l'onglet (voir HelpModalService) — omise si absente. */
  helpSection?: HelpSection;
  /** Croix de suppression, affichée uniquement quand cet onglet est actif (voir `remove`). */
  removable?: boolean;
  /** Tooltip de la croix de suppression — clé ou texte déjà résolu. */
  removeTooltip?: string;
}

/**
 * Barre d'onglets réutilisable (voir CLAUDE.md) : chaque onglet garde sa largeur naturelle, la
 * barre défile horizontalement si elle déborde, l'onglet actif est repéré par un soulignement
 * mesuré sur le DOM (plutôt qu'un fond supposant des largeurs égales — bug réel corrigé en
 * session sur la page profil), et un bouton en tête de barre ouvre une feuille listant tous les
 * onglets (TabSheetComponent, voir TabSheetService) pour les cas où elle déborde. Inspiré du
 * sélecteur de catégories d'Uber Eats.
 *
 * `mobileOnly` couvre le cas où la barre ne sert qu'à remplacer, sous un certain seuil de largeur,
 * un agencement desktop où toutes les sections sont empilées sans onglets (page profil, dashboard
 * mobile) : cachée par défaut, visible seulement ≤800px. Sans lui (défaut `false`), la barre est
 * toujours affichée (ex. sous-onglets de compte dans Profil > Personnages, qui ont besoin d'un
 * vrai sélecteur à toute taille d'écran).
 *
 * Le contenu projeté (`<ng-content>`) s'ajoute après la liste d'onglets, dans le même conteneur à
 * défilement (ex. bouton "+" d'ajout de compte) — il défile donc avec les onglets, comme avant.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [TranslatePipe, TooltipDirective],
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.css',
})
export class TabBarComponent implements OnDestroy {
  protected readonly helpModal = inject(HelpModalService);
  private readonly tabSheet = inject(TabSheetService);

  readonly items = input.required<readonly TabBarItem[]>();
  readonly activeId = input.required<string>();
  /** Titre affiché en tête de la feuille de repli (voir TabSheetService) — clé i18n ou texte déjà
   * résolu, typiquement le titre de la page courante. */
  readonly sheetTitle = input<string>('');
  readonly mobileOnly = input(false);
  /** Tooltip du bouton "liste des onglets" — clé i18n ou texte déjà résolu. */
  readonly listTooltip = input('profile.tabListTooltip');

  readonly activeIdChange = output<string>();
  readonly remove = output<string>();

  private readonly barEl = viewChild<ElementRef<HTMLDivElement>>('barEl');
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');
  protected readonly sliderRect = signal({ left: 0, width: 0 });
  private containerResizeObserver?: ResizeObserver;
  private activeBtnResizeObserver?: ResizeObserver;

  constructor() {
    // Soulignement de l'onglet actif + défilement automatique pour le garder visible.
    // `bar.scrollTo` plutôt que `btn.scrollIntoView()` : ce dernier remonte tout l'arbre des
    // ancêtres à la recherche d'un conteneur scrollable et peut faire défiler un ancêtre
    // insoupçonné (ex. le slider de navigation entre vues, `overflow: hidden` mais scrollable par
    // programme) au lieu de la seule barre d'onglets — bug réel corrigé en session.
    effect(() => {
      const items = this.items();
      const activeId = this.activeId();
      const index = items.findIndex((item) => item.id === activeId);
      const btn = this.tabBtns()[index]?.nativeElement;
      const bar = this.barEl()?.nativeElement;
      this.observeActiveButton(btn);
      if (btn && bar) {
        const target = btn.offsetLeft + btn.offsetWidth / 2 - bar.clientWidth / 2;
        bar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      }
    });

    effect(() => {
      const el = this.barEl()?.nativeElement;
      this.containerResizeObserver?.disconnect();
      if (!el) return;
      this.containerResizeObserver = new ResizeObserver(() => this.updateSliderRect());
      this.containerResizeObserver.observe(el);
    });
  }

  ngOnDestroy(): void {
    this.containerResizeObserver?.disconnect();
    this.activeBtnResizeObserver?.disconnect();
  }

  /** Observe l'onglet actif pour recalculer le soulignement dès que SA taille change — notamment
   * quand la croix de suppression apparaît (elle n'est affichée que sur l'onglet actif, ce qui
   * fait grandir le bouton juste après qu'il le devienne). Lire `btn.offsetWidth` directement dans
   * l'effect() ci-dessus retombait sur la largeur transitoire d'avant cette croissance (le
   * soulignement n'englobait alors jamais la croix — bug réel corrigé en session, même piège que
   * `soundGridColumns`/`AutoFillColumnsObserver`, voir CLAUDE.md) : le `ResizeObserver` se
   * redéclenche dès que la taille réelle du bouton est atteinte et corrige le soulignement. */
  private observeActiveButton(btn: HTMLButtonElement | undefined): void {
    this.activeBtnResizeObserver?.disconnect();
    if (!btn) {
      this.sliderRect.set({ left: 0, width: 0 });
      return;
    }
    this.activeBtnResizeObserver = new ResizeObserver(() => this.updateSliderRect());
    this.activeBtnResizeObserver.observe(btn);
  }

  private updateSliderRect(): void {
    const index = this.items().findIndex((item) => item.id === this.activeId());
    const btn = this.tabBtns()[index]?.nativeElement;
    this.sliderRect.set(
      btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : { left: 0, width: 0 },
    );
  }

  protected select(id: string): void {
    this.activeIdChange.emit(id);
  }

  protected onRemove(event: Event, id: string): void {
    event.stopPropagation();
    this.remove.emit(id);
  }

  /** Ouvre la feuille listant tous les onglets (voir TabSheetService) — utile quand la barre
   * défile horizontalement et n'affiche donc pas forcément tous les onglets à la fois. */
  protected openSheet(): void {
    this.tabSheet.open(
      this.items().map((item) => ({ id: item.id, label: item.label })),
      this.activeId(),
      (id) => this.activeIdChange.emit(id),
      this.sheetTitle() || undefined,
    );
  }
}
