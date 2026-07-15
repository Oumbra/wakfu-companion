import { Injectable, signal } from '@angular/core';
import { WAKFU_MONSTER_NAMES_FR } from '../data/wakfu-monster-names.data';
import { WAKFU_CLASS_SPELLS_FR } from '../data/wakfu-class-spells.data';
import { WAKFU_ENEMY_FAMILIES } from '../data/wakfu-enemy-families.data';
import { WAKFU_ALLY_SUMMONS } from '../data/wakfu-ally-summons.data';
import { PersistenceService } from './persistence.service';

const OVERRIDES_KEY = 'wakfu-entity-overrides';

export type EntitySide = 'ally' | 'enemy';

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/** Tolère les variantes de ponctuation d'un même sort ("Brise'Os" vs "Brise-os"). */
function normalizeSpellKey(spell: string): string {
  return spell.toLowerCase().replace(/['’\-\s]/g, '');
}

function buildSpellToClassMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [className, spells] of Object.entries(WAKFU_CLASS_SPELLS_FR)) {
    for (const spell of spells) {
      map.set(normalizeSpellKey(spell), className);
    }
  }
  return map;
}

/**
 * Réplique la logique `isPlayerAlly` du site de référence : cascade
 * override manuel → base de monstres officielle → familles d'ennemis
 * génériques → classe détectée via les sorts lancés → invocations connues
 * → ennemi par défaut.
 */
@Injectable({ providedIn: 'root' })
export class EntityClassifierService {
  private readonly monsterNames = new Set(WAKFU_MONSTER_NAMES_FR.map(normalizeName));
  private readonly enemyFamilies = WAKFU_ENEMY_FAMILIES.map(normalizeName);
  private readonly allySummonNames = new Set(WAKFU_ALLY_SUMMONS.map(normalizeName));
  private readonly spellToClass = buildSpellToClassMap();

  // Mutable, alimentée ligne par ligne (potentiellement des milliers de fois
  // lors de la lecture initiale d'un fichier) : volontairement pas un signal.
  private readonly detectedClasses = new Map<string, string>();
  private readonly overrides: Map<string, EntitySide>;

  /** Incrémentée par commit()/setOverride() pour notifier les computed() consommateurs. */
  readonly version = signal(0);

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<Record<string, EntitySide>>(OVERRIDES_KEY) ?? {};
    this.overrides = new Map(Object.entries(stored));
  }

  /** À appeler pour chaque ligne "X lance le sort Y" rencontrée. */
  registerSpellCast(caster: string, spell: string): void {
    if (this.monsterNames.has(normalizeName(caster))) return;
    const className = this.spellToClass.get(normalizeSpellKey(spell));
    if (className && this.detectedClasses.get(caster) !== className) {
      this.detectedClasses.set(caster, className);
    }
  }

  /** À appeler une fois par lot de lignes traité (voir StatsStoreService.ingest). */
  commit(): void {
    this.version.update((v) => v + 1);
  }

  classify(name: string): EntitySide {
    this.version(); // dépendance réactive pour les computed() appelants
    const override = this.overrides.get(name);
    if (override) return override;

    const lower = normalizeName(name);
    if (this.monsterNames.has(lower)) return 'enemy';
    if (this.enemyFamilies.some((fam) => lower.includes(fam))) return 'enemy';
    if (this.detectedClasses.has(name)) return 'ally';
    if (this.allySummonNames.has(lower)) return 'ally';
    return 'enemy';
  }

  setOverride(name: string, side: EntitySide): void {
    this.overrides.set(name, side);
    this.persistence.setJson(OVERRIDES_KEY, Object.fromEntries(this.overrides));
    this.version.update((v) => v + 1);
  }

  /** Classe détectée pour ce nom (via ses sorts lancés), si connue. */
  getDetectedClass(name: string): string | undefined {
    this.version(); // dépendance réactive
    return this.detectedClasses.get(name);
  }
}
