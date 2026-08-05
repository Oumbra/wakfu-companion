import { Component, computed, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { LegalPageService } from '../../core/services/legal-page.service';
import { TranslatePipe } from '../translate.pipe';
import { AppPageComponent } from '../app-page/app-page.component';

interface LegalParagraph {
  isHeading: boolean;
  text: string;
}

/**
 * Page légale dédiée du footer (mentions légales / politique de confidentialité) — un panneau de
 * navigation à part entière parmi ceux gérés par NavigationService (voir app.html, `AppView`),
 * toujours monté et positionné/animé comme les autres, via le shell générique AppPageComponent
 * (voir LegalPageService pour l'ouverture/fermeture). Le corps du texte (`legal.notice.body` /
 * `privacy.notice.body`) est structuré en sections `## Titre` (voir translations.ts) : les
 * paragraphes préfixés par `## ` sont rendus comme des titres de section.
 */
@Component({
  selector: 'app-legal-page',
  imports: [TranslatePipe, AppPageComponent],
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.css',
})
export class LegalPageComponent {
  private readonly i18n = inject(I18nService);
  protected readonly legalPage = inject(LegalPageService);

  protected readonly titleKey = computed(() =>
    this.legalPage.kind() === 'privacy' ? 'privacy.notice.title' : 'legal.notice.title',
  );

  protected readonly paragraphs = computed<LegalParagraph[]>(() => {
    this.i18n.locale();
    const bodyKey =
      this.legalPage.kind() === 'privacy' ? 'privacy.notice.body' : 'legal.notice.body';
    const body = this.i18n.t(bodyKey);
    return body.split('\n\n').map((paragraph) => {
      const isHeading = paragraph.startsWith('## ');
      return { isHeading, text: isHeading ? paragraph.slice(3) : paragraph };
    });
  });
}
