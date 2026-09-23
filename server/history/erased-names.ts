import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { erasedThirdPartyNames } from '../db/schema';

/**
 * Pseudonymes de tiers retirés (droit d'opposition, RGPD art. 21 — voir `erasedThirdPartyNames`
 * dans `server/db/schema.ts` et `server/import/erase-third-party-name.ts`), appliqués à CHAQUE
 * ingestion et pas seulement une fois par le script.
 *
 * Le script renomme ce qui est déjà en base, et `selectWritableParticipants` (ingest.ts) empêche
 * un combat déjà connu de retrouver un siège au nom d'origine. Mais un combat ou un échange NOUVEAU
 * pour la base — combat futur où ce joueur apparaît, file d'envoi restée hors ligne, archive locale
 * renvoyée — arrivait avec le vrai nom et l'écrivait : la demande d'opposition cessait d'être
 * respectée (audit de sécurité du 2026-09-23, lot 7).
 */

/** Remplace le pseudonyme retiré. Générique exprès : ne désigne plus personne. */
export const ERASED_NAME_PLACEHOLDER = 'Joueur retiré';

/** Sous-ensemble (en minuscules) de `names` figurant dans la liste des pseudonymes retirés — une
 * lecture par clé primaire, aucune quand le lot ne porte aucun nom. */
export async function loadErasedNames(db: Db, names: Iterable<string>): Promise<Set<string>> {
  const lowered = [...new Set([...names].map((name) => name.toLowerCase()))];
  if (lowered.length === 0) return new Set();
  const rows = await db
    .select({ nameLower: erasedThirdPartyNames.nameLower })
    .from(erasedThirdPartyNames)
    .where(inArray(erasedThirdPartyNames.nameLower, lowered));
  return new Set(rows.map((row) => row.nameLower));
}

/**
 * Remplace les pseudonymes retirés par `ERASED_NAME_PLACEHOLDER` dans les participants d'UN combat.
 *
 * L'indice d'instance est conservé quand c'est possible : c'est celui que le script a gardé en
 * renommant la ligne déjà en base, donc un combat renvoyé retombe sur le MÊME siège et le met à
 * jour au lieu d'en créer un second. Deux tiers retirés du même combat avec le même indice
 * entreraient en collision (la clé primaire est `(fight_id, name, instance_index)`, sans le camp
 * depuis la migration 0035) : le second reçoit un indice au-delà du plus grand du combat, comme le
 * fait le script.
 */
export function redactParticipants<T extends { name: string; instanceIndex: number }>(
  participants: readonly T[],
  erased: ReadonlySet<string>,
): T[] {
  if (erased.size === 0) return [...participants];
  let maxIndex = participants.reduce((max, p) => Math.max(max, p.instanceIndex), 0);
  const taken = new Set(participants.map((p) => `${p.name}#${p.instanceIndex}`));
  return participants.map((participant) => {
    if (!erased.has(participant.name.toLowerCase())) return participant;
    let instanceIndex = participant.instanceIndex;
    if (taken.has(`${ERASED_NAME_PLACEHOLDER}#${instanceIndex}`)) instanceIndex = ++maxIndex;
    taken.add(`${ERASED_NAME_PLACEHOLDER}#${instanceIndex}`);
    return { ...participant, name: ERASED_NAME_PLACEHOLDER, instanceIndex };
  });
}

/** Nom d'un partenaire d'échange, remplacé s'il a été retiré. */
export function redactPeerName(name: string, erased: ReadonlySet<string>): string {
  return erased.has(name.toLowerCase()) ? ERASED_NAME_PLACEHOLDER : name;
}
