import { Component, computed, inject, input, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import {
  EntityDamageRow,
  SpellBreakdownRow,
  StatsStoreService,
} from '../../../core/services/stats-store.service';
import {
  EntityClassifierService,
  EntitySide,
} from '../../../core/services/entity-classifier.service';
import { I18nService } from '../../../core/services/i18n.service';
import { LocaleNumberPipe } from '../../../shared/locale-number.pipe';
import { EntityIconComponent } from '../../../shared/entity-icon/entity-icon.component';
import { KoIconComponent } from '../../../shared/ko-icon/ko-icon.component';
import { TranslatePipe } from '../../../shared/translate.pipe';
import { ClassPickerService } from '../../../core/services/class-picker.service';
import { DamageReassignService } from '../../../core/services/damage-reassign.service';
import { DamageElement } from '../../../core/models/log-entry.model';
import { TooltipDirective } from '../../../shared/tooltip/tooltip.directive';
import { DamageViewMode } from '../../../shared/damage-view-switch/damage-view-switch.component';
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
  imports: [
    LocaleNumberPipe,
    KeyValuePipe,
    EntityIconComponent,
    KoIconComponent,
    TranslatePipe,
    TooltipDirective,
  ],
  templateUrl: './entity-damage-list.component.html',
  styleUrl: './entity-damage-list.component.css',
})
export class EntityDamageListComponent {
  readonly title = input.required<string>();
  readonly side = input.required<EntitySide>();
  readonly rows = input<EntityDamageRow[]>([]);
  readonly interactive = input(false);
  readonly emptyMessage = input('Aucun dégât enregistré.');
  /** `false` pour l'onglet Armure (voir EntityStatTabsComponent) : l'armure n'a pas de notion
   * d'élément (voir ArmorEntry), afficher un unique badge "Inconnu" égal au total du sort
   * n'apporterait rien. Toujours `true` par défaut (Dommage/Soin, comportement historique). */
  readonly showElements = input(true);
  /** Voir DamageViewSwitchComponent — 'total' (défaut) préserve le comportement historique (somme
   * de tout le combat). 'turn' recalcule chaque ligne/sort pour ne montrer que le tour visé
   * (`turn()`) ; la réattribution (voir onSpellContextMenu) reste inchangée dans les deux modes,
   * elle continue de déplacer TOUT l'historique du sort, pas seulement le tour affiché. */
  readonly viewMode = input<DamageViewMode>('total');
  /** Tour affiché (1-based) — ignoré tant que `viewMode()` vaut `'total'`. */
  readonly turn = input(1);
  /** Combat auquel appartiennent ces lignes (combat en cours ou déjà terminé) — nécessaire pour
   * résoudre les candidats et appliquer une réattribution d'attaque (voir onSpellContextMenu).
   * `null` : réattribution non proposée (ne devrait pas arriver en pratique, chaque appelant
   * connaît toujours le fightId des lignes qu'il transmet). */
  readonly fightId = input<number | null>(null);
  /** Historique de combat uniquement : rend le header cliquable pour replier
   * toute la section (ouverte par défaut), contrairement au combat en cours
   * qui reste toujours visible. */
  readonly collapsible = input(false);

  private readonly classifier = inject(EntityClassifierService);
  private readonly stats = inject(StatsStoreService);
  private readonly classPickerService = inject(ClassPickerService);
  private readonly damageReassign = inject(DamageReassignService);
  protected readonly i18n = inject(I18nService);
  private readonly expandedNames = signal<ReadonlySet<string>>(new Set());
  protected readonly dragOver = signal(false);
  protected readonly sectionExpanded = signal(true);
  protected readonly headerIcon = computed(() =>
    this.side() === 'ally' ? HEADER_ICON_ALLIES_DATA_URI : HEADER_ICON_ENEMIES_DATA_URI,
  );

  /** Lignes effectivement affichées : identiques à `rows()` en mode 'total', recalculées pour ne
   * garder que les dégâts du tour sélectionné en mode 'turn' (voir DamageViewSwitchComponent) —
   * seul point de la vue qui connaît le détail par tour, tout le reste du template (barres, total
   * d'en-tête, dépliage par sort...) continue de lire `row.total`/`row.spells` sans distinction. */
  protected readonly displayRows = computed<EntityDamageRow[]>(() => {
    if (this.viewMode() === 'total') return this.rows();
    const turn = this.turn();
    return this.rows()
      .map((row) => this.rowForTurn(row, turn))
      .sort((a, b) => b.total - a.total);
  });

  protected readonly total = computed(() =>
    this.displayRows().reduce((sum, r) => sum + r.total, 0),
  );
  private readonly maxTotal = computed(
    () => this.displayRows().reduce((max, r) => Math.max(max, r.total), 0) || 1,
  );

  /** Ne garde, pour ce tour, que les sorts ayant effectivement fait des dégâts (voir
   * SpellBreakdownRow.byTurn) — les autres champs de la ligne (nom, KO, instance...) restent ceux
   * du combat entier, seul `total`/`spells` sont restreints à ce tour. */
  private rowForTurn(row: EntityDamageRow, turn: number): EntityDamageRow {
    const spells: SpellBreakdownRow[] = row.spells
      .flatMap((spell) => {
        const turnAgg = spell.byTurn.find((t) => t.turn === turn);
        if (!turnAgg || turnAgg.total === 0) return [];
        return [
          {
            spell: spell.spell,
            total: turnAgg.total,
            byElement: turnAgg.byElement,
            byTurn: spell.byTurn,
          },
        ];
      })
      .sort((a, b) => b.total - a.total);
    return {
      ...row,
      total: spells.reduce((sum, s) => sum + s.total, 0),
      spells,
    };
  }

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

  /**
   * Clic droit sur une ligne de sort (une attaque précise, dans le détail déplié d'une entité) :
   * ouvre le sélecteur d'entité pour réattribuer cette attaque et tous ses dégâts déjà enregistrés
   * — correction manuelle d'une attribution automatique erronée (voir resolveNextActor,
   * StatsStoreService, ambiguïté inhérente quand plusieurs combattants partagent un nom).
   */
  protected onSpellContextMenu(
    event: MouseEvent,
    row: EntityDamageRow,
    spell: SpellBreakdownRow,
  ): void {
    const fightId = this.fightId();
    if (fightId === null) return;
    event.preventDefault();
    event.stopPropagation();

    const { allies, enemies } = this.stats.getReassignCandidates(fightId);
    const isSelf = (candidate: EntityDamageRow): boolean =>
      candidate.name === row.name && candidate.instanceIndex === row.instanceIndex;

    this.damageReassign.open({
      fightId,
      spell: spell.spell,
      from: { name: row.name, instanceIndex: row.instanceIndex },
      x: event.clientX,
      y: event.clientY,
      allies: allies.filter((r) => !isSelf(r)),
      enemies: enemies.filter((r) => !isSelf(r)),
      onChosen: (to) =>
        this.stats.reassignSpell(
          fightId,
          spell.spell,
          { name: row.name, instanceIndex: row.instanceIndex },
          to,
        ),
    });
  }
}
