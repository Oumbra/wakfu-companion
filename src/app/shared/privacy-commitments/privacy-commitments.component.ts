import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { LegalPageService } from '../../core/services/legal-page.service';
import { AppIconName, IconComponent } from '../icon/icon.component';
import { EscapeCloseDirective } from '../escape-close.directive';
import { TranslatePipe } from '../translate.pipe';

interface Commitment {
  icon: AppIconName;
  titleKey: string;
  bodyKey: string;
}

/** Chaque engagement reprend un fait décrit par la politique de confidentialité (voir
 * `privacy.notice.body`) : les modifier ensemble, jamais l'un sans l'autre. */
const COMMITMENTS: readonly Commitment[] = [
  {
    icon: 'eye-off',
    titleKey: 'footer.privacyCommitments.noTracker.title',
    bodyKey: 'footer.privacyCommitments.noTracker.body',
  },
  {
    icon: 'monitor',
    titleKey: 'footer.privacyCommitments.noAccount.title',
    bodyKey: 'footer.privacyCommitments.noAccount.body',
  },
  {
    icon: 'download',
    titleKey: 'footer.privacyCommitments.export.title',
    bodyKey: 'footer.privacyCommitments.export.body',
  },
  {
    icon: 'trash',
    titleKey: 'footer.privacyCommitments.erase.title',
    bodyKey: 'footer.privacyCommitments.erase.body',
  },
];

let nextPanelId = 0;

/**
 * Pastille « Vie privée » du pied de page : un clic déplie un panneau listant les engagements
 * vérifiables du site en matière de données, avec un lien vers la politique de confidentialité.
 * Volontairement pas de mention « Conforme RGPD » ni « Certifié » : une conformité ne
 * s'autoproclame pas, et une certification relève d'un schéma approuvé (RGPD art. 42).
 *
 * Le panneau est positionné en `absolute` au-dessus de la pastille, sans passer par un service
 * racine comme les menus contextuels : il s'ouvre vers le haut, à l'intérieur de la zone qui défile
 * (`.app-page-body`), donc aucun ancêtre ne le rogne.
 */
@Component({
  selector: 'app-privacy-commitments',
  imports: [IconComponent, EscapeCloseDirective, TranslatePipe],
  templateUrl: './privacy-commitments.component.html',
  styleUrl: './privacy-commitments.component.css',
})
export class PrivacyCommitmentsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly legalPage = inject(LegalPageService);

  protected readonly commitments = COMMITMENTS;
  protected readonly open = signal(false);
  // Le pied de page est rendu une fois par panneau de navigation (voir AppPageComponent) : un
  // identifiant par instance garde `aria-controls` univoque.
  protected readonly panelId = `privacy-commitments-panel-${++nextPanelId}`;

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected readPolicy(): void {
    this.close();
    this.legalPage.open('privacy');
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }
}
