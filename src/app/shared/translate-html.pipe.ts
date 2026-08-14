import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { I18nService } from '../core/services/i18n.service';

/**
 * Variante HTML de TranslatePipe (`| t`) : à utiliser uniquement avec `[innerHTML]`, jamais en
 * interpolation `{{ }}` (qui échapperait le balisage au lieu de le rendre). Réservée aux clés de
 * traduction dont le texte est explicitement mis en forme en HTML (`<b>`, `<i>`, `<u>`...) dans
 * translations.ts — aucune traduction n'est censée contenir de Markdown (`**...**` etc.), voir
 * CLAUDE.md. Le contenu vient exclusivement de notre propre dictionnaire de traductions (jamais
 * d'une saisie utilisateur), d'où le bypassSecurityTrustHtml.
 */
@Pipe({ name: 'tHtml', pure: false })
export class TranslateHtmlPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  private readonly sanitizer = inject(DomSanitizer);

  transform(key: string, params?: Record<string, string | number>): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.i18n.t(key, params));
  }
}
