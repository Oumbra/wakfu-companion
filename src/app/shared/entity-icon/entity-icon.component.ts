import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { EntityClassifierService, EntitySide } from '../../core/services/entity-classifier.service';
import { CLASS_ICON_DATA_URI, UNKNOWN_ENTITY_ICON_DATA_URI } from '../../core/data/class-icons.data';
import { WAKFU_MONSTERS_FR, WakfuMonsterEntry } from '../../core/data/wakfu-monsters.data';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';

/**
 * Construit la liste des URLs candidates pour un monstre, dans l'ordre :
 * wakassets/monsters puis wakassets/monsterIllustrations (si
 * `wakassetsAvailable` — quelques boss n'ont qu'une bannière rectangulaire,
 * voir monsterIllustrations/) puis l'image officielle Ankama (si
 * `wakfuAvailable`).
 */
function monsterImageCandidates(entry: WakfuMonsterEntry): string[] {
  const sources: string[] = [];
  if (entry.wakassetsAvailable) {
    sources.push(`https://vertylo.github.io/wakassets/monsters/${entry.gfxId}.png`);
    sources.push(`https://vertylo.github.io/wakassets/monsterIllustrations/${entry.gfxId}.png`);
  }
  if (entry.wakfuAvailable) {
    sources.push(entry.pictureUrl);
  }
  return sources;
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
    [src]="src()"
    referrerpolicy="no-referrer"
    (error)="onError()"
    alt=""
  />`,
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

  private readonly candidates = computed(() => {
    if (this.side() === 'ally') return [];
    const entry = WAKFU_MONSTERS_FR[normalizeWakfuName(this.name())];
    return entry ? monsterImageCandidates(entry) : [];
  });

  private readonly imgSrc = linkedSignal<string | null>(() => this.candidates()[0] ?? null);

  protected readonly src = computed(() => {
    if (this.side() === 'ally') {
      const className = this.classifier.getDetectedClass(this.name());
      return (className && CLASS_ICON_DATA_URI[className]) || UNKNOWN_ENTITY_ICON_DATA_URI;
    }
    return this.imgSrc() ?? UNKNOWN_ENTITY_ICON_DATA_URI;
  });

  protected onError(): void {
    const list = this.candidates();
    const currentIndex = list.indexOf(this.imgSrc() ?? '');
    this.imgSrc.set(list[currentIndex + 1] ?? null);
  }
}
