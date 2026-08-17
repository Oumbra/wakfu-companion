import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  AppView,
  DashboardTab,
  NavigationService,
  ProfileTab,
} from '../services/navigation.service';
import { LegalPageKind, LegalPageService } from '../services/legal-page.service';

/**
 * "Vue" de routage sans rendu propre — l'app ne rend jamais son contenu via `<router-outlet>` (voir
 * app.routes.ts) : toutes les pages (main/profil/légal/compte) restent montées en permanence et
 * animées par `NavigationService` (voir app.html, `.view-panel`), comme avant l'introduction
 * d'Angular Router. Ce composant est juste le "déclencheur" qu'Angular Router instancie à
 * l'activation d'une route : il traduit l'URL en appel à `NavigationService.goTo()` (+
 * `LegalPageService.kind` pour distinguer mentions légales/politique de confidentialité) puis ne
 * rend rien. Le sens inverse (état de nav → URL) est géré par `RouteSyncService`.
 *
 * `dashboardTab`/`profileTab` (voir app.routes.ts) donnent la section active de `main`/`profile` —
 * un segment de route DISTINCT par section (pas un paramètre) : Angular détruit/recrée donc ce
 * composant à chaque changement de section (comme entre deux vues), ce qui rejoue `ngOnInit` à
 * chaque fois plutôt que de nécessiter une réactivité façon `LocaleRouteComponent`.
 */
@Component({
  selector: 'app-route-bridge',
  template: '',
})
export class RouteBridgeComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly nav = inject(NavigationService);
  private readonly legalPage = inject(LegalPageService);

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    const legalKind = data['legalKind'] as LegalPageKind | undefined;
    if (legalKind) {
      this.legalPage.kind.set(legalKind);
    }
    const view = data['view'] as AppView;
    this.nav.goTo(view);
    if (view === 'main') {
      this.nav.dashboardTab.set((data['dashboardTab'] as DashboardTab | undefined) ?? 'tracker');
    } else if (view === 'profile') {
      this.nav.profileTab.set((data['profileTab'] as ProfileTab | undefined) ?? 'avatar');
    }
  }
}
