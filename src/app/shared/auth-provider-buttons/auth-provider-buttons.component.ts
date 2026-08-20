import { Component, input, output } from '@angular/core';
import { AuthProvider } from '../../core/auth/auth.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Paire de boutons "Discord"/"Google" du flux de connexion OAuth — extraite de l'onglet Connexion
 * de la page profil (voir CLAUDE.md, section "Toujours un composant, jamais un bloc local recopié")
 * pour être réutilisée telle quelle par le bouton "passer cette étape" mobile de la page setup
 * (voir SetupComponent), sans dupliquer les SVG ni le CSS des deux fournisseurs. `disabled()` reflète
 * `AuthService.busy()` côté appelant ; `providerChosen` laisse l'appelant décider de l'appel à
 * `AuthService.login(...)` (nettoyage d'erreur préalable, `redirectTo` éventuel...).
 */
@Component({
  selector: 'app-auth-provider-buttons',
  imports: [TranslatePipe],
  templateUrl: './auth-provider-buttons.component.html',
  styleUrl: './auth-provider-buttons.component.css',
})
export class AuthProviderButtonsComponent {
  readonly disabled = input(false);
  readonly providerChosen = output<AuthProvider>();
}
