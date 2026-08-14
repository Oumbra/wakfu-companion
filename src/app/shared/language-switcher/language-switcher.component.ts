import { Component, computed, inject, input, signal } from '@angular/core';
import { AppLocale, I18nService } from '../../core/services/i18n.service';
import { FlagCountry, FlagIconComponent } from '../flag-icon/flag-icon.component';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

interface LocaleOption {
  code: AppLocale;
  flagCountry: FlagCountry;
  label: string;
}

const LOCALES: readonly LocaleOption[] = [
  { code: 'fr', flagCountry: 'fr', label: 'Français' },
  { code: 'en', flagCountry: 'gb', label: 'English' },
  { code: 'es', flagCountry: 'es', label: 'Español' },
  { code: 'pt', flagCountry: 'pt', label: 'Português' },
];

/** Drapeau de langue courante ; clic pour choisir une autre langue parmi celles proposées. */
@Component({
  selector: 'app-language-switcher',
  imports: [FlagIconComponent, TranslatePipe, TooltipDirective],
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.css',
})
export class LanguageSwitcherComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly locales = LOCALES;
  protected readonly open = signal(false);

  /** 'header' : bouton icône seul (défaut) ; 'row' : ligne de menu burger (icône + libellé). */
  readonly variant = input<'header' | 'row'>('header');

  protected readonly current = computed(
    () => this.locales.find((l) => l.code === this.i18n.locale()) ?? this.locales[0],
  );

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected choose(code: AppLocale): void {
    this.i18n.setLocale(code);
    this.open.set(false);
  }

  protected close(): void {
    this.open.set(false);
  }
}
