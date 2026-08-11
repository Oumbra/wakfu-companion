import { Routes } from '@angular/router';
import { RouteBridgeComponent } from './core/routes/route-bridge.component';

/**
 * URL dédiée par page (voir RouteBridgeComponent/RouteSyncService pour le mécanisme complet) :
 * chaque route ne fait qu'annoncer la vue `NavigationService` correspondante, le rendu réel reste
 * porté par les panneaux permanents de app.html.
 */
export const routes: Routes = [
  { path: '', component: RouteBridgeComponent, data: { view: 'main' } },
  { path: 'profil', component: RouteBridgeComponent, data: { view: 'profile' } },
  { path: 'compte', component: RouteBridgeComponent, data: { view: 'account' } },
  {
    path: 'mentions-legales',
    component: RouteBridgeComponent,
    data: { view: 'legal', legalKind: 'notice' },
  },
  {
    path: 'politique-confidentialite',
    component: RouteBridgeComponent,
    data: { view: 'legal', legalKind: 'privacy' },
  },
  { path: '**', redirectTo: '' },
];
