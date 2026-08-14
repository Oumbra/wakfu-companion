import { Component, inject } from '@angular/core';
import { HelpModalService } from '../../core/services/help-modal.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Modale d'aide générique (règles/contraintes/bénéfices d'une section) — rendue une seule fois au
 * niveau racine (voir app.html, même principe que ClassPickerComponent) pour ne jamais hériter
 * d'un ancêtre `transform` qui casserait son positionnement (voir CLAUDE.md). Pilotée par
 * HelpModalService : chaque icône "?" de section appelle `helpModal.open('<section>')`, le contenu
 * est résolu ici via les clés i18n `help.<section>.title`/`help.<section>.body`.
 */
@Component({
  selector: 'app-help-modal',
  imports: [TranslatePipe, TooltipDirective],
  templateUrl: './help-modal.component.html',
  styleUrl: './help-modal.component.css',
})
export class HelpModalComponent {
  protected readonly helpModal = inject(HelpModalService);
}
