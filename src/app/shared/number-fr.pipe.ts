import { Pipe, PipeTransform } from '@angular/core';

/** Formate un nombre à la française (espace comme séparateur de milliers). */
@Pipe({ name: 'numberFr' })
export class NumberFrPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '0';
    return value.toLocaleString('fr-FR');
  }
}
