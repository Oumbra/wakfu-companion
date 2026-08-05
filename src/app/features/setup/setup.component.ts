import { Component, inject, signal } from '@angular/core';
import { LogFileAccessService } from '../../core/services/log-file-access.service';
import {
  BrowserIconComponent,
  BrowserKind,
} from '../../shared/browser-icon/browser-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';

interface CompatibleBrowser {
  kind: BrowserKind;
  name: string;
}

const COMPATIBLE_BROWSERS: readonly CompatibleBrowser[] = [
  { kind: 'chrome', name: 'Google Chrome' },
  { kind: 'edge', name: 'Microsoft Edge' },
  { kind: 'opera', name: 'Opera' },
];

@Component({
  selector: 'app-setup',
  imports: [TranslatePipe, BrowserIconComponent],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css',
})
export class SetupComponent {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly dragOver = signal(false);
  protected readonly compatibleBrowsers = COMPATIBLE_BROWSERS;

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
