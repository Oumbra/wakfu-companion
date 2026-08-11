import { Injectable, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationService } from './navigation.service';
import { LegalPageService } from './legal-page.service';
import { I18nService } from './i18n.service';

/**
 * Titre d'onglet + meta description mis à jour dynamiquement selon la page (`NavigationService.view()`,
 * y compris le sous-type légal) et la locale active (`I18nService.locale()`), via les clés `seo.*` de
 * `translations.ts`. Met aussi à jour `<html lang>` (signal d'accessibilité ET de langue de contenu
 * pour les moteurs de recherche/crawlers qui exécutent le JS — Google, Bing).
 *
 * Complète, sans le remplacer, le contenu STATIQUE de `src/index.html` (meta description par défaut,
 * Open Graph, JSON-LD, bloc `<noscript>`) : ce contenu statique reste la seule chose vue par les
 * crawlers qui n'exécutent PAS de JavaScript (GPTBot, ClaudeBot, PerplexityBot...), alors que ce
 * service ne s'applique qu'après le démarrage de l'application Angular (utilisateurs réels, Google/
 * Bing qui rendent le JS, et aperçus de partage générés après exécution).
 *
 * Injecté une seule fois au démarrage dans `app.ts` (même pattern que `RouteSyncService`/
 * `StatsStoreService`) pour que l'`effect()` tourne dès le premier changement de vue/locale.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly nav = inject(NavigationService);
  private readonly legalPage = inject(LegalPageService);
  private readonly i18n = inject(I18nService);

  constructor() {
    effect(() => {
      const view = this.nav.view();
      // Lu même hors vue légale : garantit que l'effect se réabonne à ce signal et retrouve le bon
      // contenu si l'utilisateur revient sur la page légale après avoir changé de type de contenu.
      const legalKind = this.legalPage.kind();
      const locale = this.i18n.locale();

      const key = this.seoKeyFor(view, legalKind);
      const pageTitle = this.i18n.t(`seo.title.${key}`);
      const description = this.i18n.t(`seo.description.${key}`);

      this.title.setTitle(pageTitle);
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:title', content: pageTitle });
      this.meta.updateTag({ property: 'og:description', content: description });

      document.documentElement.lang = locale;
    });
  }

  private seoKeyFor(
    view: ReturnType<NavigationService['view']>,
    legalKind: 'notice' | 'privacy',
  ): 'main' | 'profile' | 'account' | 'legalNotice' | 'privacyPolicy' {
    switch (view) {
      case 'profile':
        return 'profile';
      case 'account':
        return 'account';
      case 'legal':
        return legalKind === 'privacy' ? 'privacyPolicy' : 'legalNotice';
      case 'main':
      default:
        return 'main';
    }
  }
}
