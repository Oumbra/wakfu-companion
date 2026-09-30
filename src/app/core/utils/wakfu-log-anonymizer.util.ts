import { CLASS_NAMES } from '../data/class-names.data';
import { WAKFU_CLASS_BREED_IDS } from '../data/wakfu-class-breed-ids.data';

/**
 * Anonymisation d'un `wakfu.log` avant envoi pour un rapport de bug (modale « Signaler un bug » du
 * profil, voir `BugReportModalComponent`). Entièrement local : le fichier ne quitte jamais le
 * navigateur, seul le résultat est proposé au téléchargement.
 *
 * Même schéma de pseudonymisation que les fixtures du dépôt (voir l'en-tête de
 * `tools/check-fixtures.mjs`, qui vérifie ce schéma) — un journal anonymisé ici passe donc ce
 * vérificateur et peut devenir une fixture de test telle quelle :
 *   - jeton de session (et tout UUID)      → 00000000-0000-0000-0000-000000000000
 *   - dossier utilisateur (Windows, macOS, Linux) → anonymous
 *   - IP privée / IP locale d'une socket   → 192.0.2.N (plage de documentation, RFC 5737)
 *   - joueur vu en combat (breed connu)    → Anonyme-<Classe><N>, id 9000000N
 *   - autre joueur (chat, échange, amis)   → Anonyme-Joueur<N>, id 90001NNN
 *   - compte Ankama (x#NNNN)               → anonymeNN#NNNN
 *   - message de chat public               → lorem ipsum de même longueur (en mots)
 *   - adresse e-mail                       → anonymous@example.com
 * Les messages privés sont SUPPRIMÉS (ligne entière), pas seulement pseudonymisés : leur contenu
 * n'est d'aucune utilité pour un bug et c'est la donnée la plus sensible du fichier.
 *
 * Deux passes : la première recense les noms/identifiants (un même joueur doit recevoir le même
 * pseudonyme partout — ligne de combat, dégâts, XP, échange, chat), la seconde réécrit chaque ligne.
 * Les pseudonymes sont attribués dans l'ordre de première apparition : même journal ⇒ même résultat.
 */

export interface WakfuLogAnonymizationResult {
  readonly text: string;
  /** Joueurs pseudonymisés (combattants humains + auteurs de chat, partenaires d'échange, amis). */
  readonly playerCount: number;
  /** Lignes de messages privés supprimées. */
  readonly privateMessagesRemoved: number;
}

/** Enveloppe technique du client Java : « LEVEL HH:MM:SS,mmm [thread] (classe:ligne) - contenu ». */
const HEADER_RE =
  /^(\s*(?:INFO|WARN|ERROR|DEBUG|TRACE)\s+\S+\s+\[[^\]]*\]\s+\([^)]*\)\s+-\s+)(.*)$/s;
/** Canaux privés, toutes langues du client (Privé, Private, Privado, Privat…). */
const PRIVATE_CHANNEL_RE = /^\[(?:Priv[ée]|Private|Privad[oa]|Privat|Whisper|Chuchot)[^\]]*\]/i;
/** Canaux publics (même liste que `tools/check-fixtures.mjs`) : auteur pseudonymisé, contenu remplacé. */
const PUBLIC_CHAT_RE =
  /^(\[(?:Proximité|Guilde|Commerce|Groupe|Équipe|Recrutement[^\]]*|Communauté[^\]]*|Politique|Vicinity|Guild|Group|Team|Recruitment[^\]]*|Community[^\]]*)\] )(.+?)( : )(.*)$/s;
const FIGHTER_JOIN_RE =
  /^\[_FL_\] fightId=-?\d+ (.+?) breed : (\d+) \[(-?\d+)\] isControlledByAI=false /;
const TRADE_BETWEEN_RE = / between (.+?) \(id=(-?\d+)\) and (.+?) \(id=(-?\d+)\)/;
const TRADE_PLAYER_RE = /^\[Trade\] [Ll]e joueur (\S+) /;
const FOLLOW_RE = /^\[Information \(jeu\)\] Vous (?:suivez désormais|ne suivez plus) (.+?)\.\s*$/;
const ACCOUNT_WITH_NAME_RE = /(\S+) \(([A-Za-z0-9_.-]+#\d{4})\)/g;
const ACCOUNT_RE = /\(([A-Za-z0-9_.-]+#\d{4})\)/g;
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const USER_PATH_RE = /([A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}|\/Users\/|\/home\/)[^\\/\s'"]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** IPv4 privée (10/8, 172.16/12, 192.168/16) ou adresse locale d'une socket Netty (`L:/x.x.x.x`). */
const IP_RE =
  /(^|[^0-9.])((?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}|(?<=L:\/)\d{1,3}(?:\.\d{1,3}){3})(?![0-9])/g;

const LOREM = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco ' +
  'laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit'
).split(' ');

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nom de classe français sans accent (« Crâ » → « Cra ») : même forme que les fixtures. */
function pseudoClassName(breed: number): string {
  const key = WAKFU_CLASS_BREED_IDS[breed];
  const name = key ? CLASS_NAMES[key]?.['fr'] : undefined;
  return name ? name.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : 'Joueur';
}

function lorem(message: string, seed: number): string {
  const words = Math.max(1, message.trim().split(/\s+/).length);
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(LOREM[(seed + i * 7) % LOREM.length]);
  return out.join(' ');
}

export function anonymizeWakfuLog(input: string): WakfuLogAnonymizationResult {
  const lines = input.split('\n');

  // ── Passe 1 : recensement (ordre de première apparition) ──────────────────────────────────────
  /** Nom réel → breed (null tant qu'aucune ligne de combat ne l'a donné). */
  const players = new Map<string, number | null>();
  /** Identifiant réel → nom réel. */
  const playerIds = new Map<string, string>();
  const accounts = new Map<string, string>();

  const registerPlayer = (rawName: string, breed: number | null = null): void => {
    const name = rawName.trim();
    if (!name) return;
    const known = players.get(name);
    if (known === undefined || (known === null && breed !== null)) players.set(name, breed);
  };

  for (const line of lines) {
    const header = HEADER_RE.exec(line);
    const content = header ? header[2] : line;
    if (PRIVATE_CHANNEL_RE.test(content)) continue;

    const join = FIGHTER_JOIN_RE.exec(content);
    if (join) {
      registerPlayer(join[1], Number(join[2]));
      playerIds.set(join[3], join[1].trim());
      continue;
    }
    const trade = TRADE_BETWEEN_RE.exec(content);
    if (trade) {
      registerPlayer(trade[1]);
      registerPlayer(trade[3]);
      playerIds.set(trade[2], trade[1].trim());
      playerIds.set(trade[4], trade[3].trim());
    }
    const tradePlayer = TRADE_PLAYER_RE.exec(content);
    if (tradePlayer) registerPlayer(tradePlayer[1]);
    const chat = PUBLIC_CHAT_RE.exec(content);
    if (chat) registerPlayer(chat[2]);
    const follow = FOLLOW_RE.exec(content);
    if (follow) registerPlayer(follow[1]);
    for (const match of content.matchAll(ACCOUNT_WITH_NAME_RE)) {
      // « [Information (jeu)] Nom (compte#NNNN) a rejoint… » : le nom suit le crochet fermant.
      registerPlayer(match[1].replace(/^.*\]/, ''));
      if (!accounts.has(match[2])) accounts.set(match[2], '');
    }
  }

  // ── Attribution des pseudonymes ───────────────────────────────────────────────────────────────
  const pseudonyms = new Map<string, string>();
  const newIds = new Map<string, string>();
  const perClass = new Map<string, number>();
  let characterCount = 0;
  let otherCount = 0;
  for (const [name, breed] of players) {
    if (breed !== null) {
      const className = pseudoClassName(breed);
      const n = (perClass.get(className) ?? 0) + 1;
      perClass.set(className, n);
      characterCount += 1;
      pseudonyms.set(name, `Anonyme-${className}${n}`);
    } else {
      otherCount += 1;
      pseudonyms.set(name, `Anonyme-Joueur${otherCount}`);
    }
  }
  let characterIdCount = 0;
  let otherIdCount = 0;
  for (const [id, name] of playerIds) {
    const isCharacter = players.get(name) !== null;
    newIds.set(
      id,
      isCharacter ? String(90000000 + ++characterIdCount) : String(90001000 + ++otherIdCount),
    );
  }
  let accountCount = 0;
  for (const account of accounts.keys()) {
    accountCount += 1;
    const nn = String(accountCount).padStart(2, '0');
    accounts.set(account, `anonyme${nn}#${1000 + accountCount}`);
  }

  // Un seul motif pour tous les noms, les plus longs d'abord (« Bob-Leponge » avant « Bob »).
  // Bornes : ni lettre, ni chiffre, ni « _ »/« - » collés — un nom ne se remplace jamais au milieu
  // d'un autre mot.
  const namePattern = [...pseudonyms.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const nameRe = namePattern
    ? new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${namePattern})(?![\\p{L}\\p{N}_-])`, 'gu')
    : null;
  const idPattern = [...newIds.keys()]
    .filter((id) => id.replace('-', '').length >= 5)
    .map(escapeRegExp)
    .join('|');
  const idRe = idPattern ? new RegExp(`(?<![\\d-])(?:${idPattern})(?!\\d)`, 'g') : null;

  const ips = new Map<string, string>();
  const anonymizeIp = (ip: string): string => {
    let mapped = ips.get(ip);
    if (!mapped) {
      mapped = `192.0.2.${10 + ips.size}`;
      ips.set(ip, mapped);
    }
    return mapped;
  };

  // ── Passe 2 : réécriture ──────────────────────────────────────────────────────────────────────
  const out: string[] = [];
  let privateMessagesRemoved = 0;
  lines.forEach((line, index) => {
    const header = HEADER_RE.exec(line);
    const prefix = header ? header[1] : '';
    let content = header ? header[2] : line;
    if (PRIVATE_CHANNEL_RE.test(content)) {
      privateMessagesRemoved += 1;
      return;
    }

    const chat = PUBLIC_CHAT_RE.exec(content);
    if (chat) {
      const trailing = /\r$/.test(chat[4]) ? '\r' : '';
      content = `${chat[1]}${chat[2]}${chat[3]}${lorem(chat[4], index)}${trailing}`;
    }

    let result = prefix + content;
    result = result.replace(UUID_RE, ZERO_UUID);
    result = result.replace(USER_PATH_RE, '$1anonymous');
    result = result.replace(EMAIL_RE, 'anonymous@example.com');
    result = result.replace(IP_RE, (_m, before: string, ip: string) => before + anonymizeIp(ip));
    result = result.replace(ACCOUNT_RE, (m, account: string) => {
      const mapped = accounts.get(account);
      return mapped ? `(${mapped})` : m;
    });
    if (nameRe) result = result.replace(nameRe, (name) => pseudonyms.get(name) ?? name);
    if (idRe) result = result.replace(idRe, (id) => newIds.get(id) ?? id);
    out.push(result);
  });

  return {
    text: out.join('\n'),
    playerCount: characterCount + otherCount,
    privateMessagesRemoved,
  };
}
