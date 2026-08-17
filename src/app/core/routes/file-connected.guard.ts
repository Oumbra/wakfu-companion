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
 * Attend `logFileAccess.ready` avant de trancher : `LogFileAccessService.init()` (lancé au
 * démarrage de l'app, voir `App.ngOnInit`) est asynchrone (IndexedDB + `queryPermission`), donc
 * `status()` vaut encore sa valeur par défaut `'idle'` au moment où ce garde s'exécute sur un lien
 * direct/F5 vers `/profile` — sans cette attente, un utilisateur déjà connecté avant le
 * rechargement se faisait rediriger à tort avant même que la reconnexion n'ait eu la chance de se
 * résoudre. `ready` est déjà résolu pour toute navigation programmatique (`NavigationService.
 * openProfile()`, bouton profil de l'en-tête, de toute façon déjà masqué dans le template tant
 * qu'aucun fichier n'est connecté), donc aucun délai perceptible dans ce cas.
 */
export const fileConnectedGuard: CanActivateFn = async (route): Promise<boolean | UrlTree> => {
  const logFileAccess = inject(LogFileAccessService);
  const router = inject(Router);
  await logFileAccess.ready;
  if (logFileAccess.status() === 'connected') return true;
  const lang = route.parent?.paramMap.get('lang') ?? 'fr';
  return router.parseUrl(`/${lang}`);
};
