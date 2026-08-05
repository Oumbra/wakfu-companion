import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { EntitySide } from '../../core/services/entity-classifier.service';
import { DamageReassignEntity, DamageReassignRequest } from '../../core/services/damage-reassign.service';
import { EntityDamageRow } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { EntityIconComponent } from '../entity-icon/entity-icon.component';
import { TranslatePipe } from '../translate.pipe';
import {
  HEADER_ICON_ALLIES_DATA_URI,
  HEADER_ICON_ENEMIES_DATA_URI,
} from '../../core/data/header-icons.data';

/**
 * Sélecteur d'entité (allié/ennemi) pour réattribuer une attaque à un autre combattant — ouvert par
 * clic droit sur une ligne de sort (voir EntityDamageListComponent), même principe/positionnement
 * que ClassPickerComponent (rendu une seule fois au niveau racine, voir son commentaire pour le
 * piège `position: fixed` niché dans un ancêtre `transform`).
 */
@Component({
  selector: 'app-damage-reassign-picker',
  imports: [EntityIconComponent, TranslatePipe],
  templateUrl: './damage-reassign-picker.component.html',
  styleUrl: './damage-reassign-picker.component.css',
})
export class DamageReassignPickerComponent implements OnDestroy {
  readonly request = input.required<DamageReassignRequest>();
  readonly entityChosen = output<DamageReassignEntity>();
  readonly closed = output<void>();

  protected readonly i18n = inject(I18nService);

  protected readonly alliesIcon = HEADER_ICON_ALLIES_DATA_URI;
  protected readonly enemiesIcon = HEADER_ICON_ENEMIES_DATA_URI;

  /** Alliés affichés par défaut (voir énoncé de la fonctionnalité). */
  protected readonly side = signal<EntitySide>('ally');
  protected readonly candidates = computed<EntityDamageRow[]>(() =>
    this.side() === 'ally' ? this.request().allies : this.request().enemies,
  );
  /** Interpolé ici (pas via le pipe `t`, qui ne prend pas de paramètres) — voir I18nService.t(). */
  protected readonly title = computed(() =>
    this.i18n.t('damageMeter.reassignTitle', { spell: this.request().spell }),
  );

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  /** Même repositionnement anti-débordement que ClassPickerComponent, voir son commentaire. */
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      this.request();
      const el = this.pickerEl()?.nativeElement;
      this.resizeObserver?.disconnect();
      if (!el) return;
      this.resizeObserver = new ResizeObserver(() => this.updateDisplayPosition(el));
      this.resizeObserver.observe(el);
      this.updateDisplayPosition(el);
    });
  }

  private updateDisplayPosition(el: HTMLElement): void {
    const pos = this.request();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
    this.displayPosition.set({
      left: Math.min(pos.x, maxLeft),
      top: Math.min(pos.y, maxTop),
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  protected setSide(side: EntitySide): void {
    this.side.set(side);
  }

  protected displayName(row: EntityDamageRow): string {
    const base = this.side() === 'enemy' ? this.i18n.translateMonsterName(row.name) : row.name;
    return row.instanceCount > 1 ? `${base} #${row.instanceIndex}` : base;
  }

  protected choose(row: EntityDamageRow): void {
    this.entityChosen.emit({ name: row.name, instanceIndex: row.instanceIndex });
  }

  protected close(): void {
    this.closed.emit();
  }
}
