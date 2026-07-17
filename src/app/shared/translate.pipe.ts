import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../core/services/i18n.service';

/**
 * Pipe impur (volontaire) : une clé de traduction ne change jamais quand la
 * locale change, donc un pipe pur ne se réévaluerait pas au changement de
 * langue. Le coût est négligeable vu le nombre d'usages dans cette app.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string): string {
    return this.i18n.t(key);
  }
}
