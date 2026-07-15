import { Component, computed, inject, input, signal } from '@angular/core';
import { EntityClassifierService, EntitySide } from '../../core/services/entity-classifier.service';
import { CLASS_ICON_DATA_URI, UNKNOWN_ENTITY_ICON_DATA_URI } from '../../core/data/class-icons.data';
import { WAKFU_MONSTER_IMAGES_FR } from '../../core/data/wakfu-monster-images.data';

const MONSTER_IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/Nexus-Hub/Wakfu-Companion/master/public/assets/img/monsters/';

/**
 * Icône précédant une ligne de personnage/ennemi. Alliés : icône de classe
 * détectée, embarquée en base64 (toujours disponible hors-ligne). Ennemis :
 * illustration réelle chargée en direct depuis le dépôt du site de référence
 * si le nom correspond à un monstre connu, avec repli automatique sur une
 * icône générique (hors-ligne ou monstre inconnu) — voir le plan pour le
 * choix "semi-standalone".
 */
@Component({
  selector: 'app-entity-icon',
  template: `<img class="entity-icon" [src]="src()" (error)="onError()" alt="" />`,
  styles: [
    `
      .entity-icon {
        width: 22px;
        height: 22px;
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

  private readonly classifier = inject(EntityClassifierService);
  private readonly errored = signal(false);

  protected readonly src = computed(() => {
    if (this.errored()) return UNKNOWN_ENTITY_ICON_DATA_URI;

    if (this.side() === 'ally') {
      const className = this.classifier.getDetectedClass(this.name());
      return (className && CLASS_ICON_DATA_URI[className]) || UNKNOWN_ENTITY_ICON_DATA_URI;
    }

    const imgId = WAKFU_MONSTER_IMAGES_FR[this.name().toLowerCase().trim()];
    return imgId ? `${MONSTER_IMAGE_BASE_URL}${imgId}` : UNKNOWN_ENTITY_ICON_DATA_URI;
  });

  protected onError(): void {
    this.errored.set(true);
  }
}
