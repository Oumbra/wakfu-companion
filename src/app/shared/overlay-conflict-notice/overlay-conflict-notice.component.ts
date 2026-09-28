import { Component, computed, inject } from '@angular/core';
import { AppUpdateService } from '../../core/services/app-update.service';
import { I18nService } from '../../core/services/i18n.service';
import { OverlayConflictService } from '../../core/services/overlay-conflict.service';
import { ThemeService } from '../../core/services/theme.service';
import { AnnouncementCardComponent } from '../announcement-card/announcement-card.component';
import { TranslatePipe } from '../translate.pipe';
import { TranslateHtmlPipe } from '../translate-html.pipe';

/**
 * Captures statiques du pas-à-pas (`public/assets/overlay-conflict/`), en thème sombre et clair
 * (variante par défaut). Hauteur fixe de 44 px CSS, prises en 2x : voir la feuille de style.
 */
const SCREENSHOTS_DIR = 'assets/overlay-conflict';

/**
 * Avertissement « Important » (carte `app-announcement-card`, même mise en forme que la bannière
 * « l'overlay est arrivé ») affiché quand le site lit un vrai `wakfu.log` alors qu'un overlay est
 * appairé au compte — voir `OverlayConflictService` pour la condition et sa fréquence. Explique
 * les doublons que cela crée puis montre, captures à l'appui, comment passer en connexion sans
 * fichier : ⇄ à côté de `wakfu.log`, « Continuer sans fichier de log », l'en-tête affiche alors
 * « Overlay ». L'action principale fait ces étapes d'un clic.
 *
 * Rendue au niveau racine (`app.html`), à la place de la bannière d'annonce de l'overlay (qui
 * s'efface devant elle) ; s'efface elle-même devant la bannière de mise à jour du site. Chaque
 * capture suit le thème actif ; celle du bouton existe aussi dans les 4 langues, celles de l'en-tête
 * ne contiennent pas de texte traduit.
 */
@Component({
  selector: 'app-overlay-conflict-notice',
  imports: [AnnouncementCardComponent, TranslatePipe, TranslateHtmlPipe],
  templateUrl: './overlay-conflict-notice.component.html',
  styleUrl: './overlay-conflict-notice.component.css',
})
export class OverlayConflictNoticeComponent {
  protected readonly conflict = inject(OverlayConflictService);
  protected readonly updateService = inject(AppUpdateService);
  private readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeService);

  protected readonly headerFileSrc = computed(
    () => `${SCREENSHOTS_DIR}/header-file-${this.theme.theme()}.png`,
  );
  protected readonly headerOverlaySrc = computed(
    () => `${SCREENSHOTS_DIR}/header-overlay-${this.theme.theme()}.png`,
  );
  protected readonly skipButtonSrc = computed(
    () => `${SCREENSHOTS_DIR}/skip-button-${this.i18n.locale()}-${this.theme.theme()}.png`,
  );

  protected switchToOverlay(): void {
    void this.conflict.switchToOverlay();
  }
}
