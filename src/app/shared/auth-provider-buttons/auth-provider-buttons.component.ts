import { Component, computed, inject, input, output } from '@angular/core';
import { AuthProvider } from '../../core/auth/auth.service';
import { I18nService } from '../../core/services/i18n.service';
import { LegalPageService, type LegalPageKind } from '../../core/services/legal-page.service';
import { IconComponent } from '../icon/icon.component';
import { TranslatePipe } from '../translate.pipe';

/** Segment de la phrase de consentement : texte brut, ou lien vers un texte légal. */
type ConsentPart = { text: string; link?: undefined } | { text?: undefined; link: LegalPageKind };

const CONSENT_LINKS: Record<string, LegalPageKind> = { terms: 'terms', privacy: 'privacy' };

/**
 * Paire de boutons "Discord"/"Google" du flux de connexion OAuth — extraite de l'onglet Connexion
 * de la page profil (voir CLAUDE.md, section "Toujours un composant, jamais un bloc local recopié")
 * pour être réutilisée telle quelle par le bouton "passer cette étape" mobile de la page setup
 * (voir SetupComponent), sans dupliquer les SVG ni le CSS des deux fournisseurs. `disabled()` reflète
 * `AuthService.busy()` côté appelant ; `providerChosen` laisse l'appelant décider de l'appel à
 * `AuthService.login(...)` (nettoyage d'erreur préalable, `redirectTo` éventuel...).
 *
 * Porte aussi la mention « En vous connectant, vous acceptez les CGU et la politique de
 * confidentialité » (information au point de collecte, RGPD art. 13.1 — écart 4.7 de
 * `docs/analyse-rgpd.md`) : c'est le moment exact où l'utilisateur déclenche la transmission de
 * son e-mail, et ces liens n'existaient jusque-là que dans le pied de page. Ici plutôt que chez
 * chaque appelant (profil, setup, appairage natif) pour qu'aucun écran de connexion ne puisse
 * l'omettre. La phrase est UNE clé i18n avec les placeholders `{{terms}}`/`{{privacy}}` (ordre
 * des mots libre par langue), découpée ici en segments pour que les deux liens soient de vrais
 * boutons ouvrant `LegalPageService` — pas du HTML injecté.
 *
 * `linkedProviders()` : fournisseurs déjà liés au compte connecté (vide en invité). Un compte ne
 * se connecte qu'avec UN seul fournisseur (Discord OU Google, jamais les deux — choix produit) :
 * dès qu'un fournisseur est lié, les deux boutons sont grisés et désactivés, et celui du
 * fournisseur lié porte le badge « Lié ». Relancer le flux OAuth du fournisseur lié ne ferait que
 * rouvrir la même session ; celui de l'autre fournisseur lierait une seconde identité.
 */
@Component({
  selector: 'app-auth-provider-buttons',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './auth-provider-buttons.component.html',
  styleUrl: './auth-provider-buttons.component.css',
})
export class AuthProviderButtonsComponent {
  private readonly i18n = inject(I18nService);
  protected readonly legalPage = inject(LegalPageService);

  readonly disabled = input(false);
  readonly linkedProviders = input<readonly AuthProvider[]>([]);
  readonly providerChosen = output<AuthProvider>();

  protected readonly locked = computed(() => this.linkedProviders().length > 0);

  protected isLinked(provider: AuthProvider): boolean {
    return this.linkedProviders().includes(provider);
  }

  protected readonly consentParts = computed<ConsentPart[]>(() =>
    this.i18n
      .t('auth.login.consent')
      .split(/(\{\{(?:terms|privacy)\}\})/)
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        const link = CONSENT_LINKS[segment.slice(2, -2)];
        return link && segment.startsWith('{{') ? { link } : { text: segment };
      }),
  );
}
