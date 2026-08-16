import { Component, inject, signal } from '@angular/core';
import { LogFileAccessService } from '../../core/services/log-file-access.service';
import {
  BrowserIconComponent,
  BrowserKind,
} from '../../shared/browser-icon/browser-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { TranslateHtmlPipe } from '../../shared/translate-html.pipe';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

interface CompatibleBrowser {
  kind: BrowserKind;
  name: string;
  downloadUrl: string;
}

const COMPATIBLE_BROWSERS: readonly CompatibleBrowser[] = [
  { kind: 'chrome', name: 'Google Chrome', downloadUrl: 'https://www.google.com/chrome/' },
  { kind: 'edge', name: 'Microsoft Edge', downloadUrl: 'https://www.microsoft.com/edge' },
  { kind: 'opera', name: 'Opera', downloadUrl: 'https://www.opera.com/download' },
];

@Component({
  selector: 'app-setup',
  imports: [TranslatePipe, TranslateHtmlPipe, BrowserIconComponent, TooltipDirective],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css',
})
export class SetupComponent {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly dragOver = signal(false);
  protected readonly compatibleBrowsers = COMPATIBLE_BROWSERS;
  protected readonly showWhy = signal(false);

  protected toggleWhy(): void {
    this.showWhy.update((value) => !value);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (event.dataTransfer) {
      void this.logFileAccess.handleDrop(event.dataTransfer);
    }
  }

  protected pickFile(): void {
    void this.logFileAccess.pickFile();
  }

  protected reconnect(): void {
    void this.logFileAccess.reconnect();
  }

  protected forget(): void {
    void this.logFileAccess.forgetFile();
  }
}
