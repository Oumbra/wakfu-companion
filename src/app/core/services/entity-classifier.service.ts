import { Injectable, signal } from '@angular/core';
import { WAKFU_MONSTER_NAMES_FR } from '../data/wakfu-monster-names.data';
import { WAKFU_CLASS_SPELLS_FR } from '../data/wakfu-class-spells.data';
import { WAKFU_ENEMY_FAMILIES } from '../data/wakfu-enemy-families.data';
import { WAKFU_ALLY_SUMMONS } from '../data/wakfu-ally-summons.data';
import { PersistenceService } from './persistence.service';

const OVERRIDES_KEY = 'wakfu-entity-overrides';
const MANUAL_CLASSES_KEY = 'wakfu-entity-classes';
const DETECTED_CLASSES_KEY = 'wakfu-entity-detected-classes';

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

  // Alimentée ligne par ligne (potentiellement des milliers de fois lors de
  // la lecture initiale d'un fichier) : la persistance se fait par lot dans
  // commit(), pas à chaque détection, pour éviter une écriture par ligne.
  private readonly detectedClasses: Map<string, string>;
  private detectedClassesDirty = false;
  /** Cibles ayant pris des dégâts d'un ennemi confirmé (base de monstres/familles) sans être elles-mêmes un ennemi confirmé : ce sont forcément des alliés (deux monstres ne se tapent pas dessus). */
  private readonly confirmedAlliesByDamage = new Set<string>();
  private readonly overrides: Map<string, EntitySide>;
  /** Classe choisie manuellement (clic droit sur un allié dont la classe n'a pas pu être détectée via ses sorts). */
  private readonly manualClasses: Map<string, string>;

  /** Incrémentée par commit()/setOverride() pour notifier les computed() consommateurs. */
  readonly version = signal(0);

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<Record<string, EntitySide>>(OVERRIDES_KEY) ?? {};
    this.overrides = new Map(Object.entries(stored));
    const storedClasses = this.persistence.getJson<Record<string, string>>(MANUAL_CLASSES_KEY) ?? {};
    this.manualClasses = new Map(Object.entries(storedClasses));
    const storedDetected =
      this.persistence.getJson<Record<string, string>>(DETECTED_CLASSES_KEY) ?? {};
    this.detectedClasses = new Map(Object.entries(storedDetected));
  }

  /** À appeler pour chaque ligne "X lance le sort Y" rencontrée. */
  registerSpellCast(caster: string, spell: string): void {
    if (this.monsterNames.has(normalizeName(caster))) return;
    const className = this.spellToClass.get(normalizeSpellKey(spell));
    if (className && this.detectedClasses.get(caster) !== className) {
      this.detectedClasses.set(caster, className);
      this.detectedClassesDirty = true;
    }
  }

  /** À appeler pour chaque ligne de dégâts rencontrée. */
  registerDamageTarget(target: string, attacker: string): void {
    if (this.isConfirmedEnemy(attacker) && !this.isConfirmedEnemy(target)) {
      this.confirmedAlliesByDamage.add(normalizeName(target));
    }
  }

  /** À appeler une fois par lot de lignes traité (voir StatsStoreService.ingest). */
  commit(): void {
    if (this.detectedClassesDirty) {
      this.persistence.setJson(DETECTED_CLASSES_KEY, Object.fromEntries(this.detectedClasses));
      this.detectedClassesDirty = false;
    }
    this.version.update((v) => v + 1);
  }

  classify(name: string): EntitySide {
    this.version(); // dépendance réactive pour les computed() appelants
    const override = this.overrides.get(name);
    if (override) return override;

    if (this.isConfirmedEnemy(name)) return 'enemy';
    if (this.detectedClasses.has(name)) return 'ally';
    if (this.allySummonNames.has(normalizeName(name))) return 'ally';
    if (this.confirmedAlliesByDamage.has(normalizeName(name))) return 'ally';
    return 'enemy';
  }

  private isConfirmedEnemy(name: string): boolean {
    const lower = normalizeName(name);
    return this.monsterNames.has(lower) || this.enemyFamilies.some((fam) => lower.includes(fam));
  }

  setOverride(name: string, side: EntitySide): void {
    this.overrides.set(name, side);
    this.persistence.setJson(OVERRIDES_KEY, Object.fromEntries(this.overrides));
    this.version.update((v) => v + 1);
  }

  /** Classe détectée pour ce nom (manuelle en priorité, sinon via ses sorts lancés), si connue. */
  getDetectedClass(name: string): string | undefined {
    this.version(); // dépendance réactive
    return this.manualClasses.get(name) ?? this.detectedClasses.get(name);
  }

  /** Choix manuel de classe (clic droit sur un allié dont la classe n'a pas été détectée automatiquement). */
  setManualClass(name: string, className: string): void {
    this.manualClasses.set(name, className);
    this.persistence.setJson(MANUAL_CLASSES_KEY, Object.fromEntries(this.manualClasses));
    this.version.update((v) => v + 1);
  }
}
