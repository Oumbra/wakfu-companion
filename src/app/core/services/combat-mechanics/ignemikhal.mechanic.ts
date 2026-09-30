import { CombatMechanic, normalizeMechanicName } from './combat-mechanic.model';

const IGNEMIKHAL = 'ignemikhal';
const PROTECTION_POURPRE = 'protection pourpre';

/**
 * Boss d'intervention « Ignemikhal » — passif « Protection pourpre ».
 *
 * Ce sont les MONSTRES du combat qui portent le passif dès le début (`Elitir: Protection pourpre
 * (Niv. 1)`, un par monstre). Tout dégât qu'un allié inflige à l'un d'eux est aussi infligé à
 * Ignemikhal : la ligne `Ignemikhal: -N PV (Neutre) (Protection pourpre)` précède de 0 à 5 ms le
 * dégât réel sur le monstre protégé, du même montant à ±1 près (111 cas relevés sur le fichier de
 * test anonymisé du 2026-09-29). La résolution générique trouvait le statut dans `effectOwners`
 * et créditait son porteur — le dernier monstre à avoir reçu le passif, donc un ennemi.
 *
 * Attribution retenue, dans l'ordre :
 * 1. le lanceur du dernier sort, s'il n'est pas un monstre (cas de loin le plus fréquent : 110 sur
 *    111 sur le fichier de test, bombes et poisons posés plus tôt compris) ;
 * 2. sinon, si un monstre vient de frapper un allié : cet allié — c'est sa riposte ou son passif
 *    (ex. « Marque eting » de l'Eniripsa) qui a touché un monstre protégé ;
 * 3. sinon la règle s'abstient et la résolution générique s'applique.
 */
export const IGNEMIKHAL_PROTECTION_POURPRE: CombatMechanic = {
  id: 'ignemikhal-protection-pourpre',
  triggerFighterNames: ['Ignemikhal'],
  resolveDamage({ target, effectTag, lastCast, lastDamage, isMonster }) {
    if (!effectTag || normalizeMechanicName(effectTag) !== PROTECTION_POURPRE) return null;
    if (normalizeMechanicName(target) !== IGNEMIKHAL) return null;
    if (lastCast && !isMonster(lastCast.caster)) {
      return { attacker: lastCast.caster, spell: effectTag };
    }
    if (lastDamage && isMonster(lastDamage.attacker) && !isMonster(lastDamage.target)) {
      return { attacker: lastDamage.target, spell: effectTag };
    }
    return null;
  },
};
