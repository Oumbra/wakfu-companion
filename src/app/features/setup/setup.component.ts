import { Component, inject, signal } from '@angular/core';
import { LogFileAccessService } from '../../core/services/log-file-access.service';

@Component({
  selector: 'app-setup',
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css',
})
export class SetupComponent {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly dragOver = signal(false);

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
