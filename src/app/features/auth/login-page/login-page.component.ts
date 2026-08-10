import { Component, inject } from '@angular/core';
import { AuthProvider, AuthService } from '../../../core/auth/auth.service';
import { NavigationService } from '../../../core/services/navigation.service';
import { AppPageComponent } from '../../../shared/app-page/app-page.component';
import { TranslatePipe } from '../../../shared/translate.pipe';

/**
 * Page de connexion (lot 5, prompt 5.2) — Discord ou Google, aucun mot de
 * passe (voir docs/plan-migration-serveur.md §7).
 *
 * On n'y arrive **jamais** par une garde de route : c'est une vue comme les
 * autres, atteinte uniquement par un clic explicite sur le bouton compte. Le
 * texte le dit d'ailleurs franchement — sans connexion, l'application est
 * pleinement fonctionnelle et les données restent sur la machine du joueur.
 */
@Component({
  selector: 'app-login-page',
  imports: [AppPageComponent, TranslatePipe],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent {
  protected readonly auth = inject(AuthService);
  private readonly nav = inject(NavigationService);

  protected goBack(): void {
    this.auth.clearError();
    this.nav.pop();
  }

  protected login(provider: AuthProvider): void {
    this.auth.clearError();
    this.auth.login(provider);
  }
}
