import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../core/services/i18n.service';

/**
 * Formate un nombre selon la locale COURANTE de l'app (séparateur de milliers : espace insécable
 * en français, virgule en anglais, point en espagnol/portugais...) — délègue à
 * `I18nService.formatNumber`, ne duplique pas la logique `Intl.NumberFormat`.
 *
 * Remplace le 2026-08-28 l'ancien `NumberFrPipe` (`numberFr`), qui formatait TOUJOURS à la
 * française (`toLocaleString('fr-FR')` codé en dur) quelle que soit la langue active de l'app —
 * bug réel remonté par l'utilisateur après un test en espagnol/anglais/portugais : tous les grands
 * nombres (XP, kamas, nombre de cases de donjon, combats gagnés/perdus...) restaient séparés par
 * milliers "à la française" dans les 3 autres langues. Pipe impur (comme `TranslatePipe`) : un
 * nombre ne change pas de valeur quand la locale change, donc un pipe pur ne se réévaluerait
 * jamais au changement de langue — coût négligeable vu le volume d'usages dans l'app.
 */
@Pipe({ name: 'localeNumber', pure: false })
export class LocaleNumberPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(value: number | string | null | undefined): string {
    // `Number(value)` plutôt qu'un simple typage : une agrégation serveur mal typée peut arriver
    // ici sous forme de chaîne numérique (ex. bigint Postgres sérialisé en JSON — voir
    // functions/api/v1/history/stats.ts) ; `"163900".toLocaleString(...)` retomberait sur
    // `Object.prototype.toLocaleString`, qui ignore la locale et renvoie la chaîne brute non
    // séparée par milliers. Coercition défensive pour ne jamais reproduire ce bug silencieusement.
    const n = value == null ? NaN : Number(value);
    if (Number.isNaN(n)) return '0';
    return this.i18n.formatNumber(n);
  }
}
