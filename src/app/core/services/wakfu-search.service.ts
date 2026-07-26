import { inject, Injectable } from '@angular/core';
import { WAKFU_ITEMS_FR } from '../data/wakfu-items.data';
import { WAKFU_MONSTERS_FR } from '../data/wakfu-monsters.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';
import { AppLocale, I18nService } from './i18n.service';

export type WakfuSearchKind = 'item' | 'enemy';

export interface WakfuSearchResult {
  /** Nom FR canonique : clé de stockage (suivi, alertes sonores) et d'icône. */
  name: string;
  /** Nom dans la langue actuelle de l'utilisateur, pour l'affichage dans la liste. */
  label: string;
  kind: WakfuSearchKind;
}

interface LocalizedEntry {
  fr: string;
  en: string;
  es: string;
  pt: string;
}

const MIN_QUERY_LENGTH = 3;

interface SearchEntry {
  fr: string;
  label: string;
  kind: WakfuSearchKind;
}

function localizedName(entry: LocalizedEntry, locale: AppLocale): string {
  return locale === 'fr' ? entry.fr : entry[locale];
}

function searchTable(
  table: Readonly<Record<string, LocalizedEntry>>,
  kind: WakfuSearchKind,
  query: string,
  locale: AppLocale,
): SearchEntry[] {
  const results: SearchEntry[] = [];
  for (const key in table) {
    const entry = table[key];
    const label = localizedName(entry, locale);
    const normalizedLabel = normalizeWakfuName(label);
    if (!normalizedLabel.includes(query)) continue;
    results.push({
      fr: entry.fr,
      label,
      kind,
    });
  }
  return results;
}

/**
 * Recherche dans les référentiels objets/monstres (voir wakfu-items.data.ts,
 * wakfu-monsters.data.ts) pour l'autocomplétion des champs d'ajout au suivi
 * (tracker, alertes sonores) — ceux-ci n'acceptent plus de saisie libre,
 * seules les entrées du référentiel peuvent être ajoutées. La recherche et
 * l'affichage se font dans la langue actuelle de l'utilisateur (I18nService),
 * mais le nom stocké/utilisé pour résoudre l'icône reste toujours le nom FR
 * canonique (pivot des logs et des catalogues d'images).
 */
@Injectable({ providedIn: 'root' })
export class WakfuSearchService {
  private readonly i18n = inject(I18nService);

  searchItems(query: string): WakfuSearchResult[] {
    return this.sortAlphabetically(this.matchedItems(query));
  }

  searchEnemies(query: string): WakfuSearchResult[] {
    return this.sortAlphabetically(this.matchedEnemies(query));
  }

  /** Recherche combinée objets + monstres, triée alphabétiquement toutes catégories confondues — le nom (unique par domaine, voir `kind`) sert à identifier le type sans sélecteur manuel. */
  searchAll(query: string): WakfuSearchResult[] {
    return this.sortAlphabetically([...this.matchedItems(query), ...this.matchedEnemies(query)]);
  }

  private matchedItems(query: string): SearchEntry[] {
    return this.matchedSearch(WAKFU_ITEMS_FR, 'item', query);
  }

  private matchedEnemies(query: string): SearchEntry[] {
    return this.matchedSearch(WAKFU_MONSTERS_FR, 'enemy', query);
  }

  private matchedSearch(
    table: Readonly<Record<string, LocalizedEntry>>,
    kind: WakfuSearchKind,
    query: string,
  ): SearchEntry[] {
    const normalized = normalizeWakfuName(query);
    if (normalized.length < MIN_QUERY_LENGTH) return [];
    return searchTable(table, kind, normalized, this.i18n.locale());
  }

  private sortAlphabetically(entries: SearchEntry[]): WakfuSearchResult[] {
    return entries
      .sort((a, b) => a.label.localeCompare(b.label, this.i18n.locale()))
      .map((r) => ({ name: r.fr, label: r.label, kind: r.kind }));
  }
}
