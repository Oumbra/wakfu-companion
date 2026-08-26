import { Component, computed, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { I18nService } from '../../core/services/i18n.service';
import { LegalPageService } from '../../core/services/legal-page.service';
import { TranslatePipe } from '../translate.pipe';
import { AppPageComponent } from '../app-page/app-page.component';

interface LegalParagraph {
  isHeading: boolean;
  text: SafeHtml;
}

/**
 * Page légale dédiée du footer (mentions légales / politique de confidentialité / CGU) — un panneau
 * de navigation à part entière parmi ceux gérés par NavigationService (voir app.html, `AppView`),
 * toujours monté et positionné/animé comme les autres, via le shell générique AppPageComponent
 * (voir LegalPageService pour l'ouverture/fermeture). Le corps du texte (`legal.notice.body` /
 * `privacy.notice.body` / `terms.notice.body`, sélectionné via `contentPrefix`) est structuré en
 * sections `## Titre` (voir translations.ts) : les paragraphes préfixés par `## ` sont rendus comme
 * des titres de section. Le texte lui-même peut contenir du HTML de mise en forme (`<b>`, `<i>`...)
 * — jamais de Markdown, voir CLAUDE.md — d'où le passage par DomSanitizer et un rendu en
 * `[innerHTML]` côté template plutôt qu'en interpolation.
 */
@Component({
  selector: 'app-legal-page',
  imports: [TranslatePipe, AppPageComponent],
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.css',
})
export class LegalPageComponent {
  private readonly i18n = inject(I18nService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly legalPage = inject(LegalPageService);

  /** Préfixe de clé i18n (`legal.notice` / `privacy.notice` / `terms.notice`) selon le contenu
   * demandé — `LegalPageService.kind()` reste `'notice'` par défaut pour les mentions légales. */
  private readonly contentPrefix = computed(() => {
    const kind = this.legalPage.kind();
    if (kind === 'privacy') return 'privacy.notice';
    if (kind === 'terms') return 'terms.notice';
    return 'legal.notice';
  });

  protected readonly titleKey = computed(() => `${this.contentPrefix()}.title`);

  protected readonly paragraphs = computed<LegalParagraph[]>(() => {
    this.i18n.locale();
    const body = this.i18n.t(`${this.contentPrefix()}.body`);
    return body.split('\n\n').map((paragraph) => {
      const isHeading = paragraph.startsWith('## ');
      const text = isHeading ? paragraph.slice(3) : paragraph;
      return { isHeading, text: this.sanitizer.bypassSecurityTrustHtml(text) };
    });
  });
}
