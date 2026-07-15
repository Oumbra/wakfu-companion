import { Component, computed, inject, signal } from '@angular/core';
import {
  EntityDamageRow,
  FightRecord,
  StatsStoreService,
} from '../../core/services/stats-store.service';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityDamageListComponent } from './entity-damage-list/entity-damage-list.component';
import { HEADER_ICON_DAMAGE_DATA_URI } from '../../core/data/header-icons.data';

type MeterView = 'current' | 'history';

@Component({
  selector: 'app-damage-meter',
  imports: [NumberFrPipe, EntityDamageListComponent],
  templateUrl: './damage-meter.component.html',
  styleUrl: './damage-meter.component.css',
})
export class DamageMeterComponent {
  protected readonly headerIcon = HEADER_ICON_DAMAGE_DATA_URI;

  private readonly stats = inject(StatsStoreService);
  private readonly classifier = inject(EntityClassifierService);

  protected readonly view = signal<MeterView>('current');
  private readonly expandedFightIds = signal<ReadonlySet<number>>(new Set());

  protected readonly allyRows = computed<EntityDamageRow[]>(() =>
    this.stats.damageByAttacker().filter((r) => this.classifier.classify(r.name) === 'ally'),
  );
  protected readonly enemyRows = computed<EntityDamageRow[]>(() =>
    this.stats.damageByAttacker().filter((r) => this.classifier.classify(r.name) === 'enemy'),
  );

  protected readonly fightHistory = this.stats.fightHistory;

  protected setView(view: MeterView): void {
    this.view.set(view);
  }

  protected toggleFight(id: number): void {
    const next = new Set(this.expandedFightIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedFightIds.set(next);
  }

  protected isFightExpanded(id: number): boolean {
    return this.expandedFightIds().has(id);
  }

  protected allyRowsFor(record: FightRecord): EntityDamageRow[] {
    return record.rows.filter((r) => this.classifier.classify(r.name) === 'ally');
  }

  protected enemyRowsFor(record: FightRecord): EntityDamageRow[] {
    return record.rows.filter((r) => this.classifier.classify(r.name) === 'enemy');
  }
}
