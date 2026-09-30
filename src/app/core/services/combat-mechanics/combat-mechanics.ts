import {
  CombatMechanic,
  MechanicAttribution,
  MechanicDamageContext,
  normalizeMechanicName,
} from './combat-mechanic.model';
import { IGNEMIKHAL_PROTECTION_POURPRE } from './ignemikhal.mechanic';

export type { CombatMechanic, MechanicAttribution, MechanicDamageContext };

/** Registre des règles propres à une mécanique de combat — ajouter ici toute nouvelle règle. */
export const COMBAT_MECHANICS: readonly CombatMechanic[] = [IGNEMIKHAL_PROTECTION_POURPRE];

/** Index nom de combattant déclencheur → règles, calculé une fois : la jointure d'un combattant
 * (chemin chaud d'ingestion) ne balaie jamais le registre. */
const MECHANICS_BY_TRIGGER = new Map<string, CombatMechanic[]>();
for (const mechanic of COMBAT_MECHANICS) {
  for (const name of mechanic.triggerFighterNames) {
    const key = normalizeMechanicName(name);
    const list = MECHANICS_BY_TRIGGER.get(key) ?? [];
    list.push(mechanic);
    MECHANICS_BY_TRIGGER.set(key, list);
  }
}

const NO_MECHANICS: readonly CombatMechanic[] = [];

/** Règles que la présence du combattant `name` active dans son combat. O(1). */
export function mechanicsTriggeredBy(name: string): readonly CombatMechanic[] {
  return MECHANICS_BY_TRIGGER.get(normalizeMechanicName(name)) ?? NO_MECHANICS;
}

/** Première attribution imposée par une règle active, `null` si aucune ne s'applique. */
export function resolveMechanicDamage(
  active: readonly CombatMechanic[],
  context: MechanicDamageContext,
): MechanicAttribution | null {
  for (const mechanic of active) {
    const attribution = mechanic.resolveDamage?.(context);
    if (attribution) return attribution;
  }
  return null;
}
