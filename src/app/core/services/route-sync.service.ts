import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NavigationService, pagePathFor } from './navigation.service';
import { LegalPageService } from './legal-page.service';
import { I18nService } from './i18n.service';

/**
 * Sens "état de navigation → URL" — le complément de `RouteBridgeComponent`/`LocaleRouteComponent`
 * (sens "URL → état de navigation"). Reflète `NavigationService.view()` (et `LegalPageService.kind()`
 * le temps qu'on est sur la page légale) ET `I18nService.locale()` (préfixe de langue, voir
 * app.routes.ts) dans l'URL à chaque changement, y compris quand ce changement vient d'un appel
 * direct (`nav.openProfile()`, bouton "Retour", `LanguageSwitcherComponent.choose()`...) plutôt que
 * d'un lien de route — ce qui couvre tous les chemins existants (header, footer, boutons "Retour",
 * sélecteur de langue...) sans avoir à les migrer un par un vers des `routerLink`.
 *
 * `if (this.router.url !== path)` évite la boucle : une navigation déclenchée PAR l'URL (voir
 * RouteBridgeComponent/LocaleRouteComponent) fait déjà correspondre `router.url` à cette même
 * valeur, donc ce garde-fou la rend silencieusement no-op au lieu de renaviguer vers la page où
 * l'on est déjà.
 *
 * `if (!this.router.navigated) return;` (APRÈS avoir lu les signaux, jamais avant — sinon l'effect
 * ne s'abonnerait plus à leurs changements futurs) évite un cas plus subtil : lors du tout premier
 * rendu, cet effect peut s'exécuter AVANT que `LocaleRouteComponent`/`RouteBridgeComponent` n'aient
 * eu la main pour faire correspondre `i18n.locale()`/`nav.view()` à l'URL réellement demandée (lien
 * direct, F5) — il calculerait alors un chemin depuis l'état encore par défaut (vue "main") et
 * écraserait la navigation initiale en cours (`router.url` pas encore mis à jour à cet instant non
 * plus, donc la comparaison ci-dessus ne suffit pas à s'en protéger). Bug réel observé en
 * vérification navigateur : un lien direct vers `/es/legal-notice` retombait sur `/es`.
 * `Router.navigated` ne passe à `true` qu'une fois la navigation initiale ENTIÈREMENT activée
 * (composants compris) ; une fois ce cap franchi, les mêmes appels (`nav.goTo()`/`i18n.setLocale()`)
 * redéclenchent cet effect normalement pour toute navigation suivante.
 *
 * Injecté une seule fois au démarrage (voir app.ts, même principe que StatsStoreService) pour
 * garantir que l'`effect()` tourne dès le premier changement de vue/locale.
 */
@Injectable({ providedIn: 'root' })
export class RouteSyncService {
  private readonly router = inject(Router);
  private readonly nav = inject(NavigationService);
  private readonly legalPage = inject(LegalPageService);
  private readonly i18n = inject(I18nService);

  constructor() {
    effect(() => {
      const locale = this.i18n.locale();
      const view = this.nav.view();
      const legalKind = view === 'legal' ? this.legalPage.kind() : null;
      if (!this.router.navigated) return;
      const path = `/${locale}${pagePathFor(view, legalKind)}`;
      if (this.router.url !== path) {
        void this.router.navigateByUrl(path);
      }
    });
  }
}
