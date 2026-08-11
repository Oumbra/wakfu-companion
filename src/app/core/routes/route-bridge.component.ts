import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AppView, NavigationService } from '../services/navigation.service';
import { LegalPageKind, LegalPageService } from '../services/legal-page.service';

/**
 * "Vue" de routage sans rendu propre — l'app ne rend jamais son contenu via `<router-outlet>` (voir
 * app.routes.ts) : toutes les pages (main/profil/légal/compte) restent montées en permanence et
 * animées par `NavigationService` (voir app.html, `.view-panel`), comme avant l'introduction
 * d'Angular Router. Ce composant est juste le "déclencheur" qu'Angular Router instancie à
 * l'activation d'une route : il traduit l'URL en appel à `NavigationService.goTo()` (+
 * `LegalPageService.kind` pour distinguer mentions légales/politique de confidentialité) puis ne
 * rend rien. Le sens inverse (état de nav → URL) est géré par `RouteSyncService`.
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
    this.nav.goTo(data['view'] as AppView);
  }
}
