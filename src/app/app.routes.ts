import { Routes } from '@angular/router';
import { RouteBridgeComponent } from './core/routes/route-bridge.component';
import { fileConnectedGuard } from './core/routes/file-connected.guard';

/**
 * URL dédiée par page (voir RouteBridgeComponent/RouteSyncService pour le mécanisme complet) :
 * chaque route ne fait qu'annoncer la vue `NavigationService` correspondante, le rendu réel reste
 * porté par les panneaux permanents de app.html. Chemins toujours en anglais (demande explicite,
 * même si l'app elle-même est présentée en français par défaut) — voir `RouteSyncService.pathFor`
 * pour le mapping inverse (vue → URL), à garder synchronisé avec ces chemins.
 */
export const routes: Routes = [
  { path: '', component: RouteBridgeComponent, data: { view: 'main' } },
  {
    path: 'profile',
    component: RouteBridgeComponent,
    data: { view: 'profile' },
    canActivate: [fileConnectedGuard],
  },
  { path: 'account', component: RouteBridgeComponent, data: { view: 'account' } },
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
];
