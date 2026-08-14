import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AppLocale, I18nService, SUPPORTED_LOCALES } from '../services/i18n.service';

/**
 * Pendant `LocaleRouteComponent` du couple existant `RouteBridgeComponent`/`RouteSyncService`, pour
 * le segment `:lang` cette fois plutôt que la page : traduit le préfixe de langue de l'URL
 * (`/fr`, `/en`, `/es`, `/pt` — voir `app.routes.ts`) en appel à `I18nService.setLocale()`, sens
 * "URL → état". Le sens inverse ("état → URL") reste porté par `RouteSyncService`, qui préfixe
 * désormais le chemin de chaque page par `i18n.locale()`.
 *
 * Contrairement à `RouteBridgeComponent` (lecture unique en `ngOnInit`), ce composant DOIT réagir
 * aux changements du paramètre après le premier rendu : passer de `/fr/profile` à `/en/profile`
 * réutilise la même route (seul `:lang` change), donc la même instance de composant — Angular ne
 * la détruit/recrée pas comme il le fait entre deux chemins distincts (`/fr/profile` →
 * `/fr/account`). Un simple `route.snapshot` lu une fois en `ngOnInit` raterait donc ce cas.
 *
 * Rend un `<router-outlet>` (comme `app.html` au niveau racine) pour laisser Angular Router activer
 * la page enfant correspondante (`RouteBridgeComponent`, qui ne rend elle-même toujours rien — le
 * contenu réel reste porté par les panneaux permanents de `app.html`).
 *
 * Une valeur de `:lang` hors `SUPPORTED_LOCALES` est ignorée ici (ne change pas la locale
 * courante) : `localeGuard` empêche déjà l'activation de la route pour ce cas (redirige vers `/`),
 * ce composant ne devrait donc jamais recevoir de valeur invalide en pratique — le filtre reste un
 * garde-fou défensif, pas le mécanisme principal.
 */
@Component({
  selector: 'app-locale-route',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class LocaleRouteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);

  private readonly lang = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('lang') as AppLocale | null)),
    { initialValue: this.route.snapshot.paramMap.get('lang') as AppLocale | null },
  );

  constructor() {
    effect(() => {
      const lang = this.lang();
      if (lang && SUPPORTED_LOCALES.includes(lang)) {
        this.i18n.setLocale(lang);
      }
    });
  }
}
