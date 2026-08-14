import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { RouteBridgeComponent } from './core/routes/route-bridge.component';
import { LocaleRouteComponent } from './core/routes/locale-route.component';
import { fileConnectedGuard } from './core/routes/file-connected.guard';
import { localeGuard } from './core/routes/locale.guard';
import { detectPreferredLocale } from './core/services/i18n.service';
import { PersistenceService } from './core/services/persistence.service';

/**
 * URL dédiée par page, préfixée par langue (`/fr`, `/en`, `/es`, `/pt` — voir
 * `LocaleRouteComponent`/`RouteSyncService` pour le mécanisme complet, "URL dédiée par page" pour
 * les routes elles-mêmes via `RouteBridgeComponent`) : chaque route enfant ne fait qu'annoncer la
 * vue `NavigationService` correspondante, le rendu réel reste porté par les panneaux permanents de
 * app.html. Chemins de page toujours en anglais (demande explicite, même si l'app elle-même est
 * présentée en français par défaut) — voir `pagePathFor` (`navigation.service.ts`) pour le mapping
 * inverse (vue → URL), à garder synchronisé avec ces chemins.
 *
 * Les anciens chemins sans préfixe (`/`, `/profile`...) restent résolus — ce sont ceux que
 * n'importe quel lien externe ou favori antérieur à cette fonctionnalité continue de cibler — mais
 * redirigent immédiatement vers leur équivalent préfixé par `detectPreferredLocale()` (préférence
 * mémorisée, sinon langue du navigateur, sinon français). `redirectTo` en fonction (pas une simple
 * chaîne) : la cible dépend de cette détection, donc doit être calculée à chaque navigation plutôt
 * que figée une fois pour toutes — s'exécute dans le contexte d'injection du Router, `inject()` y
 * est donc valide comme dans un guard/résolveur fonctionnel.
 */
const redirectToPreferredLocale = (suffix: string) => (): string => {
  const persistence = inject(PersistenceService);
  return `/${detectPreferredLocale(persistence)}${suffix}`;
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: redirectToPreferredLocale('') },
  { path: 'profile', pathMatch: 'full', redirectTo: redirectToPreferredLocale('/profile') },
  { path: 'account', pathMatch: 'full', redirectTo: redirectToPreferredLocale('/account') },
  {
    path: 'legal-notice',
    pathMatch: 'full',
    redirectTo: redirectToPreferredLocale('/legal-notice'),
  },
  {
    path: 'privacy-policy',
    pathMatch: 'full',
    redirectTo: redirectToPreferredLocale('/privacy-policy'),
  },
  {
    path: ':lang',
    component: LocaleRouteComponent,
    canActivate: [localeGuard],
    children: [
      { path: '', component: RouteBridgeComponent, data: { view: 'main' } },
      {
        path: 'profile',
        component: RouteBridgeComponent,
        data: { view: 'profile' },
        canActivate: [fileConnectedGuard],
      },
      {
        path: 'account',
        component: RouteBridgeComponent,
        data: { view: 'account' },
        canActivate: [fileConnectedGuard],
      },
      {
        path: 'legal-notice',
        component: RouteBridgeComponent,
        data: { view: 'legal', legalKind: 'notice' },
      },
      {
        path: 'privacy-policy',
        component: RouteBridgeComponent,
        data: { view: 'legal', legalKind: 'privacy' },
      },
      { path: '**', redirectTo: '' },
    ],
  },
  { path: '**', redirectTo: '' },
];
