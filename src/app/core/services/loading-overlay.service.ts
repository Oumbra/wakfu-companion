import { computed, Injectable, signal } from '@angular/core';

/**
 * Point d'entrée unique pour l'overlay de chargement plein écran (fond opaque + spinner, voir
 * `LoadingOverlayComponent`, rendu une seule fois au niveau racine dans `app.html` — même
 * principe que `ClassPickerService`/`TooltipService` : un seul rendu partagé plutôt qu'une
 * instance par appelant).
 *
 * Compteur plutôt que simple booléen : plusieurs sources indépendantes peuvent en théorie se
 * chevaucher (ex. la connexion au fichier log pas encore déterminée ET une recette en cours de
 * résolution) — un booléen partagé ferait disparaître l'overlay dès que LA PREMIÈRE source
 * termine, alors que l'autre est toujours en cours. Le compteur garantit que l'overlay ne
 * disparaît qu'une fois TOUTES les sources actives terminées.
 */
@Injectable({ providedIn: 'root' })
export class LoadingOverlayService {
  private readonly count = signal(0);

  readonly visible = computed(() => this.count() > 0);

  show(): void {
    this.count.update((c) => c + 1);
  }

  hide(): void {
    this.count.update((c) => Math.max(0, c - 1));
  }

  /** Enveloppe une promesse : affiche l'overlay pendant sa résolution, le masque ensuite (succès
   * comme échec) — évite d'avoir à répéter show()/hide()/try-finally à chaque appelant. */
  async track<T>(promise: Promise<T>): Promise<T> {
    this.show();
    try {
      return await promise;
    } finally {
      this.hide();
    }
  }
}
