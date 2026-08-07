import { Injectable, inject, signal } from '@angular/core';
import { CatalogService } from '../api/catalog.service';
import { WAKFU_CLASS_SPELLS_FR } from '../data/wakfu-class-spells.data';
import { WAKFU_ALLY_SUMMONS } from '../data/wakfu-ally-summons.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';
import { PersistenceService } from './persistence.service';
import { Gender } from '../data/class-icons.data';
import { CharacterRosterService } from './character-roster.service';

const OVERRIDES_KEY = 'wakfu-entity-overrides';
const MANUAL_CLASSES_KEY = 'wakfu-entity-classes';
const DETECTED_CLASSES_KEY = 'wakfu-entity-detected-classes';
const MANUAL_GENDERS_KEY = 'wakfu-entity-genders';

export type EntitySide = 'ally' | 'enemy';

const normalizeName = normalizeWakfuName;

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
 * override manuel → base de monstres officielle → classe détectée via les
 * sorts lancés → invocations connues → ennemi par défaut.
 */
@Injectable({ providedIn: 'root' })
export class EntityClassifierService {
  private readonly roster = inject(CharacterRosterService);
  private readonly catalog = inject(CatalogService);
  private readonly allySummonNames = new Set(WAKFU_ALLY_SUMMONS.map(normalizeName));
  private readonly spellToClass = buildSpellToClassMap();

  // Alimentée ligne par ligne (potentiellement des milliers de fois lors de
  // la lecture initiale d'un fichier) : la persistance se fait par lot dans
  // commit(), pas à chaque détection, pour éviter une écriture par ligne.
  private readonly detectedClasses: Map<string, string>;
  private detectedClassesDirty = false;
  /** Cibles ayant pris des dégâts d'un ennemi confirmé (base de monstres officielle) sans être elles-mêmes un ennemi confirmé : ce sont forcément des alliés (deux monstres ne se tapent pas dessus). */
  private readonly confirmedAlliesByDamage = new Set<string>();
  /**
   * Camp déduit du marqueur "[_FL_] ... isControlledByAI=true/false" émis à
   * chaque combat pour chaque combattant : signal fiable et systématique (pas
   * en mémoire persistante, redérivé à chaque combat), utilisé seulement en
   * dernier recours avant le repli par défaut — un monstre absent de la base
   * statique ET n'ayant pas encore de dégât attribué serait sinon classé
   * "ennemi" par défaut, tout comme le joueur lui-même si celui-ci n'a ni
   * lancé de sort connu ni pris de dégât ce combat-ci (bug réel observé : le
   * personnage se retrouvait compté comme l'ennemi mis KO).
   */
  private readonly fighterAiSide = new Map<string, EntitySide>();
  private readonly overrides: Map<string, EntitySide>;
  /** Classe choisie manuellement (clic droit sur un allié dont la classe n'a pas pu être détectée via ses sorts). */
  private readonly manualClasses: Map<string, string>;
  /** Sexe des icônes choisi manuellement en même temps que la classe (voir `setManualClass`) — les classes détectées via les sorts n'ont pas cette info, repli sur masculin. */
  private readonly manualGenders: Map<string, Gender>;

  /** Incrémentée par commit()/setOverride() pour notifier les computed() consommateurs. */
  readonly version = signal(0);

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<Record<string, EntitySide>>(OVERRIDES_KEY) ?? {};
    this.overrides = new Map(Object.entries(stored));
    const storedClasses =
      this.persistence.getJson<Record<string, string>>(MANUAL_CLASSES_KEY) ?? {};
    this.manualClasses = new Map(Object.entries(storedClasses));
    const storedGenders =
      this.persistence.getJson<Record<string, Gender>>(MANUAL_GENDERS_KEY) ?? {};
    this.manualGenders = new Map(Object.entries(storedGenders));
    const storedDetected =
      this.persistence.getJson<Record<string, string>>(DETECTED_CLASSES_KEY) ?? {};
    this.detectedClasses = new Map(Object.entries(storedDetected));
  }

  /** À appeler pour chaque ligne "X lance le sort Y" rencontrée. */
  registerSpellCast(caster: string, spell: string): void {
    if (this.catalog.isKnownWakfuMonsterName(caster)) return;
    const className = this.spellToClass.get(normalizeSpellKey(spell));
    if (className && this.detectedClasses.get(caster) !== className) {
      this.detectedClasses.set(caster, className);
      this.detectedClassesDirty = true;
    }
  }

  /** À appeler pour chaque ligne "[_FL_] ... isControlledByAI=..." rencontrée. */
  registerFighterJoin(name: string, isControlledByAI: boolean): void {
    this.fighterAiSide.set(name, isControlledByAI ? 'enemy' : 'ally');
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
    this.catalog.revision(); // idem : reclasse une fois le catalogue de monstres chargé
    const override = this.overrides.get(name);
    if (override) return override;

    if (this.isConfirmedEnemy(name)) return 'enemy';
    if (this.roster.hasCharacter(name)) return 'ally';
    if (this.detectedClasses.has(name)) return 'ally';
    if (this.allySummonNames.has(normalizeName(name))) return 'ally';
    if (this.confirmedAlliesByDamage.has(normalizeName(name))) return 'ally';
    const aiSide = this.fighterAiSide.get(name);
    if (aiSide) return aiSide;
    return 'enemy';
  }

  private isConfirmedEnemy(name: string): boolean {
    return this.catalog.isKnownWakfuMonsterName(name);
  }

  setOverride(name: string, side: EntitySide): void {
    this.overrides.set(name, side);
    this.persistence.setJson(OVERRIDES_KEY, Object.fromEntries(this.overrides));
    this.version.update((v) => v + 1);
  }

  /** Classe détectée pour ce nom : override manuel en priorité (clic droit),
   * sinon le roster de personnages déclarés (page profil), sinon la
   * détection automatique via les sorts lancés. */
  getDetectedClass(name: string): string | undefined {
    this.version(); // dépendance réactive
    return (
      this.manualClasses.get(name) ??
      this.roster.findCharacter(name)?.className ??
      this.detectedClasses.get(name)
    );
  }

  /** Sexe de l'icône pour ce nom : override manuel en priorité, sinon le
   * roster déclaré, 'm' par défaut (la détection par sorts ne donne aucune
   * info de sexe). */
  getGender(name: string): Gender {
    this.version(); // dépendance réactive
    return this.manualGenders.get(name) ?? this.roster.findCharacter(name)?.gender ?? 'm';
  }

  /** Choix manuel de classe (clic droit sur un allié dont la classe n'a pas été détectée automatiquement). */
  setManualClass(name: string, className: string, gender: Gender): void {
    this.manualClasses.set(name, className);
    this.manualGenders.set(name, gender);
    this.persistence.setJson(MANUAL_CLASSES_KEY, Object.fromEntries(this.manualClasses));
    this.persistence.setJson(MANUAL_GENDERS_KEY, Object.fromEntries(this.manualGenders));
    this.version.update((v) => v + 1);
  }
}
