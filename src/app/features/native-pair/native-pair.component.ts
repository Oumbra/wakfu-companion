import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiClientService } from '../../core/api/api-client.service';
import { AuthProvider, AuthService } from '../../core/auth/auth.service';
import { AuthProviderButtonsComponent } from '../../shared/auth-provider-buttons/auth-provider-buttons.component';
import { TranslatePipe } from '../../shared/translate.pipe';

type ClaimState = 'idle' | 'confirming' | 'done' | 'error';

/**
 * Page d'appairage d'un client natif (overlay, lot L4 de `wakfu-companion-overlay` —
 * `docs/plan-architecture.md` §7.2 de ce dépôt). Volontairement HORS du système i18n/
 * `NavigationService` (voir app.routes.ts) : ce n'est pas une vue du tableau de bord mais un écran
 * ponctuel type "device flow", ouvert par l'overlay dans le navigateur par défaut avec `?code=`
 * déjà rempli.
 */
@Component({
  selector: 'app-native-pair',
  imports: [TranslatePipe, AuthProviderButtonsComponent],
  templateUrl: './native-pair.component.html',
  styleUrl: './native-pair.component.css',
})
export class NativePairComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiClientService);
  protected readonly auth = inject(AuthService);

  protected readonly code = signal(
    (this.route.snapshot.queryParamMap.get('code') ?? '').toUpperCase(),
  );
  protected readonly state = signal<ClaimState>('idle');
  protected readonly hasCode = computed(() => this.code().length > 0);

  protected login(provider: AuthProvider): void {
    this.auth.clearError();
    this.auth.login(provider, `/pair?code=${encodeURIComponent(this.code())}`);
  }

  protected async confirm(): Promise<void> {
    if (!this.hasCode() || this.state() === 'confirming') return;
    this.state.set('confirming');
    const result = await this.api.requestJson<{ ok: true }>('/auth/native/claim', {
      method: 'POST',
      body: { pairingCode: this.code() },
    });
    this.state.set(result.ok ? 'done' : 'error');
  }
}
