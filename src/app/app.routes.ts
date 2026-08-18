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
 * Sous `main`/`profile`, un segment supplémentaire annonce en plus la SECTION active de la page
 * (`NavigationService.dashboardTab`/`profileTab`, et un cran plus bas `historyTab` sous
 * `history`) — un chemin dédié par section (`history`, `chat`, `damage`, `profile/accessibility`,
 * `history/purchases`...) plutôt qu'un paramètre, pour qu'Angular détruise/recrée
 * `RouteBridgeComponent` à chaque changement de section exactement comme entre deux vues (voir son
 * commentaire). Omis pour la section "racine" de chaque page (`tracker`/`avatar`/`combats`, voir
 * `pagePathFor`) : l'URL par défaut reste donc identique à avant cette fonctionnalité. Le segment
 * public d'une section peut différer de son id interne (`colorblind` → `accessibility`, `combats` →
 * `fights`) — voir `PROFILE_TAB_SEGMENT`/`HISTORY_TAB_SEGMENT` dans `navigation.service.ts`.
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
      {
        path: '',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'tracker' },
      },
      {
        path: 'history',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'history' },
      },
      {
        // Alias explicite de la racine ci-dessus (jamais généré par `pagePathFor`, voir son
        // commentaire) — accepte un lien qui nommerait la section par son mot public plutôt que de
        // compter sur l'omission de racine.
        path: 'history/fights',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'history', historyTab: 'combats' },
      },
      {
        path: 'history/purchases',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'history', historyTab: 'purchases' },
      },
      {
        path: 'history/trades',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'history', historyTab: 'trades' },
      },
      {
        path: 'chat',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'chat' },
      },
      {
        path: 'damage',
        component: RouteBridgeComponent,
        data: { view: 'main', dashboardTab: 'damage' },
      },
      {
        path: 'profile',
        component: RouteBridgeComponent,
        data: { view: 'profile', profileTab: 'avatar' },
        canActivate: [fileConnectedGuard],
      },
      {
        // Segment public `accessibility` — l'id interne du rail reste `colorblind` (voir
        // `NavigationService.PROFILE_TAB_SEGMENT`), inchangé ailleurs dans le composant.
        path: 'profile/accessibility',
        component: RouteBridgeComponent,
        data: { view: 'profile', profileTab: 'colorblind' },
        canActivate: [fileConnectedGuard],
      },
      {
        path: 'profile/connection',
        component: RouteBridgeComponent,
        data: { view: 'profile', profileTab: 'connection' },
        canActivate: [fileConnectedGuard],
      },
      {
        path: 'profile/alerts',
        component: RouteBridgeComponent,
        data: { view: 'profile', profileTab: 'alerts' },
        canActivate: [fileConnectedGuard],
      },
      {
        path: 'profile/characters',
        component: RouteBridgeComponent,
        data: { view: 'profile', profileTab: 'characters' },
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
