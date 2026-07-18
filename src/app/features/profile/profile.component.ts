import { Component, inject } from '@angular/core';
import { ProfileService } from '../../core/services/profile.service';
import { NavigationService } from '../../core/services/navigation.service';
import { AvatarIconComponent } from '../../shared/avatar-icon/avatar-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';

/** Bouton profil (haut à droite) : avatar choisi ou "?" par défaut, ouvre la page profil (voir ProfilePageComponent). */
@Component({
  selector: 'app-profile',
  imports: [AvatarIconComponent, TranslatePipe],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
})
export class ProfileComponent {
  protected readonly profile = inject(ProfileService);
  private readonly nav = inject(NavigationService);

  protected open(): void {
    this.nav.openProfile();
  }
}
