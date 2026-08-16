import { Component, inject } from '@angular/core';
import { TabSheetService } from '../../core/services/tab-sheet.service';
import { TranslatePipe } from '../translate.pipe';
import { EscapeCloseDirective } from '../escape-close.directive';

/**
 * Feuille listant verticalement tous les onglets d'une barre à défilement horizontal (voir
 * TabSheetService) — rendue une seule fois au niveau racine (voir app.html), pilotée par un simple
 * signal de requête ouverte, dans le même esprit que HelpModalComponent/ClassPickerComponent.
 */
@Component({
  selector: 'app-tab-sheet',
  imports: [TranslatePipe, EscapeCloseDirective],
  templateUrl: './tab-sheet.component.html',
  styleUrl: './tab-sheet.component.css',
})
export class TabSheetComponent {
  protected readonly tabSheet = inject(TabSheetService);

  protected select(id: string): void {
    this.tabSheet.request()?.onSelect(id);
    this.tabSheet.close();
  }
}
