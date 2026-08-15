import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationService } from './navigation.service';
import { LegalPageService } from './legal-page.service';
import { AppLocale, I18nService, SUPPORTED_LOCALES } from './i18n.service';

/**
 * Domaine canonique en dur — même valeur, même raison d'être en dur (previews `*.pages.dev`
 * comprises) que `src/index.html`/`public/robots.txt`/`public/sitemap.xml`/`public/llms.txt` (voir
 * leurs commentaires respectifs) : À METTRE À JOUR PARTOUT le jour où la prod bascule sur
 * Cloudflare/un domaine personnalisé (voir `docs/plan-migration-serveur.md`). Un grep sur
 * `oumbra.github.io/wakfu-companion` retrouve les 5 occurrences.
 */
const SITE_ORIGIN = 'https://oumbra.github.io/wakfu-companion';

/**
 * Titre d'onglet + meta description mis à jour dynamiquement selon la page (`NavigationService.view()`,
 * y compris le sous-type légal) et la locale active (`I18nService.locale()`), via les clés `seo.*` de
 * `translations.ts`. Met aussi à jour `<html lang>`, le lien canonique et les alternates `hreflang`
 * (signal d'accessibilité ET de langue de contenu pour les moteurs de recherche/crawlers qui
 * exécutent le JS — Google, Bing).
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
  private readonly document = inject(DOCUMENT);
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

      this.document.documentElement.lang = locale;
      this.updateCanonicalAndHreflang(locale);
    });
  }

  /**
   * Canonical + alternates `hreflang` : ciblent toujours l'ACCUEIL de chaque langue
   * (`SITE_ORIGIN/{locale}`), jamais la sous-page courante (profil/compte/légal) — cohérent avec
   * `public/sitemap.xml`, qui ne référence lui non plus que ces 4 URLs (les sous-pages n'ont
   * aucune valeur de recherche propre pour les requêtes ciblées, voir son commentaire ; les
   * indexer séparément par langue multiplierait des URLs à faible valeur sans bénéfice). `x-default`
   * pointe vers le français (langue par défaut de l'app, voir `I18nService`/`llms.txt`).
   */
  private updateCanonicalAndHreflang(locale: AppLocale): void {
    this.setLink('canonical', `${SITE_ORIGIN}/${locale}`);
    for (const alt of SUPPORTED_LOCALES) {
      this.setLink('alternate', `${SITE_ORIGIN}/${alt}`, alt);
    }
    this.setLink('alternate', `${SITE_ORIGIN}/fr`, 'x-default');
  }

  /** Réutilise l'élément déjà présent dans `src/index.html` (canonical statique) s'il existe, sinon
   * en crée un — évite le doublon plutôt que d'empiler un second `<link>` à chaque appel. */
  private setLink(rel: 'canonical' | 'alternate', href: string, hreflang?: string): void {
    const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
    let el = this.document.head.querySelector<HTMLLinkElement>(selector);
    if (!el) {
      el = this.document.createElement('link');
      el.setAttribute('rel', rel);
      if (hreflang) el.setAttribute('hreflang', hreflang);
      this.document.head.appendChild(el);
    }
    el.setAttribute('href', href);
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
