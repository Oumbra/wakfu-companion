import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { LogFileAccessService } from '../services/log-file-access.service';

/**
 * Empêche l'accès à la page profil (route `/profile`) tant qu'aucun `wakfu.log` n'est connecté :
 * la page dépend de données qui n'existent que via un fichier actif (personnages du roster,
 * serveur de jeu déduit du log...) — sans fichier connecté, l'affiche serait au mieux vide, au
 * pire trompeuse. Redirige vers la vue principale (`/`), qui affiche alors le sélecteur de
 * fichier (`app-setup`, voir app.html).
 *
 * Ne couvre que la navigation via l'URL (lien direct, F5, précédent/suivant du navigateur) — les
 * entrées programmatiques (`NavigationService.openProfile()`, bouton profil de l'en-tête) sont
 * de toute façon déjà masquées dans le template tant qu'aucun fichier n'est connecté (voir
 * app-header.component.html, `@if (logFileAccess.status() === 'connected' ...)`).
 */
export const fileConnectedGuard: CanActivateFn = (): boolean | UrlTree => {
  const logFileAccess = inject(LogFileAccessService);
  const router = inject(Router);
  return logFileAccess.status() === 'connected' ? true : router.parseUrl('/');
};
