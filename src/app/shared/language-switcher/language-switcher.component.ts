import { Component, computed, inject, signal } from '@angular/core';
import { AppLocale, I18nService } from '../../core/services/i18n.service';

interface LocaleOption {
  code: AppLocale;
  flag: string;
  label: string;
}

const LOCALES: readonly LocaleOption[] = [
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'pt', flag: '🇵🇹', label: 'Português' },
];

/** Drapeau de langue courante ; clic pour choisir une autre langue parmi celles proposées. */
@Component({
  selector: 'app-language-switcher',
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.css',
})
export class LanguageSwitcherComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly locales = LOCALES;
  protected readonly open = signal(false);

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
