import { Component, computed, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { LegalPageService } from '../../core/services/legal-page.service';
import { TranslatePipe } from '../translate.pipe';

interface LegalParagraph {
  isHeading: boolean;
  text: string;
}

/**
 * Page légale dédiée du footer (mentions légales) — rendue comme un 3ᵉ état de `app-main` (voir
 * app.html), aux côtés du dashboard et du setup : header et footer applicatifs restent visibles,
 * comme une vraie page plutôt qu'une modale (voir LegalPageService). Le corps du texte
 * (`legal.notice.body`) est structuré en sections `## Titre` (voir translations.ts) : les
 * paragraphes préfixés par `## ` sont rendus comme des titres de section.
 */
@Component({
  selector: 'app-legal-page',
  imports: [TranslatePipe],
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.css',
})
export class LegalPageComponent {
  private readonly i18n = inject(I18nService);
  protected readonly legalPage = inject(LegalPageService);

  protected readonly paragraphs = computed<LegalParagraph[]>(() => {
    this.i18n.locale();
    const body = this.i18n.t('legal.notice.body');
    return body.split('\n\n').map((paragraph) => {
      const isHeading = paragraph.startsWith('## ');
      return { isHeading, text: isHeading ? paragraph.slice(3) : paragraph };
    });
  });
}
