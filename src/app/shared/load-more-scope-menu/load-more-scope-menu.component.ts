import { Component, inject } from '@angular/core';
import {
  LoadMoreScopeMenuRequest,
  LoadMoreScopeMenuService,
} from '../../core/services/load-more-scope-menu.service';
import { LoadMoreSpan } from '../../core/sync/history-event.model';
import { TranslatePipe } from '../translate.pipe';
import { EscapeCloseDirective } from '../escape-close.directive';

interface SpanOption {
  key: LoadMoreSpan;
  labelKey: string;
}

const SPAN_OPTIONS: readonly SpanOption[] = [
  { key: 'week', labelKey: 'history.source.loadWeek' },
  { key: 'month', labelKey: 'history.source.loadMonth' },
  { key: 'year', labelKey: 'history.source.loadYear' },
];

/**
 * Menu déroulant (voir `LoadMoreScopeMenuService` pour le pourquoi d'un rendu à part au niveau
 * racine) proposant les 3 portées temporelles du "Charger plus" de l'historique.
 */
@Component({
  selector: 'app-load-more-scope-menu',
  imports: [TranslatePipe, EscapeCloseDirective],
  templateUrl: './load-more-scope-menu.component.html',
  styleUrl: './load-more-scope-menu.component.css',
})
export class LoadMoreScopeMenuComponent {
  protected readonly menu = inject(LoadMoreScopeMenuService);
  protected readonly spanOptions = SPAN_OPTIONS;

  protected choose(request: LoadMoreScopeMenuRequest, span: LoadMoreSpan): void {
    request.onChoose(span);
    this.menu.close();
  }
}
