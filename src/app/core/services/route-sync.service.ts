import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppView, NavigationService } from './navigation.service';
import { LegalPageService } from './legal-page.service';

/**
 * Sens "état de navigation → URL" — le complément de `RouteBridgeComponent` (sens "URL → état de
 * navigation"). Reflète `NavigationService.view()` (et `LegalPageService.kind()` le temps qu'on
 * est sur la page légale) dans l'URL à chaque changement, y compris quand ce changement vient d'un
 * appel direct (`nav.openProfile()`, bouton "Retour"...) plutôt que d'un lien de route — ce qui
 * couvre tous les chemins existants (header, footer, boutons "Retour"...) sans avoir à les migrer
 * un par un vers des `routerLink`.
 *
 * `if (this.router.url !== path)` évite la boucle : une navigation déclenchée PAR l'URL (voir
 * RouteBridgeComponent) fait déjà correspondre `router.url` à cette même valeur, donc ce garde-fou
 * la rend silencieusement no-op au lieu de renaviguer vers la page où l'on est déjà.
 *
 * Injecté une seule fois au démarrage (voir app.ts, même principe que StatsStoreService) pour
 * garantir que l'`effect()` tourne dès le premier changement de vue.
 */
@Injectable({ providedIn: 'root' })
export class RouteSyncService {
  private readonly router = inject(Router);
  private readonly nav = inject(NavigationService);
  private readonly legalPage = inject(LegalPageService);

  constructor() {
    effect(() => {
      const view = this.nav.view();
      const legalKind = view === 'legal' ? this.legalPage.kind() : null;
      const path = this.pathFor(view, legalKind);
      if (this.router.url !== path) {
        void this.router.navigateByUrl(path);
      }
    });
  }

  private pathFor(view: AppView, legalKind: 'notice' | 'privacy' | null): string {
    switch (view) {
      case 'profile':
        return '/profil';
      case 'account':
        return '/compte';
      case 'legal':
        return legalKind === 'privacy' ? '/politique-confidentialite' : '/mentions-legales';
      case 'main':
      default:
        return '/';
    }
  }
}
