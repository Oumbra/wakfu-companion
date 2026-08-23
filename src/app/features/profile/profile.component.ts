import { Component, computed, inject, input } from '@angular/core';
import { ProfileService } from '../../core/services/profile.service';
import { NavigationService } from '../../core/services/navigation.service';
import { ClassPortraitComponent } from '../../shared/class-portrait/class-portrait.component';
import { getAvatarGridEntry } from '../../core/data/class-portraits.data';
import { TranslatePipe } from '../../shared/translate.pipe';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { NewSectionBadgeService } from '../../core/services/new-section-badge.service';

/** Bouton profil (haut à droite) : avatar choisi ou "?" par défaut, ouvre la page profil (voir ProfilePageComponent). */
@Component({
  selector: 'app-profile',
  imports: [ClassPortraitComponent, TranslatePipe, TooltipDirective],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
})
export class ProfileComponent {
  protected readonly profile = inject(ProfileService);
  private readonly nav = inject(NavigationService);
  protected readonly newSectionBadge = inject(NewSectionBadgeService);

  /** 'header' : bouton avatar rond seul (défaut) ; 'row' : ligne de menu burger (avatar + libellé). */
  readonly variant = input<'header' | 'row'>('header');

  /** Entrée (classe + sexe) de l'avatar choisi (voir class-portraits.data.ts) — même planche que la
   * grille de sélection (Profil > Identité). */
  protected readonly avatarEntry = computed(() => getAvatarGridEntry(this.profile.avatarIndex()));

  protected open(): void {
    this.nav.openProfile();
  }
}
