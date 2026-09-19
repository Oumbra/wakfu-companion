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
 *
 * Puis, pendant la vie de la session : `rotateNativeSession` — l'overlay
 * échange son jeton contre un neuf (voir la doc de la fonction).
 */

import { randomToken, sha256Hex } from './crypto';
import { SESSION_TTL_MS } from './cookies';
import { purgeDeadSessions } from './flow';
import type { AuthStore, PollPairingResult, SessionRecord, UserRecord } from './store';

/** 10 min, comme `OAUTH_STATE_TTL_MS` — assez pour ouvrir le navigateur et confirmer. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/**
 * Grâce laissée à l'ancien jeton après une rotation. L'overlay a plusieurs
 * fils qui parlent au serveur en même temps (file d'envoi, icônes, compteurs) :
 * couper l'ancien jeton à l'instant où le nouveau est émis ferait 401 sur les
 * requêtes déjà parties, et un 401 côté overlay signifie « jeton refusé », donc
 * déconnexion ET purge locale — pour une simple course. Cinq minutes couvrent
 * largement le temps de persister le nouveau jeton et de drainer l'ancien.
 */
export const NATIVE_SESSION_ROTATION_GRACE_MS = 5 * 60 * 1000;

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
    supersededAt: null,
  });
  const claimed = await store.claimPairing(params.userCode, token, params.now);
  if (!claimed) return null;
  // Un appareil qui s'appaire est une bonne occasion de ménage (voir flow.ts).
  await purgeDeadSessions(store, params.now);
  return { token };
}

export interface RotatedNativeSession {
  /** Nouveau jeton porteur, à persister AVANT d'abandonner l'ancien. */
  token: string;
  issuedAt: Date;
  expiresAt: Date;
  /** Jusqu'à quand l'ancien jeton reste accepté (fin de grâce). */
  previousTokenValidUntil: Date;
}

/**
 * Rotation du jeton natif (constat C5 de `docs/analyse-rgpd.md` du dépôt
 * `wakfu-companion-overlay`, « reste ouvert : la rotation ») : l'overlay
 * présente son jeton courant et en reçoit un neuf, valable 30 jours
 * glissants comme le premier. Un jeton de longue durée qui ne change jamais
 * est une cible qui ne bouge pas ; borner la fenêtre d'utilité d'une copie
 * (fichier de repli lu par un autre programme, sauvegarde du trousseau) sans
 * demander à l'utilisateur de se réappairer, c'est exactement ce que fait une
 * rotation périodique — c'est l'overlay qui choisit le rythme.
 *
 * L'ancienne session n'est ni révoquée ni effacée sur-le-champ : elle est
 * **remplacée** (`supersededAt`) et son expiration ramenée à la fin de grâce
 * (`NATIVE_SESSION_ROTATION_GRACE_MS`). Pendant la grâce, elle est acceptée
 * mais plus jamais prolongée (`resolveSession`), n'apparaît plus dans
 * « Mon compte » (la nouvelle la représente, même appareil), et reste
 * révocable par « déconnecter tous mes appareils ». Passée la grâce, elle
 * expire comme n'importe quelle session et sera effacée par le ménage.
 *
 * Rotation depuis une session déjà remplacée (encore dans sa grâce) : admise.
 * C'est le cas d'un overlay qui a planté entre la réponse et l'écriture du
 * nouveau jeton au trousseau — au redémarrage, il n'a que l'ancien ; le lui
 * refuser le condamnerait à un réappairage complet pour une fenêtre de
 * quelques millisecondes. La session neuve devenue orpheline expire d'elle-
 * même. Le cas contraire (session inconnue, révoquée, expirée) rend `null` :
 * l'appelant répond 401, comme pour tout jeton refusé.
 *
 * Le `userAgent` est recopié de l'ancienne session : c'est le libellé que
 * « Mon compte » affiche, l'appareil n'a pas changé.
 */
export async function rotateNativeSession(
  store: AuthStore,
  params: { current: SessionRecord; now: Date },
): Promise<RotatedNativeSession> {
  const { current, now } = params;
  const token = randomToken();
  const idHash = await sha256Hex(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  // La nouvelle session d'abord, l'ancienne ensuite : si la seconde écriture
  // échoue, l'ancienne reste simplement entière — jamais un utilisateur sans
  // aucun jeton valide.
  await store.createSession({
    idHash,
    userId: current.userId,
    issuedAt: now,
    expiresAt,
    lastUsedAt: now,
    userAgent: current.userAgent,
    revokedAt: null,
    supersededAt: null,
  });
  const previousTokenValidUntil = new Date(
    Math.min(current.expiresAt.getTime(), now.getTime() + NATIVE_SESSION_ROTATION_GRACE_MS),
  );
  await store.supersedeSession(current.idHash, {
    supersededAt: current.supersededAt ?? now,
    expiresAt: previousTokenValidUntil,
  });
  await purgeDeadSessions(store, now);
  return { token, issuedAt: now, expiresAt, previousTokenValidUntil };
}

export function pollPairing(
  store: AuthStore,
  deviceCode: string,
  now: Date,
): Promise<PollPairingResult> {
  return store.pollPairing(deviceCode, now);
}
