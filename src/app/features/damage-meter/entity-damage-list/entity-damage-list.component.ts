import { Component, computed, inject, input, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { EntityDamageRow, StatsStoreService } from '../../../core/services/stats-store.service';
import { EntityClassifierService, EntitySide } from '../../../core/services/entity-classifier.service';
import { I18nService } from '../../../core/services/i18n.service';
import { NumberFrPipe } from '../../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../../shared/entity-icon/entity-icon.component';
import { KoIconComponent } from '../../../shared/ko-icon/ko-icon.component';
import { TranslatePipe } from '../../../shared/translate.pipe';
import { ClassPickerService } from '../../../core/services/class-picker.service';
import { DamageElement } from '../../../core/models/log-entry.model';
import {
  HEADER_ICON_ALLIES_DATA_URI,
  HEADER_ICON_ENEMIES_DATA_URI,
} from '../../../core/data/header-icons.data';

const ELEMENT_CLASS: Record<DamageElement, string> = {
  Feu: 'dmg-fire',
  Air: 'dmg-air',
  Terre: 'dmg-earth',
  Eau: 'dmg-water',
  Lumière: 'dmg-light',
  Stasis: 'dmg-stasis',
  Neutre: 'dmg-neutre',
  Inconnu: 'dmg-inconnu',
};

/**
 * Liste dépliable d'entités (alliés ou ennemis) avec détail des dégâts par
 * sort et icône. Réutilisée pour le combat en cours (glisser-déposer actif,
 * `interactive=true`) et pour chaque entrée de l'historique (lecture seule).
 */
@Component({
  selector: 'app-entity-damage-list',
  imports: [NumberFrPipe, KeyValuePipe, EntityIconComponent, KoIconComponent, TranslatePipe],
  templateUrl: './entity-damage-list.component.html',
  styleUrl: './entity-damage-list.component.css',
})
export class EntityDamageListComponent {
  readonly title = input.required<string>();
  readonly side = input.required<EntitySide>();
  readonly rows = input<EntityDamageRow[]>([]);
  readonly interactive = input(false);
  readonly emptyMessage = input('Aucun dégât enregistré.');
  /** Historique de combat uniquement : rend le header cliquable pour replier
   * toute la section (ouverte par défaut), contrairement au combat en cours
   * qui reste toujours visible. */
  readonly collapsible = input(false);

  private readonly classifier = inject(EntityClassifierService);
  private readonly stats = inject(StatsStoreService);
  private readonly classPickerService = inject(ClassPickerService);
  protected readonly i18n = inject(I18nService);
  private readonly expandedNames = signal<ReadonlySet<string>>(new Set());
  protected readonly dragOver = signal(false);
  protected readonly sectionExpanded = signal(true);
  protected readonly headerIcon = computed(() =>
    this.side() === 'ally' ? HEADER_ICON_ALLIES_DATA_URI : HEADER_ICON_ENEMIES_DATA_URI,
  );

  protected readonly total = computed(() => this.rows().reduce((sum, r) => sum + r.total, 0));
  private readonly maxTotal = computed(
    () => this.rows().reduce((max, r) => Math.max(max, r.total), 0) || 1,
  );

  protected displayName(row: EntityDamageRow): string {
    const base = this.side() === 'enemy' ? this.i18n.translateMonsterName(row.name) : row.name;
    // Plusieurs monstres (voire alliés) peuvent partager un même nom (voir Fight.enemies/allies) :
    // suffixe "#i" pour distinguer chaque ligne/instance, uniquement quand il y en a plus d'une.
    return row.instanceCount > 1 ? `${base} #${row.instanceIndex}` : base;
  }

  protected toggle(row: EntityDamageRow): void {
    if (row.total === 0) return;
    const next = new Set(this.expandedNames());
    if (next.has(row.name)) next.delete(row.name);
    else next.add(row.name);
    this.expandedNames.set(next);
  }

  protected isExpanded(name: string): boolean {
    return this.expandedNames().has(name);
  }

  protected toggleSection(): void {
    if (!this.collapsible()) return;
    this.sectionExpanded.update((v) => !v);
  }

  protected isTracked(name: string): boolean {
    return this.stats.isWatched(name);
  }

  protected barWidth(total: number): string {
    if (total === 0) return '0%';
    return `${Math.max(2, (total / this.maxTotal()) * 100)}%`;
  }

  protected elementClass(element: DamageElement): string {
    return ELEMENT_CLASS[element] ?? 'dmg-inconnu';
  }

  protected onDragStart(event: DragEvent, name: string): void {
    if (!this.interactive()) return;
    event.dataTransfer?.setData('text/plain', name);
  }

  protected onDragOverList(event: DragEvent): void {
    if (!this.interactive()) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeaveList(): void {
    this.dragOver.set(false);
  }

  protected onDropOnList(event: DragEvent): void {
    if (!this.interactive()) return;
    event.preventDefault();
    this.dragOver.set(false);
    const name = event.dataTransfer?.getData('text/plain');
    if (name) this.classifier.setOverride(name, this.side());
  }

  protected onContextMenu(event: MouseEvent, row: EntityDamageRow): void {
    if (this.side() === 'enemy') {
      event.preventDefault();
      this.stats.addWatchedEnemy(row.name);
      return;
    }
    if (this.side() === 'ally') {
      event.preventDefault();
      this.classPickerService.open(row.name, event.clientX, event.clientY, (className, gender) => {
        this.classifier.setManualClass(row.name, className, gender);
      });
    }
  }
}
