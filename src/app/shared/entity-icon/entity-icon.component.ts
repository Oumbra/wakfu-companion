import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { EntityClassifierService, EntitySide } from '../../core/services/entity-classifier.service';
import { getClassIconUri, UNKNOWN_ENTITY_ICON_DATA_URI } from '../../core/data/class-icons.data';
import { CatalogService, CatalogMonsterEntry } from '../../core/api/catalog.service';

/**
 * Construit la liste des URLs candidates pour un monstre : wakassets/monsters
 * puis wakassets/monsterIllustrations (quelques boss n'ont qu'une bannière
 * rectangulaire, voir monsterIllustrations/). Contrairement à l'ancienne
 * version (basée sur wakfu-monsters.data.ts), pas de repli sur l'image
 * officielle Ankama : `pictureUrl` a été volontairement exclu de l'index
 * compact (voir server/catalog/compact-index.ts) — impact mesuré négligeable
 * (9 monstres sur 851 sans wakassets, qui retombent sur l'icône générique).
 */
function monsterImageCandidates(entry: CatalogMonsterEntry): string[] {
  return [
    `https://vertylo.github.io/wakassets/monsters/${entry.gfxId}.png`,
    `https://vertylo.github.io/wakassets/monsterIllustrations/${entry.gfxId}.png`,
  ];
}

/**
 * Icône précédant une ligne de personnage/ennemi. Alliés : icône de classe
 * détectée, embarquée en base64 (toujours disponible hors-ligne). Ennemis :
 * illustration réelle résolue via une chaîne de sources déterminées par
 * `monsterImageCandidates` selon la disponibilité réelle du monstre sur
 * chaque CDN, avec repli automatique sur une icône générique (hors-ligne ou
 * monstre inconnu/sans image sur aucune source).
 */
@Component({
  selector: 'app-entity-icon',
  template: `<img
    class="entity-icon"
    [style.width.px]="size()"
    [style.height.px]="size()"
    [src]="src()"
    referrerpolicy="no-referrer"
    draggable="false"
    (error)="onError()"
    alt=""
  />`,
  styles: [
    `
      .entity-icon {
        object-fit: contain;
        border-radius: 3px;
        flex-shrink: 0;
      }
    `,
  ],
})
export class EntityIconComponent {
  readonly name = input.required<string>();
  readonly side = input.required<EntitySide>();
  /** Taille en px (carrée). Par défaut 22px, comme dans les listes de dégâts/suivi. */
  readonly size = input(22);

  private readonly classifier = inject(EntityClassifierService);
  private readonly catalog = inject(CatalogService);

  private readonly candidates = computed(() => {
    this.catalog.revision(); // dépendance réactive : recalcule une fois le catalogue chargé
    if (this.side() === 'ally') return [];
    const entry = this.catalog.findWakfuMonsterEntry(this.name());
    return entry ? monsterImageCandidates(entry) : [];
  });

  private readonly imgSrc = linkedSignal<string | null>(() => this.candidates()[0] ?? null);

  protected readonly src = computed(() => {
    if (this.side() === 'ally') {
      const className = this.classifier.getDetectedClass(this.name());
      return getClassIconUri(className, this.classifier.getGender(this.name()));
    }
    return this.imgSrc() ?? UNKNOWN_ENTITY_ICON_DATA_URI;
  });

  protected onError(): void {
    const list = this.candidates();
    const currentIndex = list.indexOf(this.imgSrc() ?? '');
    this.imgSrc.set(list[currentIndex + 1] ?? null);
  }
}
