import { Component, inject, input } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/** Icônes wakassets (chat noir/blanc) fournies pour ce switch — pas de rapport avec les icônes de
 * monstre affichées ailleurs dans l'app (dégâts, suivi...), uniquement réutilisées ici pour leur
 * imagerie sombre/claire. */
const DARK_ICON_URL = 'https://vertylo.github.io/wakassets/monsters/108900833.png';
const LIGHT_ICON_URL = 'https://vertylo.github.io/wakassets/monsters/117601209.png';

/**
 * Switch clair/sombre à deux icônes (fond glissant, réutilise le mécanisme générique
 * `.icon-switch` de styles.css — même famille que le tri du butin). L'icône du thème actif est
 * désactivée (non cliquable) et pleinement visible ; l'autre reste cliquable mais grisée/estompée
 * — cliquer dessus bascule le thème.
 */
@Component({
  selector: 'app-theme-switch',
  imports: [TranslatePipe, TooltipDirective],
  templateUrl: './theme-switch.component.html',
  styleUrl: './theme-switch.component.css',
  host: {
    '(click)': 'toggleTheme()',
  },
})
export class ThemeSwitchComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly darkIcon = DARK_ICON_URL;
  protected readonly lightIcon = LIGHT_ICON_URL;

  /** 'header' : pilule compacte de l'en-tête desktop (défaut) ; 'row' : ligne pleine largeur du
   * menu burger, même principe que `app-language-switcher`. */
  readonly variant = input<'header' | 'row'>('header');

  toggleTheme() {
    if (this.variant() !== 'row') return;

    const currentTheme = this.theme.theme();
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.theme.setTheme(nextTheme);
  }
}
