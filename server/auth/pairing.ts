/**
 * Appairage d'un client natif (overlay) — lot L4 du plan
 * `wakfu-companion-overlay` (`docs/plan-architecture.md` §7.2 de ce dépôt).
 * Même esprit que `flow.ts` : aucun IO direct, tout passe par le port
 * `AuthStore`, testable sans base ni réseau.
 *
 * Trois étapes :
 * 1. `startPairing` — l'overlay, non authentifié, demande un couple de
 *    codes : `userCode` (court, affiché à l'utilisateur, qu'il confirme
 *    dans son navigateur DÉJÀ connecté) et `deviceCode` (secret, gardé par
 *    l'overlay pour sonder l'état).
 * 2. `claimPairing` — le navigateur connecté associe une VRAIE session
 *    (créée ici comme n'importe quelle session, rotation exclue : un
 *    appairage natif s'ajoute à côté des sessions navigateur, il ne les
 *    remplace pas) au `userCode`.
 * 3. `pollPairing` — l'overlay récupère le jeton une seule fois.
 */

import { randomToken, sha256Hex } from './crypto';
import { SESSION_TTL_MS } from './cookies';
import type { AuthStore, PollPairingResult, UserRecord } from './store';

/** 10 min, comme `OAUTH_STATE_TTL_MS` — assez pour ouvrir le navigateur et confirmer. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/** Alphabet Crockford (sans I/O/U/0/1, ambigus à la lecture/saisie manuelle). */
const USER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.replace(/[01IOU]/g, '');
const USER_CODE_LENGTH = 8;

function randomUserCode(): string {
  const bytes = new Uint8Array(USER_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  return code;
}

export interface StartedPairing {
  userCode: string;
  deviceCode: string;
  expiresAt: Date;
}

export async function startPairing(store: AuthStore, now: Date): Promise<StartedPairing> {
  const deviceCode = randomToken();
  const userCode = randomUserCode();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  await store.createPairing({ deviceCode, userCode, expiresAt });
  return { userCode, deviceCode, expiresAt };
}

export interface ClaimedPairing {
  token: string;
}

/** `null` si le code est inconnu, expiré, ou déjà réclamé — à traduire en 404 par la route. */
export async function claimPairing(
  store: AuthStore,
  params: { userCode: string; user: UserRecord; now: Date },
): Promise<ClaimedPairing | null> {
  const token = randomToken();
  const idHash = await sha256Hex(token);
  // La session est créée AVANT l'association : si `claimPairing` échoue (code déjà réclamé
  // entre-temps par une requête concurrente, cas rare mais possible), cette session orpheline
  // reste simplement inutilisée — inoffensif, jamais renvoyée à personne.
  await store.createSession({
    idHash,
    userId: params.user.id,
    issuedAt: params.now,
    expiresAt: new Date(params.now.getTime() + SESSION_TTL_MS),
    lastUsedAt: params.now,
    userAgent: 'native-overlay',
    revokedAt: null,
  });
  const claimed = await store.claimPairing(params.userCode, token, params.now);
  if (!claimed) return null;
  return { token };
}

export function pollPairing(
  store: AuthStore,
  deviceCode: string,
  now: Date,
): Promise<PollPairingResult> {
  return store.pollPairing(deviceCode, now);
}
