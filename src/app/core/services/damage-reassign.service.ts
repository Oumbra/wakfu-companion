import { Injectable, signal } from '@angular/core';
import { EntityDamageRow } from './stats-store.service';

export interface DamageReassignEntity {
  name: string;
  instanceIndex: number;
}

export interface DamageReassignRequest {
  fightId: number;
  spell: string;
  from: DamageReassignEntity;
  x: number;
  y: number;
  /** Candidats des deux camps (voir StatsStoreService.getReassignCandidates) — l'entité d'origine
   * en est déjà exclue (aucun intérêt à se réattribuer une attaque à soi-même). */
  allies: EntityDamageRow[];
  enemies: EntityDamageRow[];
  onChosen: (to: DamageReassignEntity) => void;
}

/**
 * Point d'entrée unique pour ouvrir le sélecteur de réattribution de dégâts (clic droit sur une
 * ligne de sort dans le détail d'une entité — voir EntityDamageListComponent). Rendu une seule fois
 * au niveau racine (`app.html`), comme ClassPickerService : un composant niché dans un ancêtre
 * `transform` (`.recap-panel`, `.view-slider`...) verrait son `position: fixed` recalculé
 * relativement à cet ancêtre plutôt qu'au viewport (voir CLAUDE.md).
 */
@Injectable({ providedIn: 'root' })
export class DamageReassignService {
  readonly request = signal<DamageReassignRequest | null>(null);

  open(request: DamageReassignRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }
}
