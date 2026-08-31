import { Component, computed, inject } from '@angular/core';
import { LegalPageService } from '../../core/services/legal-page.service';
import { I18nService } from '../../core/services/i18n.service';
import { BUILD_TIMESTAMP, BUILD_VERSION } from '../../core/data/build-info.data';
import { TranslatePipe } from '../translate.pipe';

/**
 * Pied de page global — rendu une fois par panneau de navigation (voir AppPageComponent), donc
 * présent sur la page principale, la page profil ET la page légale. Les liens "Mentions légales" /
 * "Politique de confidentialité" / "Conditions d'utilisation" ouvrent la page légale correspondante
 * (voir
 * LegalPageService.open, qui délègue l'animation d'entrée à `NavigationService.openLegal()`) :
 * cette app n'a pas de routeur au sens propre, mais NavigationService anime correctement l'entrée
 * depuis la page principale OU la page profil (retour au bon endroit via `pop()`).
 */
@Component({
  selector: 'app-footer',
  imports: [TranslatePipe],
  templateUrl: './app-footer.component.html',
  styleUrl: './app-footer.component.css',
})
export class AppFooterComponent {
  protected readonly legalPage = inject(LegalPageService);
  private readonly i18n = inject(I18nService);

  // BUILD_VERSION/BUILD_TIMESTAMP : générés par tools/generate-build-info.mjs
  // à chaque build (voir package.json "generate"), pas des constantes
  // codées en dur — computed() car formatDateTime() dépend de la locale
  // courante (doit se réévaluer si l'utilisateur change de langue).
  protected readonly buildInfo = computed(() =>
    this.i18n.t('footer.build', {
      version: BUILD_VERSION,
      date: this.i18n.formatDateTime(BUILD_TIMESTAMP, false),
    }),
  );
}
