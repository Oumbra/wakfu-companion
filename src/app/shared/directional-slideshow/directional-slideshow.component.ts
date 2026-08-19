import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  TemplateRef,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

type SlideDirection = 'top' | 'right' | 'bottom' | 'left';

interface SlideFrame<T> {
  id: number;
  item: T;
  direction: SlideDirection;
}

/**
 * Diaporama directionnel générique : affiche successivement des éléments de `[items]` qui
 * « atterrissent » exactement à la même place (le bloc hôte, dimensionné par l'appelant — voir
 * CSS ci-dessous) en arrivant à tour de rôle depuis le haut, la droite, le bas puis la gauche
 * (cycle fixe et répété), tandis que l'élément affiché à chaque étape est tiré aléatoirement dans
 * la liste (jamais deux fois de suite le même s'il y en a plusieurs).
 *
 * Le rendu d'un élément est délégué à l'appelant via `[itemTemplate]` (pas d'`<img>` en dur) :
 * fonctionne aussi bien avec de simples URLs qu'avec un composant existant qui gère sa propre
 * source d'image (ex. `app-avatar-icon`, une case d'une planche/sprite plutôt qu'un fichier séparé
 * par élément — voir `character-add-form.component.html` pour un exemple d'intégration).
 *
 * Usage :
 * <app-directional-slideshow [items]="mesElements" [itemTemplate]="monTpl" />
 * <ng-template #monTpl let-item>
 *   <app-avatar-icon [index]="item" />
 * </ng-template>
 *
 * Purement décoratif (boucle aléatoire sans information propre à transmettre) : le composant se
 * pose lui-même `aria-hidden="true"`, quel que soit le contenu projeté par l'appelant.
 */
@Component({
  selector: 'app-directional-slideshow',
  imports: [NgTemplateOutlet],
  templateUrl: './directional-slideshow.component.html',
  styleUrl: './directional-slideshow.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
  },
})
export class DirectionalSlideshowComponent<T> implements OnInit, OnDestroy {
  /** Liste des éléments à faire défiler (rendus un par un via `itemTemplate`). */
  readonly items = input.required<readonly T[]>();

  /** Gabarit de rendu d'un élément — reçoit l'élément courant en contexte implicite (`let-x`). */
  readonly itemTemplate = input.required<TemplateRef<{ $implicit: T }>>();

  /** Intervalle entre deux apparitions, en millisecondes. */
  readonly intervalMs = input<number>(1800);

  /** Durée de l'animation d'entrée, en millisecondes. */
  readonly transitionMs = input<number>(650);

  protected readonly frames = signal<SlideFrame<T>[]>([]);

  /** Ordre fixe du cycle : haut, droite, bas, gauche. */
  private readonly cycle: readonly SlideDirection[] = ['top', 'right', 'bottom', 'left'];
  private cycleIndex = 0;
  private lastItemIndex = -1;
  private frameId = 0;
  private timerId?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.spawnFrame();
    this.timerId = setInterval(() => this.spawnFrame(), this.intervalMs());
  }

  ngOnDestroy(): void {
    if (this.timerId !== undefined) {
      clearInterval(this.timerId);
    }
  }

  private spawnFrame(): void {
    const list = this.items();
    if (!list.length) {
      return;
    }

    const direction = this.cycle[this.cycleIndex % this.cycle.length];
    this.cycleIndex++;

    const itemIndex = this.pickRandomIndex(list.length);
    const frame: SlideFrame<T> = {
      id: this.frameId++,
      item: list[itemIndex],
      direction,
    };

    this.frames.update((current) => [...current, frame]);

    // Une fois l'animation d'entrée terminée, le nouveau cadre recouvre exactement le précédent :
    // on peut nettoyer les cadres obsolètes du DOM sans impact visuel.
    const cleanupDelay = this.transitionMs() + 50;
    setTimeout(() => {
      this.frames.update((current) => {
        const idx = current.findIndex((f) => f.id === frame.id);
        return idx <= 0 ? current : current.slice(idx);
      });
    }, cleanupDelay);
  }

  private pickRandomIndex(length: number): number {
    if (length === 1) {
      return 0;
    }
    let index: number;
    do {
      index = Math.floor(Math.random() * length);
    } while (index === this.lastItemIndex);
    this.lastItemIndex = index;
    return index;
  }
}
