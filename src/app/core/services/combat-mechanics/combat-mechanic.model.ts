/**
 * Règles d'attribution PROPRES À UNE MÉCANIQUE DE COMBAT précise (boss, donjon, événement), par
 * opposition aux règles génériques de `LogParser.resolveEffectTail` qui valent pour tout combat.
 *
 * Une règle n'est active que dans un combat où l'un de ses combattants déclencheurs a rejoint le
 * combat (ligne `[_FL_] ... join the fight`) : hors de ces combats, elle n'est jamais consultée et
 * le parseur garde strictement son comportement générique. Le parseur ne connaît aucune règle par
 * son nom — il se contente de consulter le registre (`combat-mechanics.ts`).
 */

/** Ce qu'une règle sait d'une ligne de dégât au moment de résoudre son attaquant. */
export interface MechanicDamageContext {
  /** Combattant qui perd les PV (connu avec certitude dès la regex). */
  target: string;
  /** Dernier tag « mécanique » de la ligne (statut, passif, glyphe...), hors élément et hors
   * "Parade !" — ex. `Protection pourpre` dans `Boss: -N PV (Feu) (Protection pourpre)`. */
  effectTag: string | null;
  /** Dernier sort lancé dans CE combat (voir `FightParseState.lastCast`). */
  lastCast: { caster: string; spell: string } | null;
}

/** Attribution imposée par une règle : remplace la résolution générique. */
export interface MechanicAttribution {
  attacker: string;
  spell: string;
}

export interface CombatMechanic {
  /** Identifiant stable, pour les journaux et les tests. */
  readonly id: string;
  /** Noms de combattants dont la présence dans un combat active la règle (comparés sans tenir
   * compte de la casse ni des espaces de bord). */
  readonly triggerFighterNames: readonly string[];
  /**
   * Résout l'auteur d'une perte de PV. `null` : la règle ne s'applique pas à cette ligne, la
   * résolution générique (ou la règle active suivante) prend le relais. Appelée pour CHAQUE ligne
   * de dégât d'un combat où la règle est active : doit rester O(1).
   */
  resolveDamage?(context: MechanicDamageContext): MechanicAttribution | null;
}

/** Normalisation commune des noms comparés par les règles. */
export function normalizeMechanicName(name: string): string {
  return name.trim().toLowerCase();
}
