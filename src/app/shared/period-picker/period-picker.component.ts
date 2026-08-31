import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { PeriodPickerRequest } from '../../core/services/period-picker.service';
import {
  addLocalMonths,
  addLocalYears,
  localDayStart,
  localMonthStart,
  localYearStart,
  offsetForPeriodStart,
  periodBounds,
} from '../../core/utils/local-period.util';
import { EscapeCloseDirective } from '../escape-close.directive';

/** Une cellule du calendrier : `dateMs` = un instant quelconque À L'INTÉRIEUR de la période
 * représentée (peu importe lequel, seul son jour/mois/année calendaire compte — voir
 * `periodStartOf`), `null` = case vide de remplissage (grille jour uniquement, avant le 1er du
 * mois). `label` déjà formaté pour l'affichage (numéro de jour, nom de mois abrégé, année). */
interface PickerCell {
  dateMs: number | null;
  label: string;
}

/**
 * Mini calendrier de navigation de période (icône 📅 à côté du stepper ‹ › de
 * `SessionRecapComponent`) — complète le stepper (un pas à la fois) par un vrai sélecteur de date,
 * pour rejoindre une période éloignée sans multiplier les clics. Trois grilles selon la
 * granularité de la carte Récap au moment de l'ouverture (`position().granularity`, FIGÉE pour
 * toute la durée d'ouverture du picker — changer de granularité ferme d'abord ce picker, voir
 * `SessionRecapComponent.setGranularity`) :
 * - `day` : grille mensuelle classique (7 colonnes), page = un mois, prev/next = mois.
 * - `month` : grille de 12 cases (Jan-Déc), page = une année, prev/next = année.
 * - `year` : grille d'une décennie (10 cases), page = une décennie, prev/next = décennie.
 *
 * Rendu une seule fois au niveau racine (`app.html`), hors de tout ancêtre `transform` — voir
 * `PeriodPickerService`.
 */
@Component({
  selector: 'app-period-picker',
  imports: [EscapeCloseDirective],
  templateUrl: './period-picker.component.html',
  styleUrl: './period-picker.component.css',
})
export class PeriodPickerComponent implements OnDestroy {
  private readonly i18n = inject(I18nService);

  readonly position = input.required<PeriodPickerRequest>();
  readonly picked = output<number>();
  readonly closed = output<void>();

  /** Instant de référence de la "page" actuellement affichée (un mois/une année/une décennie selon
   * la granularité) — réinitialisé sur la page contenant `currentOffset` à chaque (ré)ouverture,
   * voir le `effect` du constructeur. Navigable via `prevPage`/`nextPage` sans changer `offset`
   * réellement sélectionné tant qu'aucune cellule n'est cliquée. */
  protected readonly pageAnchorMs = signal(0);

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  /** Bornes en instants (pas en pas d'offset) — recalculées à chaque ouverture, `Date.now()` figé
   * une seule fois ici plutôt que relu à chaque cellule (évite qu'un calendrier resté ouvert à
   * cheval sur minuit ne change silencieusement quelle case est désactivée pendant la navigation). */
  private readonly nowMs = signal(Date.now());
  protected readonly maxStartMs = computed(
    () => periodBounds(this.position().granularity, 0, this.nowMs()).start,
  );
  protected readonly minStartMs = computed(
    () => periodBounds(this.position().granularity, this.position().min, this.nowMs()).start,
  );
  protected readonly selectedStartMs = computed(
    () =>
      periodBounds(this.position().granularity, this.position().currentOffset, this.nowMs()).start,
  );

  constructor() {
    effect(() => {
      const pos = this.position();
      this.nowMs.set(Date.now());
      this.pageAnchorMs.set(periodBounds(pos.granularity, pos.currentOffset, Date.now()).start);

      const el = this.pickerEl()?.nativeElement;
      this.resizeObserver?.disconnect();
      if (!el) return;
      this.resizeObserver = new ResizeObserver(() => this.updateDisplayPosition(el));
      this.resizeObserver.observe(el);
      this.updateDisplayPosition(el);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private updateDisplayPosition(el: HTMLElement): void {
    const pos = this.position();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
    this.displayPosition.set({
      left: Math.min(pos.x, maxLeft),
      top: Math.min(pos.y, maxTop),
    });
  }

  /** Début de période calendaire (jour/mois/année LOCAL) contenant `dateMs` — c'est CE point qui
   * détermine si deux cellules appartiennent à la même période (`isSelected`), pas `dateMs` lui-même. */
  private periodStartOf(dateMs: number): number {
    const g = this.position().granularity;
    if (g === 'day') return localDayStart(dateMs);
    if (g === 'month') return localMonthStart(dateMs);
    return localYearStart(dateMs);
  }

  protected readonly weekdayLabels = computed(() =>
    Array.from({ length: 7 }, (_, i) => this.i18n.formatWeekdayShort(i)),
  );

  /** En-tête de la page courante — "mois année" (jour), année seule (mois), plage de décennie
   * (année). */
  protected readonly pageLabel = computed(() => {
    const g = this.position().granularity;
    const anchor = this.pageAnchorMs();
    if (g === 'day') return this.i18n.formatMonth(anchor);
    if (g === 'month') return this.i18n.formatYear(anchor);
    const decadeStart = new Date(anchor).getFullYear();
    return `${decadeStart}–${decadeStart + 9}`;
  });

  protected readonly cells = computed<PickerCell[]>(() => {
    const g = this.position().granularity;
    const anchor = this.pageAnchorMs();
    if (g === 'day') return this.buildDayCells(anchor);
    if (g === 'month') return this.buildMonthCells(anchor);
    return this.buildYearCells(anchor);
  });

  private buildDayCells(anchorMs: number): PickerCell[] {
    const d = new Date(anchorMs);
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    // Grille lundi-first : getDay() 0=dimanche..6=samedi → décalé pour que lundi soit la colonne 0.
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: PickerCell[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ dateMs: null, label: '' });
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ dateMs: new Date(year, month, day).getTime(), label: String(day) });
    }
    while (cells.length % 7 !== 0) cells.push({ dateMs: null, label: '' });
    return cells;
  }

  private buildMonthCells(anchorMs: number): PickerCell[] {
    const year = new Date(anchorMs).getFullYear();
    return Array.from({ length: 12 }, (_, month) => {
      const dateMs = new Date(year, month, 1).getTime();
      return { dateMs, label: this.i18n.formatMonthShort(dateMs) };
    });
  }

  private buildYearCells(anchorMs: number): PickerCell[] {
    const decadeStart = Math.floor(new Date(anchorMs).getFullYear() / 10) * 10;
    return Array.from({ length: 10 }, (_, i) => {
      const dateMs = new Date(decadeStart + i, 0, 1).getTime();
      return { dateMs, label: String(decadeStart + i) };
    });
  }

  protected prevPage(): void {
    const g = this.position().granularity;
    const anchor = this.pageAnchorMs();
    if (g === 'day') this.pageAnchorMs.set(addLocalMonths(anchor, -1));
    else if (g === 'month') this.pageAnchorMs.set(addLocalYears(anchor, -1));
    else this.pageAnchorMs.set(addLocalYears(anchor, -10));
  }

  protected nextPage(): void {
    const g = this.position().granularity;
    const anchor = this.pageAnchorMs();
    if (g === 'day') this.pageAnchorMs.set(addLocalMonths(anchor, 1));
    else if (g === 'month') this.pageAnchorMs.set(addLocalYears(anchor, 1));
    else this.pageAnchorMs.set(addLocalYears(anchor, 10));
  }

  /** Bouton "suivant" désactivé une fois qu'aucune cellule de la page suivante ne pourrait de toute
   * façon être sélectionnable (page entièrement future) — même esprit que le stepper `app-stepper`
   * de la carte Récap ([max]="0"), pour ne jamais laisser naviguer vers une période qui n'existera
   * qu'après avoir cliqué "suivant" plusieurs fois pour rien. */
  protected isNextPageDisabled(): boolean {
    const g = this.position().granularity;
    const nextAnchor =
      g === 'day'
        ? addLocalMonths(this.pageAnchorMs(), 1)
        : g === 'month'
          ? addLocalYears(this.pageAnchorMs(), 1)
          : addLocalYears(this.pageAnchorMs(), 10);
    return this.periodStartOf(nextAnchor) > this.maxStartMs();
  }

  protected isCellDisabled(cell: PickerCell): boolean {
    if (cell.dateMs === null) return true;
    const start = this.periodStartOf(cell.dateMs);
    return start > this.maxStartMs() || start < this.minStartMs();
  }

  protected isCellSelected(cell: PickerCell): boolean {
    if (cell.dateMs === null) return false;
    return this.periodStartOf(cell.dateMs) === this.selectedStartMs();
  }

  protected pick(cell: PickerCell): void {
    if (cell.dateMs === null || this.isCellDisabled(cell)) return;
    const offset = offsetForPeriodStart(this.position().granularity, cell.dateMs, this.nowMs());
    this.picked.emit(offset);
  }

  protected close(): void {
    this.closed.emit();
  }
}
