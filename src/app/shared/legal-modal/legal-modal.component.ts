import { Component, inject } from '@angular/core';
import { LegalModalService } from '../../core/services/legal-modal.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Modale des pages légales du footer (confidentialité/conditions/mentions légales) — rendue une
 * seule fois au niveau racine (voir app.html, même principe que HelpModalComponent/
 * ClassPickerComponent) pour ne jamais hériter d'un ancêtre `transform` qui casserait son
 * positionnement (voir CLAUDE.md). Pilotée par LegalModalService : chaque lien du footer appelle
 * `legalModal.open('<section>')`, le contenu est résolu ici via les clés i18n
 * `legal.<section>.title`/`legal.<section>.body`. Plus large et plus haute que HelpModalComponent
 * (texte long, structuré en paragraphes via `\n\n`, voir `.legal-modal-body` en CSS).
 */
@Component({
  selector: 'app-legal-modal',
  imports: [TranslatePipe],
  templateUrl: './legal-modal.component.html',
  styleUrl: './legal-modal.component.css',
})
export class LegalModalComponent {
  protected readonly legalModal = inject(LegalModalService);
}
