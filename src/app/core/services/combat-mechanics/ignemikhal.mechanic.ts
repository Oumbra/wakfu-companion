import { CombatMechanic, normalizeMechanicName } from './combat-mechanic.model';

const IGNEMIKHAL = 'ignemikhal';
const PROTECTION_POURPRE = 'protection pourpre';

/**
 * Boss d'intervention « Ignemikhal » — passif « Protection pourpre ».
 *
 * Les alliés portent le passif dès le début du combat (`Allié: Protection pourpre (Niv. N)`). Tout
 * dégât qu'un allié inflige, même à un AUTRE monstre, est répercuté sur Ignemikhal par une ligne
 * `Ignemikhal: -N PV (Élément) (Protection pourpre)`. La résolution générique trouvait le statut
 * dans `effectOwners` et créditait son porteur — le dernier allié à avoir reçu le passif au
 * début du combat, sans rapport avec le coup. L'auteur réel est l'allié qui vient de lancer le
 * sort : c'est lui qui est crédité, sous le libellé « Protection pourpre ».
 *
 * Si le dernier sort connu est celui d'Ignemikhal lui-même (ou qu'aucun sort n'a encore été
 * lancé), la règle s'abstient et la résolution générique s'applique.
 */
export const IGNEMIKHAL_PROTECTION_POURPRE: CombatMechanic = {
  id: 'ignemikhal-protection-pourpre',
  triggerFighterNames: ['Ignemikhal'],
  resolveDamage({ target, effectTag, lastCast }) {
    if (!effectTag || normalizeMechanicName(effectTag) !== PROTECTION_POURPRE) return null;
    if (normalizeMechanicName(target) !== IGNEMIKHAL) return null;
    if (!lastCast || normalizeMechanicName(lastCast.caster) === IGNEMIKHAL) return null;
    return { attacker: lastCast.caster, spell: effectTag };
  },
};
