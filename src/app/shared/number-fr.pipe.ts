import { Pipe, PipeTransform } from '@angular/core';

/** Formate un nombre à la française (espace comme séparateur de milliers). */
@Pipe({ name: 'numberFr' })
export class NumberFrPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    // `Number(value)` plutôt qu'un simple typage : une agrégation serveur mal typée peut arriver
    // ici sous forme de chaîne numérique (ex. bigint Postgres sérialisé en JSON — voir
    // functions/api/v1/history/stats.ts) ; `"163900".toLocaleString('fr-FR')` retomberait sur
    // `Object.prototype.toLocaleString`, qui ignore la locale et renvoie la chaîne brute non
    // séparée par milliers. Coercition défensive pour ne jamais reproduire ce bug silencieusement.
    const n = value == null ? NaN : Number(value);
    if (Number.isNaN(n)) return '0';
    return n.toLocaleString('fr-FR');
  }
}
