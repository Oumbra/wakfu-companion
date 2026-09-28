import { Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { OverlayBrandComponent } from '../overlay-brand/overlay-brand.component';

/** Teinte de la pastille : `new` (accent, nouveauté) ou `important` (orange, avertissement). */
export type AnnouncementCardTone = 'new' | 'important';

/**
 * Carte de notification liée à l'overlay de bureau, fixée sous le header (même ancrage que
 * `app-update-notice`) : bandeau de marque (`app-overlay-brand` + pastille), titre, contenu projeté
 * (`<ng-content>`), puis « Plus tard » et une action principale. Enveloppe commune de
 * `app-overlay-announcement` (« Nouveau ») et `app-overlay-conflict-notice` (« Important ») : les
 * deux gardent ainsi exactement la même mise en forme.
 *
 * `[clickable]` rend le bandeau et la zone de texte cliquables (`(open)`), doublant l'action
 * principale — masquée alors sur mobile. Les textes arrivent déjà traduits.
 */
@Component({
  selector: 'app-announcement-card',
  imports: [NgTemplateOutlet, OverlayBrandComponent],
  templateUrl: './announcement-card.component.html',
  styleUrl: './announcement-card.component.css',
})
export class AnnouncementCardComponent {
  readonly badge = input.required<string>();
  readonly tone = input<AnnouncementCardTone>('new');
  readonly cardTitle = input.required<string>();
  readonly dismissLabel = input.required<string>();
  readonly actionLabel = input.required<string>();
  readonly clickable = input(false);

  /** Clic sur le bandeau ou la zone de texte (seulement si `[clickable]`). */
  readonly open = output<void>();
  readonly dismiss = output<void>();
  readonly action = output<void>();

  protected onOpen(): void {
    if (this.clickable()) this.open.emit();
  }
}
