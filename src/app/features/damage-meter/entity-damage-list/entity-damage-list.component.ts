import { Component, computed, inject, input, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { EntityDamageRow } from '../../../core/services/stats-store.service';
import { EntityClassifierService, EntitySide } from '../../../core/services/entity-classifier.service';
import { NumberFrPipe } from '../../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../../shared/entity-icon/entity-icon.component';
import { DamageElement } from '../../../core/models/log-entry.model';

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
  imports: [NumberFrPipe, KeyValuePipe, EntityIconComponent],
  templateUrl: './entity-damage-list.component.html',
  styleUrl: './entity-damage-list.component.css',
})
export class EntityDamageListComponent {
  readonly title = input.required<string>();
  readonly side = input.required<EntitySide>();
  readonly rows = input<EntityDamageRow[]>([]);
  readonly interactive = input(false);
  readonly emptyMessage = input('Aucun dégât enregistré.');

  private readonly classifier = inject(EntityClassifierService);
  private readonly expandedNames = signal<ReadonlySet<string>>(new Set());
  protected readonly dragOver = signal(false);

  protected readonly total = computed(() => this.rows().reduce((sum, r) => sum + r.total, 0));
  private readonly maxTotal = computed(
    () => this.rows().reduce((max, r) => Math.max(max, r.total), 0) || 1,
  );

  protected toggle(name: string): void {
    const next = new Set(this.expandedNames());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.expandedNames.set(next);
  }

  protected isExpanded(name: string): boolean {
    return this.expandedNames().has(name);
  }

  protected barWidth(total: number): string {
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
}
