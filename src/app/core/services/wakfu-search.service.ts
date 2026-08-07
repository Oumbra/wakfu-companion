import { inject, Injectable } from '@angular/core';
import { WakfuRarity } from '../data/wakfu-item-rarity.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';
import { AppLocale, I18nService } from './i18n.service';
import { CatalogService } from '../api/catalog.service';

export type WakfuSearchKind = 'item' | 'enemy';

export interface WakfuSearchResult {
  /** Nom FR canonique : clé de stockage (suivi, alertes sonores) et d'icône. */
  name: string;
  /** Nom dans la langue actuelle de l'utilisateur, pour l'affichage dans la liste. */
  label: string;
  kind: WakfuSearchKind;
  /** Vrai pour un objet ayant une recette de métier connue (voir wakfu-items.data.ts) — toujours
   * faux pour un monstre. Pilote l'icône "suivre les objets de la recette" de l'autocomplétion. */
  hasRecipe: boolean;
  /** `id` Ankama de l'objet/monstre (`null` pour les rares objets historiques sans id, voir
   * wakfu-items.data.ts) — résolution non ambiguë en cas d'homonymes (ex. un objet existant en
   * plusieurs raretés), notamment pour ouvrir la bonne recette (findWakfuItemEntryById). */
  id: number | null;
  /** Rareté de l'objet (voir wakfu-item-rarity.data.ts), `null` pour un monstre — pilote l'icône
   * de rareté affichée devant le nom dans l'autocomplétion. */
  rarity: WakfuRarity | null;
}

interface LocalizedEntry {
  fr: string;
  en: string;
  es: string;
  pt: string;
  id: number | null;
  /** Absent des entrées monstre — voir WakfuSearchResult.hasRecipe. */
  hasRecipe?: boolean;
  /** Absent des entrées monstre — voir WakfuSearchResult.rarity. */
  rarity?: WakfuRarity;
}

const MIN_QUERY_LENGTH = 3;

interface SearchEntry {
  fr: string;
  label: string;
  kind: WakfuSearchKind;
  hasRecipe: boolean;
  id: number | null;
  rarity: WakfuRarity | null;
}

function localizedName(entry: LocalizedEntry, locale: AppLocale): string {
  return locale === 'fr' ? entry.fr : entry[locale];
}

function searchEntries(
  entries: Iterable<LocalizedEntry>,
  kind: WakfuSearchKind,
  query: string,
  locale: AppLocale,
): SearchEntry[] {
  const results: SearchEntry[] = [];
  for (const entry of entries) {
    const label = localizedName(entry, locale);
    const normalizedLabel = normalizeWakfuName(label);
    if (!normalizedLabel.includes(query)) continue;
    results.push({
      fr: entry.fr,
      label,
      kind,
      hasRecipe: entry.hasRecipe ?? false,
      id: entry.id,
      rarity: entry.rarity ?? null,
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
  private readonly catalog = inject(CatalogService);

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
    return this.matchedSearch(this.catalog.itemEntries(), 'item', query);
  }

  private matchedEnemies(query: string): SearchEntry[] {
    return this.matchedSearch(this.catalog.monsterEntries(), 'enemy', query);
  }

  private matchedSearch(
    entries: Iterable<LocalizedEntry>,
    kind: WakfuSearchKind,
    query: string,
  ): SearchEntry[] {
    const normalized = normalizeWakfuName(query);
    if (normalized.length < MIN_QUERY_LENGTH) return [];
    return searchEntries(entries, kind, normalized, this.i18n.locale());
  }

  private sortAlphabetically(entries: SearchEntry[]): WakfuSearchResult[] {
    return entries
      .sort((a, b) => a.label.localeCompare(b.label, this.i18n.locale()))
      .map((r) => ({
        name: r.fr,
        label: r.label,
        kind: r.kind,
        hasRecipe: r.hasRecipe,
        id: r.id,
        rarity: r.rarity,
      }));
  }
}
