/**
 * Suivi ligne à ligne d'un `wakfu.log` **partagé par plusieurs clients Wakfu** (multi-compte).
 *
 * Constat (2026-10-04, fichier d'un utilisateur dont les compteurs de suivi ne bougeaient plus
 * pendant des combats en parallèle) : chaque client ouvre `wakfu.log` en écrasement, avec son
 * PROPRE pointeur d'écriture — le dernier client lancé tronque le fichier et réécrit depuis
 * l'octet 0, les autres continuent plus loin. Le fichier final juxtapose donc des blocs de
 * clients différents (horodatages qui reculent de plusieurs minutes, ligne coupée à chaque
 * jonction). En direct, seul le client « en tête » écrit au-delà de la taille déjà lue : les
 * autres réécrivent DERRIÈRE l'offset de lecture, et une lecture « depuis le dernier offset »
 * ne voit jamais leurs lignes — leur combat, leur butin et leurs ennemis vaincus n'arrivent
 * qu'au prochain rechargement complet, qui (à raison) n'incrémente pas le suivi.
 *
 * Principe : mémoriser chaque ligne complète déjà vue par (début, fin, empreinte). Une relecture
 * complète du fichier (`scanFull`) émet toute ligne absente de cette table à la même position —
 * qu'elle soit ajoutée en fin de fichier ou réécrite par un client en retard. La lecture rapide
 * de fin de fichier (`scanTail`) reste le chemin courant ; l'appelant intercale des relectures
 * complètes à cadence bornée. Mémoire : 20 octets par ligne, pas de copie du contenu.
 *
 * Miroir Rust : `crates/overlay-ingest/src/tailer.rs` (dépôt overlay) — tout changement de
 * sémantique se reporte dans les deux dépôts.
 */

const LF = 0x0a;
const CR = 0x0d;
const NUL = 0x00;

/** Début de ligne de journal (`INFO 15:34:15,233 ...`) : distingue une vraie ligne d'un fragment. */
const LOG_HEADER_PREFIX_RE =
  /^\s*(?:INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\s+\d{2}:\d{2}:\d{2},\d{3}\s/;

/** FNV-1a 32 bits sur `bytes[start, end)`. */
function fnv1a(bytes: Uint8Array, start: number, end: number): number {
  let hash = 0x811c9dc5;
  for (let i = start; i < end; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Table des lignes connues, triée par position de début (colonnes typées, croissance ×2). */
class LineTable {
  starts: Float64Array;
  ends: Float64Array;
  hashes: Uint32Array;
  count = 0;

  constructor(capacity = 0) {
    this.starts = new Float64Array(capacity);
    this.ends = new Float64Array(capacity);
    this.hashes = new Uint32Array(capacity);
  }

  push(start: number, end: number, hash: number): void {
    if (this.count === this.starts.length) {
      const capacity = Math.max(1024, this.count * 2);
      const starts = new Float64Array(capacity);
      const ends = new Float64Array(capacity);
      const hashes = new Uint32Array(capacity);
      starts.set(this.starts);
      ends.set(this.ends);
      hashes.set(this.hashes);
      this.starts = starts;
      this.ends = ends;
      this.hashes = hashes;
    }
    this.starts[this.count] = start;
    this.ends[this.count] = end;
    this.hashes[this.count] = hash;
    this.count++;
  }
}

/**
 * Appelle `visit(start, end)` pour chaque ligne complète (terminée par `\n`) de `bytes`, positions
 * relatives à `bytes`. `end` = position du `\n`. Une plage d'octets nuls (trou laissé par une
 * troncature qu'un autre client a prolongée en écrivant plus loin) sépare des lignes comme un
 * `\n` : la ligne commence après le dernier octet nul. Les lignes vides sont ignorées.
 */
function forEachLine(bytes: Uint8Array, visit: (start: number, end: number) => void): void {
  let pos = 0;
  for (;;) {
    const nl = bytes.indexOf(LF, pos);
    if (nl < 0) return;
    let start = pos;
    const lastNul = bytes.subarray(pos, nl).lastIndexOf(NUL);
    if (lastNul >= 0) start = pos + lastNul + 1;
    const contentEnd = nl > start && bytes[nl - 1] === CR ? nl - 1 : nl;
    if (contentEnd > start) visit(start, nl);
    pos = nl + 1;
  }
}

export class LogLineTracker {
  private known = new LineTable();
  private readonly decoder = new TextDecoder('utf-8');

  /** Position juste après la dernière ligne complète connue : une lecture de fin reprend ici. */
  get tailOffset(): number {
    const { count, ends } = this.known;
    return count > 0 ? ends[count - 1] + 1 : 0;
  }

  reset(): void {
    this.known = new LineTable();
  }

  /**
   * Relecture du fichier ENTIER (`bytes` = tout son contenu actuel) : renvoie, dans l'ordre du
   * fichier, chaque ligne complète absente de la table à cette position (nouvelle en fin de
   * fichier, ou réécrite par un client en retard), puis remplace la table.
   *
   * Un client en retard qui vient d'écrire s'arrête au milieu d'une ancienne ligne : le reste de
   * celle-ci forme une « ligne » neuve (fin de l'ancienne, sans en-tête) juste avant une ligne
   * inchangée. Ce fragment n'est pas émis — il serait parsé comme la suite multi-lignes de la ligne
   * précédente. Il est réévalué à la relecture suivante (le client l'aura recouvert entre-temps).
   */
  scanFull(bytes: Uint8Array): string[] {
    const old = this.known;
    const oldEnd = this.tailOffset;
    const next = new LineTable(Math.max(1024, old.count + 64));
    const fresh: number[] = [];
    let j = 0;
    forEachLine(bytes, (start, end) => {
      const hash = fnv1a(bytes, start, end);
      while (j < old.count && old.starts[j] < start) j++;
      const isKnown =
        j < old.count && old.starts[j] === start && old.ends[j] === end && old.hashes[j] === hash;
      if (!isKnown) fresh.push(next.count);
      next.push(start, end, hash);
    });
    this.known = next;

    const lines: string[] = [];
    for (let k = 0; k < fresh.length; k++) {
      const index = fresh[k];
      const text = this.decode(bytes, next.starts[index], next.ends[index]);
      const followedByKnownLine = index + 1 < next.count && fresh[k + 1] !== index + 1;
      const isFragment =
        followedByKnownLine && next.starts[index] < oldEnd && !LOG_HEADER_PREFIX_RE.test(text);
      if (!isFragment) lines.push(text);
    }
    return lines;
  }

  /**
   * Lecture rapide de fin de fichier : `bytes` = contenu à partir de `from`, qui doit valoir
   * `tailOffset - 1` (l'octet `\n` de la dernière ligne connue, relu pour vérifier qu'il n'a pas
   * été réécrit) ou 0 si aucune ligne n'est connue. Renvoie `null` si la jonction ne tient plus
   * (un autre client a réécrit autour) : l'appelant doit alors faire une relecture complète.
   */
  scanTail(bytes: Uint8Array, from: number): string[] | null {
    const tail = this.tailOffset;
    let offset = 0;
    if (tail > 0) {
      if (from !== tail - 1 || (bytes.length > 0 && bytes[0] !== LF)) return null;
      offset = 1;
    } else if (from !== 0) {
      return null;
    }
    const view = bytes.subarray(offset);
    const base = from + offset;
    const lines: string[] = [];
    forEachLine(view, (start, end) => {
      this.known.push(base + start, base + end, fnv1a(view, start, end));
      lines.push(this.decode(view, start, end));
    });
    return lines;
  }

  private decode(bytes: Uint8Array, start: number, end: number): string {
    const contentEnd = end > start && bytes[end - 1] === CR ? end - 1 : end;
    return this.decoder.decode(bytes.subarray(start, contentEnd)).replace(/\0/g, '');
  }
}
