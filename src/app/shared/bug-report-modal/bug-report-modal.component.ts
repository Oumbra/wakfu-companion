import { Component, inject, signal } from '@angular/core';
import { BugReportModalService } from '../../core/services/bug-report-modal.service';
import { LoadingOverlayService } from '../../core/services/loading-overlay.service';
import {
  anonymizeWakfuLog,
  WakfuLogAnonymizationResult,
} from '../../core/utils/wakfu-log-anonymizer.util';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { EscapeCloseDirective } from '../escape-close.directive';
import { IconComponent } from '../icon/icon.component';

/** Adresse de contact (même adresse que les mentions légales). */
export const BUG_REPORT_EMAIL = 'contact@wakfu-companion.com';
/** Nom du fichier téléchargé après anonymisation. */
export const ANONYMIZED_LOG_FILE_NAME = 'wakfu-anonymous.log';

/**
 * Modale « Signaler un bug » — ouverte depuis l'icône insecte de l'en-tête du profil, rendue une
 * seule fois au niveau racine (voir app.html), même principe que HelpModalComponent. L'utilisateur
 * choisit son `wakfu.log`, qui est anonymisé localement (voir `anonymizeWakfuLog` : pseudonymes,
 * identifiants, jeton, chemins, IP, messages privés supprimés) puis téléchargé automatiquement sous
 * le nom `wakfu-anonymous.log`, prêt à joindre à un e-mail. Rien n'est envoyé au serveur.
 */
@Component({
  selector: 'app-bug-report-modal',
  imports: [TranslatePipe, TooltipDirective, EscapeCloseDirective, IconComponent],
  templateUrl: './bug-report-modal.component.html',
  styleUrl: './bug-report-modal.component.css',
})
export class BugReportModalComponent {
  protected readonly modal = inject(BugReportModalService);
  private readonly loadingOverlay = inject(LoadingOverlayService);

  protected readonly email = BUG_REPORT_EMAIL;
  protected readonly fileName = ANONYMIZED_LOG_FILE_NAME;
  protected readonly result = signal<WakfuLogAnonymizationResult | null>(null);
  protected readonly failed = signal(false);

  protected close(): void {
    this.result.set(null);
    this.failed.set(false);
    this.modal.close();
  }

  protected pickFile(input: HTMLInputElement): void {
    input.click();
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.result.set(null);
    this.failed.set(false);
    try {
      const result = await this.loadingOverlay.track(this.anonymize(file));
      this.download(result.text);
      this.result.set(result);
    } catch {
      this.failed.set(true);
    }
  }

  /** Lecture puis anonymisation, après un tour de boucle pour laisser l'overlay s'afficher : le
   * traitement est synchrone et peut prendre une seconde sur un gros journal. */
  private async anonymize(file: File): Promise<WakfuLogAnonymizationResult> {
    const text = await file.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return anonymizeWakfuLog(text);
  }

  private download(text: string): void {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = ANONYMIZED_LOG_FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
  }
}
