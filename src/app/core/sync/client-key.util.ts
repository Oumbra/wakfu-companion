import type { HistoryEventKind } from './history-event.model';

/**
 * Clé déterministe d'un événement d'historique (lot 8, prompt 8.1 — « le point
 * technique le plus important de toute la migration », §11 du plan) :
 *
 * ```
 * client_key = sha256(uid + type + heure du log + signature du contenu)
 * ```
 *
 * Elle rencontre côté serveur un `UNIQUE (user_id, client_key)` et un
 * `INSERT ... ON CONFLICT DO NOTHING` : rejouer dix fois le même log n'écrit
 * qu'une ligne.
 *
 * ## Pourquoi l'`uid` en fait partie
 *
 * La contrainte d'unicité est déjà portée par `(user_id, client_key)`, donc la
 * clé n'a pas *besoin* d'être globalement unique. L'inclure évite néanmoins que
 * deux comptes distincts produisent la même valeur pour un même événement, ce
 * qui ferait de `client_key` un identifiant corrélable d'un compte à l'autre.
 *
 * ## Pourquoi asynchrone, et où c'est calculé
 *
 * `crypto.subtle.digest` est asynchrone par nature. Le calcul se fait donc au
 * moment de l'envoi (dans `SyncQueueService`), **jamais** dans le chemin chaud
 * de parsing du log : `StatsStoreService` n'y produit que des signatures
 * synchrones (voir `history-event.model.ts`), le hachage vient après.
 */
export async function computeClientKey(
  uid: string,
  kind: HistoryEventKind,
  signature: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${uid}|${kind}|${signature}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
