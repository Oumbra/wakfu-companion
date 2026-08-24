import { Injectable, inject, signal } from '@angular/core';
import { CatalogService } from '../api/catalog.service';
import { WAKFU_CLASS_SPELLS_FR } from '../data/wakfu-class-spells.data';
import { WAKFU_ALLY_SUMMONS } from '../data/wakfu-ally-summons.data';
import { WAKFU_CLASS_BREED_IDS } from '../data/wakfu-class-breed-ids.data';
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
 * Cascade de classification allié/ennemi : override manuel → marqueur
 * déterministe "[_FL_] ... isControlledByAI=..." du combat (voir
 * `fighterAiSide`, alimenté soit par `registerFighterJoin` pour un vrai
 * combattant, soit par `registerSummonJoin` pour une invocation identifiée
 * par LogParser — qui hérite alors du camp de son invocateur plutôt que du
 * flag brut, toujours `true` pour une invocation, voir CLAUDE.md — SAUF si
 * l'invocation est elle-même un vrai monstre du référentiel officiel, voir
 * l'exception documentée sur `registerSummonJoin`) → base de
 * monstres officielle → roster de personnages déclarés → classe détectée via
 * les sorts lancés → invocations connues (liste statique `WAKFU_ALLY_SUMMONS`,
 * repli pour un historique reconstruit sans ligne `_FL_` exploitable) →
 * dégâts encaissés d'un ennemi confirmé → ennemi par défaut.
 *
 * Cascade de DÉTECTION DE CLASSE d'un allié (voir `getDetectedClass`) :
 * classe manuelle (clic droit) → classe déclarée dans le roster de
 * personnages (préférences utilisateur, page profil) → `breed` de la ligne
 * "[_FL_] ... isControlledByAI=false" du combat (voir `WAKFU_CLASS_BREED_IDS`,
 * déterministe pour un allié confirmé — contrairement au camp, voir
 * `fighterAiSide`, `breed` seul ne sert JAMAIS à distinguer un allié d'un
 * ennemi) → classe détectée via les sorts lancés (repli, pour les alliés
 * apparus avant l'ajout de cette détection ou sans ligne `_FL_` exploitable).
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
  /** Noms dont la classe dans `detectedClasses` vient du `breed` déterministe
   * de la ligne "[_FL_] ... isControlledByAI=false" (pas de la détection par
   * sorts) — jamais persistée (redérivée à chaque combat), sert uniquement à
   * empêcher `registerSpellCast` d'écraser cette valeur fiable par une
   * détection par sort potentiellement erronée (sort homonyme, etc.). */
  private readonly breedDetectedNames = new Set<string>();
  /** Cibles ayant pris des dégâts d'un ennemi confirmé (base de monstres officielle) sans être elles-mêmes un ennemi confirmé : ce sont forcément des alliés (deux monstres ne se tapent pas dessus). */
  private readonly confirmedAlliesByDamage = new Set<string>();
  /**
   * Camp déduit du marqueur "[_FL_] ... isControlledByAI=true/false" émis à
   * chaque combat pour chaque combattant : signal fiable et systématique (pas
   * en mémoire persistante, redérivé à chaque combat), fourni directement par
   * le jeu — donc prioritaire sur toutes les heuristiques ci-dessous
   * (catalogue de monstres statique, sorts lancés, dégâts encaissés...), qui
   * peuvent se tromper (monstre absent du catalogue, sort homonyme d'un sort
   * de classe joueur, etc.) là où ce marqueur ne le peut pas pour un
   * combattant déjà vu dans cette session. Remonté ici en 2ᵉ position (juste
   * après l'override manuel) plutôt qu'en dernier recours comme auparavant :
   * `breed` seul (id de classe joueur 1-19 vs id de monstre) n'est PAS
   * déterministe (des monstres bas niveau comme "Bouftou"/"Boufton Noir"/
   * "Chef de Guerre Bouftou" ont des breed 1/2/3, qui collisionnent avec les
   * id de classe Féca/Sadida/Sacrier — vérifié sur `tests/logs/fr/*.log`),
   * seul `isControlledByAI` l'est.
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
    if (this.breedDetectedNames.has(caster)) return; // breed déjà déterministe, ne pas écraser (voir breedDetectedNames)
    const className = this.spellToClass.get(normalizeSpellKey(spell));
    if (className && this.detectedClasses.get(caster) !== className) {
      this.detectedClasses.set(caster, className);
      this.detectedClassesDirty = true;
    }
  }

  /** À appeler pour chaque ligne "[_FL_] ... isControlledByAI=..." rencontrée, pour un combattant
   * qui N'EST PAS une invocation (voir registerSummonJoin sinon) — le flag brut fait foi. */
  registerFighterJoin(name: string, isControlledByAI: boolean, breed: number): void {
    this.fighterAiSide.set(name, isControlledByAI ? 'enemy' : 'ally');
    if (isControlledByAI) return;
    const className = WAKFU_CLASS_BREED_IDS[breed];
    if (className && this.detectedClasses.get(name) !== className) {
      this.detectedClasses.set(name, className);
      this.detectedClassesDirty = true;
    }
    this.breedDetectedNames.add(name);
  }

  /** À appeler pour un combattant identifié comme une invocation (voir LogParser,
   * FighterJoinedEntry.summonedBy) : son camp suit celui de son invocateur plutôt que le flag brut
   * "isControlledByAI" (toujours `true` pour une invocation, alors qu'elle appartient le plus
   * souvent à un allié — voir CLAUDE.md). `casterName` a normalement déjà rejoint ce même combat
   * avant de pouvoir invoquer quoi que ce soit, son camp est donc déjà connu de `classify()`.
   *
   * EXCEPTION (bug réel corrigé le 2026-08-24, combat "K'abah'al, Gardien de la route des morts") :
   * un vrai monstre du référentiel officiel (`isConfirmedEnemy`, ex. un boss) ne doit JAMAIS hériter
   * du camp d'un "invocateur", même si `LogParser`/`SUMMON_ANNOUNCE_RE` a détecté une ligne
   * "X: Invoque ...". Certains mécanismes de combat détournent ce texte pour un tout autre usage :
   * ce boss punit chaque joueur touché par son affaiblissement en le forçant à afficher
   * "<Joueur>: Invoque un(e) Résidu de K'abah'al" dans le log (un add HOSTILE, pas un familier du
   * joueur), qui à son tour peut réinvoquer le boss lui-même de la même façon — sans ce garde-fou,
   * le boss finissait classé allié (hérité en cascade via ce "Résidu"), donc absent de la liste des
   * ennemis. Le référentiel de monstres (breed/nom croisé avec repository/monsters.json) est un
   * signal strictement plus fiable qu'une ligne de log détournée par une mécanique de boss : un vrai
   * monstre catalogué reste toujours ennemi, quoi qu'il arrive. Sans effet sur les VRAIES invocations
   * alliées (Sadida/Osamodas/Eniripsa...) : celles-ci ne sont normalement pas elles-mêmes des
   * entrées du référentiel (voir CLAUDE.md, homonymie "Chimère veilleuse" — le cas où l'invocation
   * partage son nom avec un monstre sauvage réel reste un angle mort déjà documenté, pas aggravé
   * par ce correctif). */
  registerSummonJoin(name: string, casterName: string): void {
    if (this.isConfirmedEnemy(name)) {
      this.fighterAiSide.set(name, 'enemy');
      return;
    }
    this.fighterAiSide.set(name, this.classify(casterName));
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

    const aiSide = this.fighterAiSide.get(name);
    if (aiSide) return aiSide;

    if (this.isConfirmedEnemy(name)) return 'enemy';
    if (this.roster.hasCharacter(name)) return 'ally';
    if (this.detectedClasses.has(name)) return 'ally';
    if (this.allySummonNames.has(normalizeName(name))) return 'ally';
    if (this.confirmedAlliesByDamage.has(normalizeName(name))) return 'ally';
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
   * sinon le roster de personnages déclarés (page profil, préférences
   * utilisateur), sinon le `breed` déterministe du combat pour cet allié,
   * sinon la détection automatique via les sorts lancés (repli). */
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
