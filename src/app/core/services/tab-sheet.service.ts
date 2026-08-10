import { Injectable, signal } from '@angular/core';

export interface TabSheetItem {
  id: string;
  label: string;
}

export interface TabSheetRequest {
  items: readonly TabSheetItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Titre affiché en tête de la feuille (ex. le titre de la page courante) — clé i18n ou texte
   * déjà résolu, la même règle que `TabSheetItem.label` (voir TabBarComponent). Omis : pas d'en-tête. */
  title?: string;
}

/**
 * Pilote la feuille de sélection d'onglets (TabSheetComponent, rendue une seule fois au niveau
 * racine — voir app.html, même principe que HelpModalService/ClassPickerService) : liste complète
 * des onglets d'une barre à défilement horizontal, utile quand elle déborde (voir
 * profile-page.component.ts/css — inspiré du sélecteur de catégories d'Uber Eats).
 *
 * Rendue à la racine plutôt que dans le composant appelant pour la même raison que
 * ClassPickerComponent (voir CLAUDE.md) : un `position: fixed` niché dans un ancêtre `transform`
 * (ici `.view-panel`) se positionnerait relativement à cet ancêtre plutôt qu'au viewport.
 */
@Injectable({ providedIn: 'root' })
export class TabSheetService {
  readonly request = signal<TabSheetRequest | null>(null);

  open(
    items: readonly TabSheetItem[],
    activeId: string,
    onSelect: (id: string) => void,
    title?: string,
  ): void {
    this.request.set({ items, activeId, onSelect, title });
  }

  close(): void {
    this.request.set(null);
  }
}
