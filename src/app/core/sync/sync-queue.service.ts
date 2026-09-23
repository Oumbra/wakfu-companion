import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { PersistenceService } from '../services/persistence.service';
import { computeClientKey } from './client-key.util';
import { HISTORY_ENDPOINTS, type HistoryEvent, type HistoryEventKind } from './history-event.model';

/** Taille d'un envoi, à garder ≤ `MAX_HISTORY_BATCH` côté serveur (`server/history/parse.ts`). */
const SYNC_BATCH_SIZE = 50;
/**
 * Budget en OCTETS (UTF-8) du corps d'un envoi, par type — marge d'environ 12 % sous le
 * `MAX_PAYLOAD_BYTES` de chaque endpoint (`functions/api/v1/history/*.ts` : 1 Mio pour combats,
 * échanges et pactes, 512 Kio pour les achats). Le nombre seul ne suffit pas : un combat de brèche
 * (plus de 70 participants avec leur ventilation par sort) pèse ~40 Ko, un lot de 50 peut donc
 * dépasser la limite → 413 → lot entier refusé à chaque tentative puis abandonné (combats perdus).
 */
const SYNC_BATCH_MAX_BYTES: Record<HistoryEventKind, number> = {
  fight: 900 * 1024,
  trade: 900 * 1024,
  pact: 900 * 1024,
  purchase: 450 * 1024,
};
/** Enveloppe `{"entries":[]}` autour des entrées d'un lot (voir `takeBatch`). */
const BODY_ENVELOPE_BYTES = '{"entries":[]}'.length;
const utf8 = new TextEncoder();
/** Délai de regroupement : l'ingestion d'un gros fichier de log produit des centaines d'événements d'affilée, un seul envoi doit suffire. */
const FLUSH_DEBOUNCE_MS = 2_000;
/** Attente avant réessai après un échec réseau, doublée à chaque tentative (bornée). */
const RETRY_BASE_DELAY_MS = 15_000;
const RETRY_MAX_DELAY_MS = 5 * 60_000;
/**
 * Abandon d'une entrée après trop d'échecs. Uniquement pour se protéger d'une
 * entrée définitivement indigeste (bug de format côté client) qui bloquerait la
 * file pour toujours : les échecs purement réseau, eux, ne comptent pas (voir
 * `send`).
 */
const MAX_ATTEMPTS = 10;
/** Code d'erreur du 403 renvoyé quand le compte a atteint son quota d'historique (250 000 combats,
 * voir server/history) — refus définitif tant que l'utilisateur n'a rien supprimé. */
const HISTORY_QUOTA_EXCEEDED = 'history_quota_exceeded';

export type SyncQueueState = 'idle' | 'pending' | 'syncing' | 'error';

/** Une entrée prête à partir : sa forme sur le fil, sa clé et son poids en octets. */
interface WireEntry {
  entry: HistoryEvent;
  clientKey: string;
  body: Record<string, unknown>;
  bytes: number;
}

/** Réponse d'un `POST /history/*`. `rejected` (optionnel, serveurs récents) : entrées du lot
 * refusées individuellement (invalides) alors que les autres ont été acceptées. */
interface HistoryPostResponse {
  accepted?: string[];
  inserted?: number;
  rejected?: unknown;
}

/** Issue d'un envoi : `true` (lot traité), `'tooLarge'` (413 : à rediviser) ou un échec gardant
 * les entrées en file (avec l'éventuel `Retry-After`). */
type SendOutcome = true | 'tooLarge' | { retryAfterMs?: number };

/**
 * File d'envoi persistante des historiques (lot 8, prompt 8.1 point 3).
 *
 * Trois propriétés, dans cet ordre d'importance :
 *
 * 1. **Jamais bloquante pour l'interface.** `enqueue()` ne fait qu'ajouter en
 *    mémoire ; la persistance IndexedDB, le hachage SHA-256 des clés et l'envoi
 *    réseau arrivent après coup, groupés. Rien de tout cela n'est attendu par le
 *    chemin de parsing du log.
 * 2. **Survit à tout.** La file vit en IndexedDB : coupure réseau, fermeture
 *    d'onglet, rechargement, redémarrage du navigateur — au retour, ce qui
 *    n'était pas parti repart (voir `activate()` et l'écoute de l'événement
 *    `online`).
 * 3. **Idempotente de bout en bout.** Chaque entrée porte un identifiant dérivé
 *    de son contenu : la remettre en file l'écrase au lieu de la dupliquer, et
 *    côté serveur `UNIQUE (user_id, client_key)` fait le reste. Un envoi dont
 *    la réponse s'est perdue peut donc être rejoué sans conséquence.
 *
 * La file n'est active qu'en mode connecté (`activate(uid)` par `AuthService`).
 * En mode invité rien n'est mis en file : c'est la définition même de ce mode —
 * aucune donnée ne quitte l'appareil.
 *
 * **Cloisonnée par compte.** Le magasin IndexedDB est unique pour le navigateur,
 * mais chaque entrée porte l'`uid` du compte auquel elle est destinée :
 * `activate(uid)` ne recharge que celles de ce compte et efface les autres du
 * disque. Sans cela, un lot laissé en attente par A (déconnexion pendant le
 * délai de regroupement, coupure réseau) repartait sous le compte de B à sa
 * connexion suivante sur le même navigateur — re-signé avec l'`uid` de B, donc
 * accepté par le serveur comme un historique légitime de B (écart 4.1 de
 * `docs/analyse-rgpd.md`). Une déconnexion volontaire laisse la file sur le
 * disque (elle repart à la reconnexion du MÊME compte) ; une suppression de
 * compte la purge (`purge()`), sinon une reconnexion réenverrait l'historique
 * que l'utilisateur vient de faire effacer.
 */
@Injectable({ providedIn: 'root' })
export class SyncQueueService {
  private readonly api = inject(ApiClientService);
  private readonly persistence = inject(PersistenceService);

  private readonly _state = signal<SyncQueueState>('idle');
  private readonly _pendingCount = signal(0);
  private readonly _lastSyncedAt = signal<Date | null>(null);
  private readonly _quotaExceeded = signal(false);

  readonly state = this._state.asReadonly();
  readonly pendingCount = this._pendingCount.asReadonly();
  readonly lastSyncedAt = this._lastSyncedAt.asReadonly();
  /**
   * Vrai quand le serveur a refusé l'historique pour quota atteint (403
   * `history_quota_exceeded`). La file cesse alors d'envoyer — aucun réessai automatique, ni au
   * retour du réseau, ni à chaque nouvel événement — mais GARDE ses éléments (rien n'est compté
   * comme tentative ni supprimé). Seul un envoi manuel (`flush({ manual: true })`, bouton
   * « Synchroniser maintenant ») ou une nouvelle activation retente une fois.
   */
  readonly quotaExceeded = this._quotaExceeded.asReadonly();

  /** Identifiant du compte connecté, `null` en mode invité (file inactive). */
  private uid: string | null = null;
  /** Contenu de la file, indexé par `HistoryEvent.id` — miroir mémoire d'IndexedDB. */
  private readonly entries = new Map<string, HistoryEvent>();
  /** Entrées ajoutées depuis la dernière écriture IndexedDB. */
  private readonly unpersisted = new Map<string, HistoryEvent>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  /**
   * Heure (horloge murale) avant laquelle aucun envoi ne doit partir : posée par un `Retry-After`
   * (limite de débit HTTP 429 sur `POST /api/v1/history/*`, ou 503). Respectée par TOUS les
   * déclencheurs de `flush()` (retour réseau, bouton « Synchroniser maintenant », nouvel
   * événement...) — sinon ils contourneraient le délai demandé par le serveur. Les entrées restent
   * en file pendant ce temps (un 429 n'est jamais compté comme un refus de la charge utile).
   */
  private notBeforeMs = 0;
  private inFlight: Promise<void> | null = null;
  private onlineListener: (() => void) | null = null;

  /**
   * Passe en mode connecté : recharge la file laissée par une session
   * précédente et tente de la vider. Idempotent — `AuthService` peut l'appeler
   * à chaque démarrage.
   */
  async activate(uid: string): Promise<void> {
    if (this.uid === uid) {
      void this.flush();
      return;
    }
    this.uid = uid;

    if (this.onlineListener === null && typeof window !== 'undefined') {
      // Rejeu au retour du réseau (prompt 8.1 point 3) : le navigateur nous
      // prévient, inutile de sonder.
      this.onlineListener = () => void this.flush();
      window.addEventListener('online', this.onlineListener);
      // Dernière chance d'écrire sur le disque ce qui n'est encore qu'en
      // mémoire — même raison que dans `UserDataService`. Sans ça, un onglet
      // fermé pendant le délai de regroupement attendrait la prochaine lecture
      // du fichier de log pour repartir.
      window.addEventListener('pagehide', () => void this.persistPending());
    }

    try {
      const stored = await this.persistence.getSyncQueue<HistoryEvent>();
      const foreign: string[] = [];
      for (const entry of stored) {
        // Une entrée d'un autre compte — ou d'avant l'ajout de `uid`, dont le
        // propriétaire est donc inconnu — ne doit JAMAIS partir sous ce compte.
        // L'effacer ne perd rien : l'historique local est intact et sera remis
        // en file par HistorySyncService à la prochaine lecture du fichier.
        if (entry.uid !== uid || isLegacyArchiveResend(entry)) foreign.push(entry.id);
        else if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry);
      }
      await this.persistence.deleteSyncQueueEntries(foreign);
    } catch {
      // Une file illisible (IndexedDB indisponible, navigation privée) ne doit
      // jamais empêcher l'application de fonctionner : on repart d'une file
      // vide, l'historique déjà en mémoire sera de toute façon remis en file
      // par HistorySyncService.
    }
    this._pendingCount.set(this.entries.size);
    await this.flush();
  }

  /**
   * Retour au mode invité : la file cesse d'être alimentée et vidée, mais son
   * contenu reste sur le disque — il ne repartira qu'à la reconnexion du même
   * compte (voir `activate`).
   */
  deactivate(): void {
    this.uid = null;
    this.notBeforeMs = 0;
    this.consecutiveFailures = 0;
    this._quotaExceeded.set(false);
    this.cancelTimers();
    this.entries.clear();
    this.unpersisted.clear();
    this._pendingCount.set(0);
    this._state.set('idle');
    this._lastSyncedAt.set(null);
  }

  /**
   * Suppression de compte : désactive la file ET efface du disque tout ce qui
   * était destiné à ce compte. Rien ne doit pouvoir repartir vers un compte que
   * l'utilisateur vient de faire effacer (droit à l'effacement, art. 17).
   */
  async purge(): Promise<void> {
    const uid = this.uid;
    const ids = new Set(this.entries.keys());
    this.deactivate();
    if (uid === null) return;
    try {
      // Le disque peut contenir des entrées de ce compte absentes de la mémoire
      // (file d'une session précédente jamais rechargée) : on le relit.
      for (const entry of await this.persistence.getSyncQueue<HistoryEvent>())
        if (entry.uid === uid) ids.add(entry.id);
      await this.persistence.deleteSyncQueueEntries([...ids]);
    } catch {
      // IndexedDB indisponible : il n'y avait alors rien de persisté à effacer.
    }
  }

  /** Vrai quand la file accepte des événements (mode connecté). */
  isActive(): boolean {
    return this.uid !== null;
  }

  /**
   * Met un événement en file. **Synchrone et sans effet de bord coûteux** :
   * appelé depuis le chemin d'ingestion du log, potentiellement des centaines de
   * fois d'affilée lors de la relecture initiale d'un gros fichier.
   */
  enqueue(event: Omit<HistoryEvent, 'uid' | 'queuedAt' | 'attempts'>): void {
    const uid = this.uid;
    if (uid === null) return;

    const existing = this.entries.get(event.id);
    if (existing) {
      // Même événement déjà en file. Le cas courant est un simple rejeu du même
      // fichier de log : la charge utile est identique, rien à faire — surtout
      // pas remettre `attempts` à zéro ni réécrire IndexedDB pour rien. Mais un
      // combat peut aussi revenir AVEC UN DÉTAIL CORRIGÉ (réattribution
      // manuelle) avant d'être parti : c'est alors la version corrigée qui doit
      // partir, pas celle qui attendait.
      if (JSON.stringify(existing.payload) === JSON.stringify(event.payload)) return;
      existing.payload = event.payload;
      this.unpersisted.set(existing.id, existing);
      this.scheduleFlush();
      return;
    }

    const entry: HistoryEvent = { ...event, uid, queuedAt: Date.now(), attempts: 0 };
    this.entries.set(entry.id, entry);
    this.unpersisted.set(entry.id, entry);
    this._pendingCount.set(this.entries.size);
    this._state.set('pending');
    this.scheduleFlush();
  }

  /**
   * Envoie tout ce qui est en file, par lots. Sérialisé : deux envois concurrents se marcheraient
   * dessus. `manual` (action explicite de l'utilisateur) lève le blocage de `quotaExceeded` pour
   * une tentative.
   */
  async flush(options?: { manual?: boolean }): Promise<void> {
    this.cancelTimers();
    if (this.uid === null) return;
    if (options?.manual) this._quotaExceeded.set(false);
    const previous = this.inFlight ?? Promise.resolve();
    this.inFlight = previous.then(() => this.drain());
    await this.inFlight;
  }

  private async drain(): Promise<void> {
    const uid = this.uid;
    if (uid === null) return;

    await this.persistPending();
    if (this.entries.size === 0) {
      this._state.set('idle');
      return;
    }
    if (this._quotaExceeded()) {
      // Quota atteint : on garde tout en file, sans rien envoyer ni reprogrammer.
      this._state.set('error');
      return;
    }

    const waitMs = this.notBeforeMs - Date.now();
    if (waitMs > 0) {
      this._state.set('error');
      this.scheduleRetry(waitMs);
      return;
    }

    this._state.set('syncing');
    let failed = false;
    let retryAfterMs: number | undefined;

    // Un type d'événement par requête : les endpoints sont distincts
    // (`/history/fights`, `/purchases`, `/trades`, `/pacts`).
    for (const kind of Object.keys(HISTORY_ENDPOINTS) as HistoryEventKind[]) {
      let work = [...this.entries.values()].filter((entry) => entry.kind === kind);
      while (work.length > 0) {
        const next = await this.takeBatch(uid, kind, work);
        work = next.rest;
        for (const wire of next.oversized) {
          // Un seul événement dépasse déjà la limite du serveur : aucun découpage ne le fera
          // passer. L'écarter (définitivement) plutôt que de bloquer la file derrière lui —
          // l'historique local, lui, reste intact.
          console.warn(
            `[sync] ${kind} trop volumineux pour être synchronisé (${wire.bytes} octets), écarté`,
            wire.clientKey,
          );
        }
        await this.forget(next.oversized.map((wire) => wire.entry.id));
        if (next.batch.length === 0) continue;
        const sent = await this.sendSplitting(kind, next.batch);
        if (sent !== true) {
          failed = true;
          retryAfterMs = sent.retryAfterMs;
          // Inutile d'insister sur les lots suivants : la cause (réseau, 5xx)
          // vaudra pour eux aussi. On réessaiera tout au prochain déclenchement.
          break;
        }
      }
      if (failed) break;
    }

    if (failed) {
      this.consecutiveFailures += 1;
      this._state.set('error');
      if (this._quotaExceeded()) return; // pas de réessai automatique, voir `quotaExceeded`
      if (retryAfterMs !== undefined) this.notBeforeMs = Date.now() + retryAfterMs;
      this.scheduleRetry(retryAfterMs);
      return;
    }

    this.consecutiveFailures = 0;
    this._lastSyncedAt.set(new Date());
    this._state.set(this.entries.size > 0 ? 'pending' : 'idle');
  }

  /**
   * Prochain lot à envoyer depuis `work` (ordre de mise en file conservé), borné à la fois en nombre
   * (`SYNC_BATCH_SIZE`) et en octets (`SYNC_BATCH_MAX_BYTES`). Une entrée qui dépasse à elle seule
   * le budget part dans `oversized` ; une entrée dont le `clientKey` figure déjà dans le lot est
   * reportée au lot suivant (deux lignes de même clé dans un seul `INSERT ... ON CONFLICT DO UPDATE`
   * font échouer toute la requête côté Postgres — cas d'un même combat remis en file depuis la
   * session ET depuis l'archive, voir `HistoryEvent.clientKey`) : envoyées l'une après l'autre, la
   * plus récente s'applique en dernier. Chaque entrée n'est sérialisée qu'au moment d'être examinée,
   * jamais toute la file d'un coup.
   */
  private async takeBatch(
    uid: string,
    kind: HistoryEventKind,
    work: readonly HistoryEvent[],
  ): Promise<{ batch: WireEntry[]; oversized: WireEntry[]; rest: HistoryEvent[] }> {
    const budget = SYNC_BATCH_MAX_BYTES[kind];
    const batch: WireEntry[] = [];
    const oversized: WireEntry[] = [];
    const deferred: HistoryEvent[] = [];
    const keys = new Set<string>();
    let bytes = BODY_ENVELOPE_BYTES;
    let index = 0;
    for (; index < work.length && batch.length < SYNC_BATCH_SIZE; index++) {
      const entry = work[index];
      // Retirée entre-temps (autre lot, purge) : rien à envoyer.
      if (!this.entries.has(entry.id)) continue;
      const wire = await this.toWire(uid, entry);
      if (BODY_ENVELOPE_BYTES + wire.bytes > budget) {
        oversized.push(wire);
        continue;
      }
      if (keys.has(wire.clientKey)) {
        deferred.push(entry);
        continue;
      }
      const added = wire.bytes + (batch.length > 0 ? 1 : 0); // virgule de séparation
      if (bytes + added > budget) break; // cette entrée ouvrira le lot suivant
      batch.push(wire);
      keys.add(wire.clientKey);
      bytes += added;
    }
    return { batch, oversized, rest: [...deferred, ...work.slice(index)] };
  }

  /** Forme d'une entrée sur le fil (voir `send`) et son poids exact en octets UTF-8. */
  private async toWire(uid: string, entry: HistoryEvent): Promise<WireEntry> {
    const payload: Record<string, unknown> = { ...entry.payload };
    // `dungeonRunSignature` (kind 'fight' uniquement, voir FightPayload) n'est qu'une signature
    // de contenu à ce stade — jamais envoyée telle quelle : hachée ici exactement comme
    // `clientKey` (même fonction, même formule), pour que tous les combats d'un run de donjon
    // finissent par partager le `clientKey` de leur boss comme `dungeonRunKey`, sans aller-retour
    // serveur. `null`/absente : le combat n'est pas (encore) rattaché à un run.
    const dungeonRunSignature = payload['dungeonRunSignature'] as string | null | undefined;
    if (dungeonRunSignature !== undefined) {
      delete payload['dungeonRunSignature'];
      payload['dungeonRunKey'] =
        dungeonRunSignature !== null
          ? await computeClientKey(uid, entry.kind, dungeonRunSignature)
          : null;
    }
    // `entry.clientKey` : clé déjà connue du compte (renvoi depuis l'archive), prioritaire sur
    // une signature qui ne permettrait plus de la retrouver (voir `HistoryEvent.clientKey`).
    const clientKey =
      typeof entry.clientKey === 'string' && entry.clientKey.length > 0
        ? entry.clientKey
        : await computeClientKey(uid, entry.kind, entry.signature);
    const body = { clientKey, ...payload };
    return { entry, clientKey, body, bytes: utf8.encode(JSON.stringify(body)).length };
  }

  /**
   * Envoie un lot ; sur 413 (corps trop gros malgré le budget — limite serveur abaissée,
   * estimation dépassée), le redivise en deux au lieu de compter une tentative, jusqu'à l'entrée
   * seule, alors écartée définitivement (même raison que `oversized` dans `drain`).
   */
  private async sendSplitting(
    kind: HistoryEventKind,
    batch: WireEntry[],
  ): Promise<true | { retryAfterMs?: number }> {
    const outcome = await this.send(kind, batch);
    if (outcome !== 'tooLarge') return outcome;
    if (batch.length === 1) {
      console.warn(
        `[sync] ${kind} refusé par le serveur car trop volumineux (413), écarté`,
        batch[0].clientKey,
      );
      await this.forget([batch[0].entry.id]);
      return true;
    }
    const middle = Math.ceil(batch.length / 2);
    const first = await this.sendSplitting(kind, batch.slice(0, middle));
    if (first !== true) return first;
    return this.sendSplitting(kind, batch.slice(middle));
  }

  /**
   * Envoie un lot. Renvoie `true` en cas de succès, `'tooLarge'` sur 413, sinon un échec portant
   * l'éventuel délai `Retry-After` du serveur (429 limite de débit, 503...) — les entrées restent
   * alors en file.
   */
  private async send(kind: HistoryEventKind, wires: WireEntry[]): Promise<SendOutcome> {
    const batch = wires.map((wire) => wire.entry);
    const result = await this.api.requestJson<HistoryPostResponse | undefined>(
      HISTORY_ENDPOINTS[kind],
      { method: 'POST', body: { entries: wires.map((wire) => wire.body) } },
    );

    if (result.ok) {
      // Entrées refusées individuellement (invalides) : définitives, retirées de la file comme les
      // acceptées — réessayer à l'identique ne changerait rien. Journalisées pour le diagnostic.
      // Une réponse sans `rejected` (serveur plus ancien) vaut acceptation du lot entier.
      for (const rejection of rejectedEntries(result.data?.rejected, wires)) {
        console.warn(
          `[sync] ${kind} refusé par le serveur, écarté : ${rejection.error}`,
          rejection.clientKey,
        );
      }
      await this.forget(batch.map((entry) => entry.id));
      return true;
    }

    const status = result.error.kind === 'http' ? result.error.status : undefined;
    const failure = { retryAfterMs: result.error.retryAfterMs };
    if (status === 413) return 'tooLarge';
    if (status === 403 && result.error.code === HISTORY_QUOTA_EXCEEDED) {
      // Refus définitif mais légitime : ni tentative comptée, ni suppression (voir `quotaExceeded`).
      this._quotaExceeded.set(true);
      return failure;
    }
    // 4xx (hors 401/429) : le serveur a refusé la charge utile elle-même,
    // réessayer à l'identique ne changera rien. On compte les tentatives et on
    // finit par abandonner ces entrées plutôt que de bloquer la file derrière
    // elles — l'historique local, lui, reste intact.
    const permanent = status !== undefined && status >= 400 && status < 500 && status !== 429;
    if (permanent) {
      const exhausted: string[] = [];
      for (const entry of batch) {
        entry.attempts += 1;
        if (entry.attempts >= MAX_ATTEMPTS) exhausted.push(entry.id);
      }
      await this.persistence.putSyncQueueEntries(batch).catch(() => undefined);
      await this.forget(exhausted);
      // Un 401 a déjà fait basculer l'application en mode invité (voir
      // ApiClientService) : la file est alors désactivée, rien à réessayer.
      return failure;
    }
    return failure;
  }

  private async forget(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    for (const id of ids) {
      this.entries.delete(id);
      this.unpersisted.delete(id);
    }
    this._pendingCount.set(this.entries.size);
    await this.persistence.deleteSyncQueueEntries(ids).catch(() => undefined);
  }

  private async persistPending(): Promise<void> {
    if (this.unpersisted.size === 0) return;
    const batch = [...this.unpersisted.values()];
    this.unpersisted.clear();
    // Une file non persistée n'est qu'une optimisation perdue (les événements
    // seront de toute façon reproduits à la prochaine lecture du log) : un échec
    // d'écriture ne doit pas interrompre l'envoi lui-même.
    await this.persistence.putSyncQueueEntries(batch).catch(() => undefined);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.retryTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Réessai à intervalle croissant : hors ligne, insister toutes les 2 s ne sert à rien. Un délai
   * imposé par le serveur (`Retry-After`) l'emporte s'il est plus long que ce backoff.
   */
  private scheduleRetry(minDelayMs = 0): void {
    if (this.retryTimer !== null) return;
    const backoff = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** Math.max(0, this.consecutiveFailures - 1),
      RETRY_MAX_DELAY_MS,
    );
    const delay = Math.max(backoff, minDelayMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private cancelTimers(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

/**
 * Lecture défensive du champ `rejected` d'une réponse `POST /history/*` (`[{ index, clientKey?,
 * error }]`) : chaque élément est rapporté à l'entrée du lot par `index` (position dans le lot
 * envoyé), sinon par `clientKey`. Tout élément inexploitable est ignoré — jamais d'exception sur
 * une réponse inattendue.
 */
function rejectedEntries(
  raw: unknown,
  wires: readonly WireEntry[],
): { clientKey: string; error: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { clientKey: string; error: string }[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { index, clientKey, error } = item as Record<string, unknown>;
    const wire =
      typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < wires.length
        ? wires[index]
        : wires.find((w) => typeof clientKey === 'string' && w.clientKey === clientKey);
    if (!wire) continue;
    out.push({ clientKey: wire.clientKey, error: typeof error === 'string' ? error : 'invalide' });
  }
  return out;
}

/**
 * Renvoi de correction depuis l'archive mis en file par une version antérieure au correctif du
 * 2026-09-23 : signature calculée avec l'identifiant d'affichage NÉGATIF du combat archivé
 * (`archiveId`) au lieu de son `clientKey` d'origine — l'envoyer créerait un combat en double côté
 * compte. Écarté au rechargement de la file ; la correction elle-même reste dans le journal local
 * des réattributions (affichage intact) et, si elle couvre toute la ligne de butin, repartira sous
 * la bonne clé au prochain chargement de l'archive (voir `toFightRecord`). Un vrai `fightId` de log est toujours positif (voir `fightSignature`).
 */
function isLegacyArchiveResend(entry: HistoryEvent): boolean {
  return (
    entry.kind === 'fight' &&
    entry.clientKey === undefined &&
    typeof entry.signature === 'string' &&
    /^-\d+$/.test(entry.signature.split('|')[1] ?? '')
  );
}
