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
import {
  SESSION_MAX_LIFETIME_MS,
  runRetentionPurges,
  sessionAbsoluteExpiry,
  sessionChainId,
} from './flow';
import type {
  AuthStore,
  PairingRecord,
  PollPairingResult,
  SessionRecord,
  UserRecord,
} from './store';

/**
 * 5 min (10 avant l'audit de sécurité du 2026-09-23) : assez pour ouvrir le navigateur et
 * confirmer, et deux fois moins de temps pour qu'un code d'appairage transmis par un tiers
 * (hameçonnage « confirmez ce code ») soit encore exploitable.
 */
export const PAIRING_TTL_MS = 5 * 60 * 1000;

/** Libellé `user_agent` des sessions natives — c'est aussi ce qui les distingue d'une session de
 * navigateur quand le jeton n'est pas présenté en porteur (voir `isNativeSession`). */
export const NATIVE_SESSION_USER_AGENT = 'native-overlay';

/** Vrai pour une session émise par appairage natif (ou rotation d'une telle session). */
export function isNativeSession(session: SessionRecord): boolean {
  return session.userAgent === NATIVE_SESSION_USER_AGENT;
}

/** Longueur maximale conservée du user-agent de l'appareil demandeur. */
export const MAX_REQUESTER_USER_AGENT_LENGTH = 200;

/** `pollToken` (= `deviceCode`) : `randomToken()` de 32 octets, soit 43 caractères base64url. */
const POLL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedPollToken(value: string): boolean {
  return POLL_TOKEN_PATTERN.test(value);
}

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
const USER_CODE_PATTERN = new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`);

/** Normalise un code saisi/transmis (casse) et le rejette s'il ne peut pas avoir été émis ici. */
export function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return USER_CODE_PATTERN.test(code) ? code : null;
}

/** Métadonnées de l'appareil demandeur, telles que vues par Cloudflare — jamais l'IP. */
export interface PairingRequester {
  country: string | null;
  userAgent: string | null;
}

/** Extrait les métadonnées affichables d'une requête `POST /native/pair`. */
export function pairingRequesterFromRequest(request: Request): PairingRequester {
  const country = (request.headers.get('cf-ipcountry') ?? '').trim().toUpperCase();
  const userAgent = (request.headers.get('user-agent') ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_REQUESTER_USER_AGENT_LENGTH);
  return {
    // `XX` (inconnu) et `T1` (Tor) sont renvoyés tels quels : ce sont des informations utiles.
    country: /^[A-Z0-9]{2}$/.test(country) ? country : null,
    userAgent: userAgent || null,
  };
}

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

export async function startPairing(
  store: AuthStore,
  now: Date,
  requester: PairingRequester = { country: null, userAgent: null },
): Promise<StartedPairing> {
  const deviceCode = randomToken();
  const userCode = randomUserCode();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  await store.createPairing({
    deviceCode,
    userCode,
    expiresAt,
    createdAt: now,
    requesterCountry: requester.country,
    requesterUserAgent: requester.userAgent,
  });
  return { userCode, deviceCode, expiresAt };
}

/** Ce que la page `/pair` peut montrer d'une demande en attente — jamais le `deviceCode`. */
export interface PendingPairingInfo {
  pairingCode: string;
  requestedAt: Date;
  ageSeconds: number;
  expiresAt: Date;
  expiresInSeconds: number;
  country: string | null;
  userAgent: string | null;
}

export function describePendingPairing(record: PairingRecord, now: Date): PendingPairingInfo {
  return {
    pairingCode: record.userCode,
    requestedAt: record.createdAt,
    ageSeconds: Math.max(0, Math.floor((now.getTime() - record.createdAt.getTime()) / 1000)),
    expiresAt: record.expiresAt,
    expiresInSeconds: Math.max(0, Math.floor((record.expiresAt.getTime() - now.getTime()) / 1000)),
    country: record.requesterCountry,
    userAgent: record.requesterUserAgent,
  };
}

/** Demande en attente pour ce code, ou `null` (inconnue, expirée, déjà confirmée). */
export async function findPendingPairingInfo(
  store: AuthStore,
  userCode: string,
  now: Date,
): Promise<PendingPairingInfo | null> {
  const record = await store.findPendingPairing(userCode, now);
  return record ? describePendingPairing(record, now) : null;
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
  const absoluteExpiresAt = new Date(params.now.getTime() + SESSION_MAX_LIFETIME_MS);
  // La session est créée AVANT l'association (le jeton ne doit jamais être remis par `/poll` sans
  // que sa session existe). Si l'association échoue — code inconnu, expiré, ou réclamé entre-temps
  // par une requête concurrente — ou lève, la session est EFFACÉE : avant l'audit du 2026-09-23
  // elle restait active 30 jours, rattachée au compte, jamais remise à personne mais listée dans
  // « Mon compte ».
  await store.createSession({
    idHash,
    userId: params.user.id,
    issuedAt: params.now,
    expiresAt: new Date(params.now.getTime() + SESSION_TTL_MS),
    lastUsedAt: params.now,
    userAgent: NATIVE_SESSION_USER_AGENT,
    revokedAt: null,
    supersededAt: null,
    chainId: idHash,
    absoluteExpiresAt,
    graceRotatedAt: null,
  });
  let claimed = false;
  try {
    claimed = await store.claimPairing(params.userCode, token, params.now);
  } finally {
    if (!claimed) await store.deleteSession(idHash);
  }
  if (!claimed) return null;
  // Un appareil qui s'appaire est une bonne occasion de ménage (voir flow.ts).
  await runRetentionPurges(store, params.now);
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
 * Rotation depuis une session déjà remplacée (encore dans sa grâce) : admise
 * **une seule fois** (audit du 2026-09-23). C'est le cas d'un overlay qui a
 * planté entre la réponse et l'écriture du nouveau jeton au trousseau — au
 * redémarrage, il n'a que l'ancien ; le lui refuser le condamnerait à un
 * réappairage complet pour une fenêtre de quelques millisecondes. Ce
 * rattrapage révoque au passage les autres sessions vivantes de la chaîne (le
 * jeton émis par la rotation perdue : orphelin si c'est un plantage, entre les
 * mains d'un tiers si l'ancien jeton a été copié). Un SECOND rattrapage depuis
 * la même session n'a plus d'explication bénigne : toute la chaîne est
 * révoquée et la fonction rend `null` (la route répond 401, l'overlay doit se
 * réappairer). Session inconnue, révoquée ou expirée : jamais atteint, la
 * route a déjà répondu 401.
 *
 * L'échéance absolue (`SESSION_MAX_LIFETIME_MS`, flow.ts) et la chaîne sont
 * recopiées de l'ancienne session : une rotation renouvelle le jeton, pas le
 * droit de rester connecté. Le `userAgent` aussi : c'est le libellé que
 * « Mon compte » affiche, l'appareil n'a pas changé.
 */
export async function rotateNativeSession(
  store: AuthStore,
  params: { current: SessionRecord; now: Date },
): Promise<RotatedNativeSession | null> {
  const { current, now } = params;
  const chainId = sessionChainId(current);
  const absoluteExpiresAt = sessionAbsoluteExpiry(current);

  if (current.supersededAt !== null) {
    if (!(await store.markGraceRotation(current.idHash, now))) {
      await store.revokeSessionChain(chainId, now);
      return null;
    }
    await store.revokeSessionChain(chainId, now, current.idHash);
  }

  const token = randomToken();
  const idHash = await sha256Hex(token);
  const expiresAt = new Date(Math.min(now.getTime() + SESSION_TTL_MS, absoluteExpiresAt.getTime()));
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
    chainId,
    absoluteExpiresAt,
    graceRotatedAt: null,
  });
  const previousTokenValidUntil = new Date(
    Math.min(current.expiresAt.getTime(), now.getTime() + NATIVE_SESSION_ROTATION_GRACE_MS),
  );
  await store.supersedeSession(current.idHash, {
    supersededAt: current.supersededAt ?? now,
    expiresAt: previousTokenValidUntil,
  });
  await runRetentionPurges(store, now);
  return { token, issuedAt: now, expiresAt, previousTokenValidUntil };
}

export function pollPairing(
  store: AuthStore,
  deviceCode: string,
  now: Date,
): Promise<PollPairingResult> {
  return store.pollPairing(deviceCode, now);
}
