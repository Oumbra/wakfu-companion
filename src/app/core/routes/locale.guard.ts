import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AppLocale, SUPPORTED_LOCALES } from '../services/i18n.service';

/**
 * Valide que le segment `:lang` de l'URL (`/fr`, `/en`, `/es`, `/pt`, voir `app.routes.ts`) est
 * une locale supportée — un segment invalide (faute de frappe, lien mort, crawler qui devine des
 * URLs) renvoie vers l'accueil plutôt que de laisser `LocaleRouteComponent` activer une locale
 * inexploitable (il ignore silencieusement toute valeur hors `SUPPORTED_LOCALES`, voir son
 * commentaire) : sans ce garde, l'URL resterait affichée telle quelle (ex. `/xx/profile`) alors que
 * l'app aurait basculé sur une locale par défaut, un décalage URL/contenu trompeur pour un lien
 * partagé comme pour un crawler.
 */
export const localeGuard: CanActivateFn = (route): boolean | UrlTree => {
  const router = inject(Router);
  const lang = route.paramMap.get('lang') as AppLocale | null;
  return lang !== null && SUPPORTED_LOCALES.includes(lang) ? true : router.parseUrl('/');
};
