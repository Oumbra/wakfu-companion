import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { LogFileAccessService } from '../services/log-file-access.service';

/**
 * Empêche l'accès à la page profil (route `/:lang/profile`) tant qu'aucun `wakfu.log` n'est
 * connecté : la page dépend de données qui n'existent que via un fichier actif (personnages du
 * roster, serveur de jeu déduit du log...) — sans fichier connecté, l'affiche serait au mieux vide,
 * au pire trompeuse. Redirige vers la vue principale de la MÊME langue (`/:lang`, pas `/`), qui
 * affiche alors le sélecteur de fichier (`app-setup`, voir app.html) — `route.parent` porte le
 * paramètre `:lang` (ce garde s'applique à une route enfant de `LocaleRouteComponent`, voir
 * app.routes.ts ; `localeGuard` a déjà validé ce paramètre avant d'atteindre ce garde).
 *
 * Ne couvre que la navigation via l'URL (lien direct, F5, précédent/suivant du navigateur) — les
 * entrées programmatiques (`NavigationService.openProfile()`, bouton profil de l'en-tête) sont
 * de toute façon déjà masquées dans le template tant qu'aucun fichier n'est connecté (voir
 * app-header.component.html, `@if (logFileAccess.status() === 'connected' ...)`).
 */
export const fileConnectedGuard: CanActivateFn = (route): boolean | UrlTree => {
  const logFileAccess = inject(LogFileAccessService);
  const router = inject(Router);
  if (logFileAccess.status() === 'connected') return true;
  const lang = route.parent?.paramMap.get('lang') ?? 'fr';
  return router.parseUrl(`/${lang}`);
};
