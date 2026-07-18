import { Injectable, signal } from '@angular/core';

export type AppView = 'main' | 'profile';

/** Vue actuellement affichée (page principale de monitoring ou page profil) : anime le slide entre les deux, voir app.css. */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  readonly view = signal<AppView>('main');

  openProfile(): void {
    this.view.set('profile');
  }

  goToMain(): void {
    this.view.set('main');
  }
}
