import {
  ChatChannelInfo,
  ChatChannelKey,
  DamageElement,
  LogEntry,
  TradeSide,
} from '../models/log-entry.model';

/** Liste ordonnée des canaux de chat affichés dans le panneau Chat. */
export const CHAT_CHANNELS: ChatChannelInfo[] = [
  { key: 'proximite', label: 'Proximité' },
  { key: 'groupe', label: 'Groupe' },
  { key: 'guilde', label: 'Guilde' },
  { key: 'recrutement', label: 'Recrutement' },
  { key: 'commerce', label: 'Commerce' },
  { key: 'communaute', label: 'Communauté' },
];

function resolveChatChannel(category: string): ChatChannelInfo | null {
  if (category === 'Proximité') return { key: 'proximite', label: 'Proximité' };
  if (category === 'Guilde') return { key: 'guilde', label: 'Guilde' };
  if (category === 'Commerce') return { key: 'commerce', label: 'Commerce' };
  if (category === 'Groupe' || category === 'Équipe') {
    return { key: 'groupe', label: 'Groupe' };
  }
  if (category.startsWith('Recrutement')) {
    return { key: 'recrutement', label: 'Recrutement' };
  }
  if (category.startsWith('Communauté')) {
    return { key: 'communaute', label: 'Communauté' };
  }
  return null;
}

function parseFrenchNumber(raw: string): number {
  return parseInt(raw.replace(/\D/g, ''), 10);
}

const NUM = '[\\d \\u00A0\\u202F]+';

/**
 * wakfu.log encapsule chaque ligne dans le log technique du client Java :
 * "LEVEL HH:MM:SS,mmm [thread] (classe:ligne) - contenu". Le contenu utile
 * (chat, combat, marqueurs de combat) est identique à l'ancien wakfu_chat.log,
 * une fois cette enveloppe retirée. Seul le niveau INFO est traité ; WARN et
 * ERROR sont systématiquement ignorés (voir parseLine).
 */
const HEADER_RE =
  /^\s*(INFO|WARN|ERROR)\s+(\d{2}:\d{2}:\d{2},\d{3})\s+\[[^\]]*\]\s+\([^)]*\)\s+-\s+(.*)$/;
const BRACKET_RE = /^\[([^\]]+)\] ?(.*)$/;
const CHAT_CONTENT_RE = /^(.+?) : (.*)$/;
const KAMA_GAIN_RE = new RegExp(`^Vous avez gagné (${NUM}) kamas\\.?$`);
const KAMA_LOSS_RE = new RegExp(`^Vous avez perdu (${NUM}) kamas\\.?$`);
const RAMASSE_RE = new RegExp(`^Vous avez ramassé (${NUM})x (.+?)\\s*\\.?$`);
const CHALLENGE_SUCCESS_RE = /^Le challenge "(.+?)" est réussi\.?$/;
const CHALLENGE_FAIL_RE = /^Le challenge "(.+?)" a échoué\.?$/;
const XP_RE = new RegExp(`^(.+?) : \\+(${NUM}) points d'XP\\.`);
const SPELL_CAST_RE = /^(.+?) lance le sort (.+)$/;
const CRITICAL_SUFFIX_RE = /^(.*) \(Critiques\)$/;
/** Marqueur personnel ("vous"/vos alliés) : n'est émis que pour un personnage joueur, jamais pour un monstre. */
const KO_RE = /^(.+?) est KO !$/;
/** Diffusion générale de mise hors-combat, émise pour N'IMPORTE QUEL combattant (allié ou ennemi) — contrairement à KO_RE, réservé aux alliés. Signal principal pour détecter la mort d'un ennemi. */
const HORS_COMBAT_RE = /^(.+?) est hors-combat !$/;
const DEFEAT_MARKER_RE = /^Vous avez été vaincu\(e\) !$/;
/** Diffusée à chaque allié mis KO (y compris via abandon de combat, où "est KO !"/"est hors-combat !" peuvent manquer) : signal de défaite le plus fiable, y compris en multi-compte. */
const OCCUPATION_RE = /^Lancement de l'occupation pour le joueur (.+)$/;
/** Marqueur technique fiable de fin de combat, émis systématiquement (y compris pour un entraînement contre un mannequin, qui n'affiche jamais l'écran de fin de combat). Capture l'id pour distinguer plusieurs combats concurrents (multi-compte). */
const FIGHT_END_RE = /^\[FIGHT\] End fight with id (-?\d+)$/;
const COMBAT_START_MARKER = 'CREATION DU COMBAT';
/** Ouverture/fermeture d'une session marchand/HDV, hors de toute enveloppe `[Catégorie]` — voir MarketOccupationEntry. */
const MARKET_OCCUPATION_START_RE = /^Lancement de l'occupation MARKET sur la board\b/;
const MARKET_OCCUPATION_END_RE = /^On arrête l'occupation MARKET sur la board\b/;
/** Ligne technique émise une seule fois, tout au début de chaque session client ("1.92 (build -1
 * [2026-08-20 @ 14H18min45])") — seule source fiable de la date CALENDAIRE réelle du fichier (le
 * reste du log n'expose que l'heure HH:MM:SS,mmm, voir HEADER_RE). Voir LogDateAnchorEntry. */
const CLIENT_BUILD_DATE_RE = /\[(\d{4})-(\d{2})-(\d{2}) @ (\d{2})H(\d{2})min(\d{2})\]/;
/**
 * "fightId=X Nom breed : B [id] isControlledByAI=true/false obstacleId : O join the fight at {...}"
 * — présent pour chaque combattant de chaque combat. `obstacleId` différent de
 * -1 signale un décor/praticable de la zone (ex. "Larme d'Ogrest" dans un
 * donjon Abraknyde) qui "rejoint" techniquement le combat sans être un vrai
 * personnage à classer allié/ennemi.
 */
const FIGHTER_JOIN_RE =
  /^fightId=(-?\d+) (.+?) breed : (\d+) \[(-?\d+)\] isControlledByAI=(true|false) obstacleId : (-?\d+) join the fight/;
const DAMAGE_RE = new RegExp(`^(.+?): ([+-])(${NUM}) PV\\b(.*)$`);
/** Armure DONNÉE ("Personnage: 45 Armure" ou "... (Source)") — signe optionnel : jamais préfixé de
 * "+" en pratique (contrairement à PV), une perte d'armure ("-N Armure") est en revanche fréquente
 * et volontairement ignorée (voir parseCombatLine, hors périmètre : seule l'armure DONNÉE compte). */
const ARMOR_RE = new RegExp(`^(.+?): ([+-]?)(${NUM}) Armure\\b(.*)$`);
const TAG_RE = /\(([^)]+)\)/g;
/** Application/rafraîchissement d'un effet à stacks : "Personnage: NomEffet (Niv. N)" ou "(+N Niv.)".
 * `N` via NUM (pas un simple `\d+`) : les valeurs élevées (ex. un bouclier de feca "+1 892 Niv.")
 * s'affichent avec séparateur de milliers — un `\d+` nu ne matchait pas ces lignes, laissant
 * `effectOwners` sans entrée pour l'effet (bug réel corrigé : l'armure donnée par ces boucliers
 * n'était alors jamais rattachée au feca qui les lance, voir tests). */
const STATUS_EFFECT_RE = new RegExp(`^(.+?): (.+?) \\((?:Niv\\. ${NUM}|\\+${NUM} Niv\\.)\\)$`);
const STATUS_REMOVE_RE = /^(.+?): n'est plus sous l'emprise de '(.+?)'\.?$/;
/** Purement informatif (le coup a été paré) : jamais une source de dégâts. */
const IGNORED_TAG = 'Parade !';
/** "le joueur X donne : NK ; 1xObjet (refId=I) 2xAutre (refId=J) " — répété une fois par participant dans le résumé final d'un échange. */
const TRADE_DONNE_RE =
  /le joueur (.+?) donne\s*:\s*(\d+)\s*K\s*;\s*(.*?)(?=le joueur .+? donne\s*:|$)/g;
const TRADE_ITEM_RE = /(\d+)\s*x\s*(.+?)\s*\(refId=-?\d+\)/g;

const DAMAGE_ELEMENTS = new Set<string>([
  'Neutre',
  'Terre',
  'Feu',
  'Eau',
  'Air',
  'Lumière',
  'Stasis',
]);

/** Au-delà de cette fenêtre, deux lignes de contenu identique sont considérées comme deux événements distincts, pas un doublon multi-compte. */
const DEDUPE_WINDOW_MS = 1000;
/** Types de ligne pour lesquels un contenu identique répété est plausible sans être un doublon d'observation (butin farmé en boucle) : jamais dédoublonnés. */
const DEDUPE_EXEMPT_KINDS = new Set<string>(['loot', 'fighter-joined']);

/**
 * Suivi d'un effet à stacks (statut/passif type Enflammé, Hachure, Force
 * sage, poison...) : qui le porte actuellement, et qui l'a appliqué.
 * Les deux diffèrent selon le type d'effet :
 * - un effet porté par l'attaquant lui-même (ex. Enflammé) inflige des
 *   dégâts à une cible différente : le porteur (carrier) est le bon
 *   responsable des dégâts.
 * - un effet posé sur la cible (ex. Hachure, Force sage) la fait ensuite
 *   souffrir elle-même : c'est l'applicateur (applier), pas la victime,
 *   qui doit être crédité des dégâts.
 */
interface EffectOwnership {
  carrier: string;
  applier: string;
}

/**
 * État d'attribution des dégâts/soins/armure PROPRE à un seul combat (`lastCast`, `lastDamage`,
 * `effectOwners`, `spellCasters` — voir resolveEffectTail) — un par fightId actif, plus un « seau »
 * partagé (clé `null`) pour les lignes hors combat/combat non résolu. Isoler cet état par combat
 * (plutôt qu'un unique état global, comme c'était le cas avant ce fix) est indispensable dès que
 * deux combats tournent en parallèle (multi-compte) : sans ça, une ligne de dégât "propre" (aucun
 * tag exploitable, ex. "Cible: -N PV (Élément)" seul) retombe par défaut sur `lastCast.caster`, qui
 * pouvait être le DERNIER sort lancé dans N'IMPORTE QUEL combat concurrent — pas forcément celui de
 * la cible — mélangeant alliés/ennemis d'un combat à l'autre (bug réel constaté : ennemis d'un
 * second combat en cours apparaissant, avec de vrais dégâts, dans le récapitulatif d'un premier
 * combat déjà terminé). Le combat à consulter est toujours celui de la CIBLE (`target`, connue avec
 * certitude dès la regex, contrairement à l'attaquant qu'on est justement en train de résoudre) —
 * jamais celui de l'attaquant.
 */
interface FightParseState {
  lastCast: { caster: string; spell: string } | null;
  lastDamage: { attacker: string; target: string } | null;
  effectOwners: Map<string, EffectOwnership>;
  spellCasters: Map<string, string>;
}

function createFightParseState(): FightParseState {
  return { lastCast: null, lastDamage: null, effectOwners: new Map(), spellCasters: new Map() };
}

/**
 * Parseur à état du log Wakfu (wakfu.log). Doit recevoir les lignes dans
 * l'ordre chronologique : l'attribution des dégâts au bon sort/attaquant et
 * la détection victoire/défaite dépendent du contexte des lignes précédentes.
 *
 * Gère nativement plusieurs combats concurrents (multi-compte, plusieurs
 * combattants d'un même compte engagés simultanément) : chaque combattant
 * connu ("[_FL_] ... join the fight") est rattaché à son fightId, ce qui
 * permet de router dégâts/tours/butin/XP/KO vers le bon combat sans qu'un
 * second "CREATION DU COMBAT" ne vienne écraser la progression d'un premier
 * combat encore ouvert (bug historique). Un contenu strictement identique
 * répété en moins d'une seconde (observé quand plusieurs comptes participent
 * au même combat, chacun logguant sa propre copie du flux) est ignoré comme
 * doublon — sauf le butin, où une répétition légitime est plausible (farm).
 */
export class LogParser {
  /** Un état d'attribution par combat actif (voir FightParseState), clé `null` = hors combat/non résolu. */
  private readonly fightStates = new Map<number | null, FightParseState>();

  /** Combats connus pour un nom de combattant donné — un nom peut appartenir à plusieurs combats concurrents si le même monstre apparaît dans deux combats simultanés (multi-compte). */
  private readonly nameToFightIds = new Map<string, Set<number>>();
  /** Inverse de nameToFightIds, pour retirer proprement un combat terminé (évite qu'un nom de monstre très courant reste ambigu pour de futurs combats sans rapport). */
  private readonly fightMemberNames = new Map<number, Set<string>>();
  private readonly fightLostFlags = new Map<number, boolean>();
  /** Dernier combat résolu sans ambiguïté : repli pour les lignes sans nom exploitable (tour, butin) ou dont le nom est ambigu. */
  private currentFightId: number | null = null;

  /** Ligne en cours d'accumulation : un enregistrement Java peut s'étaler sur plusieurs lignes physiques (ex. résumé d'échange), la suite n'ayant pas d'en-tête LEVEL/horodatage. */
  private pending: { time: string; parts: string[] } | null = null;

  /** Horodatage (ms depuis minuit) de la dernière occurrence de chaque signature d'événement, pour ignorer les doublons multi-compte. */
  private readonly recentSignatures = new Map<string, number>();

  parseLine(rawLine: string): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return null;

    const headerMatch = HEADER_RE.exec(line);
    if (headerMatch) {
      const flushed = this.flushPending();
      const [, level, time, firstPart] = headerMatch;
      // WARN/ERROR toujours ignorées : on ne les bufferise même pas.
      this.pending = level === 'INFO' ? { time, parts: [firstPart] } : null;
      return flushed;
    }

    // Suite d'un enregistrement multi-lignes (ex. résumé d'échange) : pas d'en-tête sur cette ligne.
    this.pending?.parts.push(line.trim());
    return null;
  }

  /**
   * Un enregistrement peut s'étaler sur plusieurs lignes physiques (voir
   * parseLine) : celui de la toute dernière ligne d'un lot n'est donc traité
   * qu'à la ligne suivante, pour savoir s'il continue. À appeler après avoir
   * traité un lot complet de lignes, pour ne pas laisser la dernière en
   * attente indéfiniment si aucune nouvelle ligne n'arrive avant longtemps.
   */
  flush(): LogEntry | null {
    return this.flushPending();
  }

  /** Réinitialise tout l'état interne (à appeler à chaque reconnexion/relecture complète du fichier). */
  reset(): void {
    this.fightStates.clear();
    this.nameToFightIds.clear();
    this.fightMemberNames.clear();
    this.fightLostFlags.clear();
    this.currentFightId = null;
    this.pending = null;
    this.recentSignatures.clear();
  }

  private flushPending(): LogEntry | null {
    if (!this.pending) return null;
    const { time, parts } = this.pending;
    this.pending = null;
    const content = parts.join(' ').trim();
    if (!content) return null;
    const entry = this.parseContent(time, content);
    if (!entry) return null;
    return this.isDuplicate(entry) ? null : entry;
  }

  private parseContent(time: string, content: string): LogEntry | null {
    const fightEnd = FIGHT_END_RE.exec(content);
    if (fightEnd) {
      const fightId = Number(fightEnd[1]);
      const lost = this.fightLostFlags.get(fightId) ?? false;
      this.forgetFight(fightId);
      return { kind: 'combat-end', time, fightId, result: lost ? 'lost' : 'won' };
    }

    if (content === COMBAT_START_MARKER) {
      return { kind: 'combat-start', time };
    }

    if (MARKET_OCCUPATION_START_RE.test(content)) {
      return { kind: 'market-occupation', time, active: true };
    }
    if (MARKET_OCCUPATION_END_RE.test(content)) {
      return { kind: 'market-occupation', time, active: false };
    }

    const buildDate = CLIENT_BUILD_DATE_RE.exec(content);
    if (buildDate) {
      const [, year, month, day] = buildDate;
      return {
        kind: 'log-date-anchor',
        time,
        year: Number(year),
        month: Number(month),
        day: Number(day),
      };
    }

    const bracketMatch = BRACKET_RE.exec(content);
    if (!bracketMatch) return null;
    const [, category, rest] = bracketMatch;
    const bracketContent = (rest ?? '').trim();

    const chatChannel = resolveChatChannel(category);
    if (chatChannel) {
      const chatMatch = CHAT_CONTENT_RE.exec(bracketContent);
      if (!chatMatch) return null;
      return {
        kind: 'chat',
        time,
        channel: chatChannel.key,
        channelLabel: chatChannel.label,
        author: chatMatch[1].trim(),
        message: chatMatch[2].trim(),
      };
    }

    if (category === 'Information (jeu)') {
      return this.parseGameLine(time, bracketContent);
    }

    if (category === 'Information (combat)') {
      return this.parseCombatLine(time, bracketContent);
    }

    if (category === '_FL_') {
      return this.parseFighterJoin(time, bracketContent);
    }

    if (category === 'DEATH') {
      const occupation = OCCUPATION_RE.exec(bracketContent);
      if (occupation) {
        const fightId = this.resolveFightIdForOccupation(occupation[1].trim());
        if (fightId !== null) this.fightLostFlags.set(fightId, true);
        return { kind: 'combat-defeat-marker', time, fightId };
      }
      return null;
    }

    if (category === 'Trade') {
      return this.parseTradeLine(bracketContent, time);
    }

    return null;
  }

  private parseTradeLine(content: string, time: string): LogEntry | null {
    const sides: TradeSide[] = [];
    TRADE_DONNE_RE.lastIndex = 0;
    for (const match of content.matchAll(TRADE_DONNE_RE)) {
      const playerName = match[1].trim();
      const kamas = Number(match[2]);
      const itemsText = match[3];
      const items: { name: string; quantity: number }[] = [];
      for (const itemMatch of itemsText.matchAll(TRADE_ITEM_RE)) {
        items.push({ quantity: Number(itemMatch[1]), name: itemMatch[2].trim() });
      }
      sides.push({ playerName, items, kamas });
    }
    if (sides.length !== 2) return null;
    return { kind: 'trade-completed', time, sides: [sides[0], sides[1]] };
  }

  private parseFighterJoin(time: string, content: string): LogEntry | null {
    const join = FIGHTER_JOIN_RE.exec(content);
    if (!join || join[6] !== '-1') return null;
    const fightId = Number(join[1]);
    const name = join[2].trim();
    const breed = Number(join[3]);
    const fighterId = Number(join[4]);
    const isControlledByAI = join[5] === 'true';

    let fightIds = this.nameToFightIds.get(name);
    if (!fightIds) {
      fightIds = new Set();
      this.nameToFightIds.set(name, fightIds);
    }
    fightIds.add(fightId);
    let members = this.fightMemberNames.get(fightId);
    if (!members) {
      members = new Set();
      this.fightMemberNames.set(fightId, members);
    }
    members.add(name);
    this.currentFightId = fightId;

    return { kind: 'fighter-joined', time, fightId, name, breed, fighterId, isControlledByAI };
  }

  /** Oublie un combat terminé : libère les noms de combattants qui n'appartiennent à aucun autre combat actif, pour éviter qu'un nom de monstre courant reste faussement ambigu pour un futur combat sans rapport. */
  private forgetFight(fightId: number): void {
    const members = this.fightMemberNames.get(fightId);
    if (members) {
      for (const name of members) {
        const ids = this.nameToFightIds.get(name);
        if (!ids) continue;
        ids.delete(fightId);
        if (ids.size === 0) this.nameToFightIds.delete(name);
      }
    }
    this.fightMemberNames.delete(fightId);
    this.fightLostFlags.delete(fightId);
    this.fightStates.delete(fightId);
    if (this.currentFightId === fightId) this.currentFightId = null;
  }

  /** État d'attribution (voir FightParseState) du combat `fightId`, créé au premier accès. */
  private getFightState(fightId: number | null): FightParseState {
    let state = this.fightStates.get(fightId);
    if (!state) {
      state = createFightParseState();
      this.fightStates.set(fightId, state);
    }
    return state;
  }

  /** Résout le combat d'un combattant nommé : sans ambiguïté si ce nom n'appartient qu'à un seul combat actif, sinon repli sur le dernier combat résolu (voir resolveCurrentFightId). */
  private resolveFightIdForName(name: string): number | null {
    const ids = this.nameToFightIds.get(name);
    if (ids && ids.size === 1) {
      const [id] = ids;
      this.currentFightId = id;
      return id;
    }
    return this.resolveCurrentFightId();
  }

  /** "Lancement de l'occupation pour le joueur {nom} {classe}" : le nom du combattant est un préfixe du texte capturé (la classe suit, ex. "Crâ", "Sram"). */
  private resolveFightIdForOccupation(rawName: string): number | null {
    let resolved: number | null = null;
    let ambiguous = false;
    for (const [name, ids] of this.nameToFightIds) {
      if (rawName !== name && !rawName.startsWith(`${name} `)) continue;
      for (const id of ids) {
        if (resolved !== null && resolved !== id) ambiguous = true;
        resolved = id;
      }
    }
    if (ambiguous) return this.resolveCurrentFightId();
    return resolved ?? this.resolveCurrentFightId();
  }

  /**
   * Repli utilisé pour les lignes sans nom de combattant exploitable (butin,
   * changement de tour, marqueur de défaite "vaincu(e)") : le dernier combat
   * résolu sans ambiguïté, s'il est toujours actif — sinon, s'il ne reste
   * plus qu'UN SEUL combat actif, ce dernier ne peut être que le bon (plus
   * d'ambiguïté possible). Sans ce second repli, la fin d'un premier combat
   * concurrent laissait `currentFightId` à `null` jusqu'à la prochaine ligne
   * à nom résolvable, et tout butin ramassé entre-temps pour l'unique combat
   * restant se perdait (bug réel : butin de fin de combat manquant en
   * multi-compte, voir tests).
   */
  private resolveCurrentFightId(): number | null {
    if (this.currentFightId !== null && this.fightMemberNames.has(this.currentFightId)) {
      return this.currentFightId;
    }
    if (this.fightMemberNames.size === 1) {
      const [onlyId] = this.fightMemberNames.keys();
      this.currentFightId = onlyId;
      return onlyId;
    }
    return null;
  }

  private parseGameLine(time: string, content: string): LogEntry | null {
    const gain = KAMA_GAIN_RE.exec(content);
    if (gain) {
      return {
        kind: 'kama-gain',
        time,
        amount: parseFrenchNumber(gain[1]),
        fightId: this.resolveCurrentFightId(),
      };
    }
    const loss = KAMA_LOSS_RE.exec(content);
    if (loss) {
      return { kind: 'kama-loss', time, amount: parseFrenchNumber(loss[1]) };
    }
    const loot = RAMASSE_RE.exec(content);
    if (loot) {
      return {
        kind: 'loot',
        time,
        item: loot[2].trim(),
        quantity: parseFrenchNumber(loot[1]),
        fightId: this.resolveCurrentFightId(),
      };
    }
    const challengeSuccess = CHALLENGE_SUCCESS_RE.exec(content);
    if (challengeSuccess) {
      return { kind: 'challenge-result', time, name: challengeSuccess[1].trim(), success: true };
    }
    const challengeFail = CHALLENGE_FAIL_RE.exec(content);
    if (challengeFail) {
      return { kind: 'challenge-result', time, name: challengeFail[1].trim(), success: false };
    }
    return null;
  }

  private parseCombatLine(time: string, content: string): LogEntry | null {
    if (DEFEAT_MARKER_RE.test(content)) {
      const fightId = this.resolveCurrentFightId();
      if (fightId !== null) this.fightLostFlags.set(fightId, true);
      return { kind: 'combat-defeat-marker', time, fightId };
    }

    const ko = KO_RE.exec(content);
    if (ko) {
      const name = ko[1].trim();
      return { kind: 'enemy-defeated', time, name, fightId: this.resolveFightIdForName(name) };
    }

    const horsCombat = HORS_COMBAT_RE.exec(content);
    if (horsCombat) {
      const name = horsCombat[1].trim();
      return { kind: 'enemy-defeated', time, name, fightId: this.resolveFightIdForName(name) };
    }

    const cast = SPELL_CAST_RE.exec(content);
    if (cast) {
      const caster = cast[1].trim();
      let spell = cast[2].trim();
      let critical = false;
      const critMatch = CRITICAL_SUFFIX_RE.exec(spell);
      if (critMatch) {
        spell = critMatch[1].trim();
        critical = true;
      }
      const fightId = this.resolveFightIdForName(caster);
      const state = this.getFightState(fightId);
      state.lastCast = { caster, spell };
      state.spellCasters.set(spell.toLowerCase(), caster);
      return { kind: 'spell-cast', time, caster, spell, critical, fightId };
    }

    const statusRemoval = STATUS_REMOVE_RE.exec(content);
    if (statusRemoval) {
      const carrier = statusRemoval[1].trim();
      const fightId = this.resolveFightIdForName(carrier);
      this.getFightState(fightId).effectOwners.delete(statusRemoval[2].trim().toLowerCase());
      return null;
    }

    const statusEffect = STATUS_EFFECT_RE.exec(content);
    if (statusEffect) {
      const carrier = statusEffect[1].trim();
      const effectName = statusEffect[2].trim();
      const state = this.getFightState(this.resolveFightIdForName(carrier));
      state.effectOwners.set(effectName.toLowerCase(), {
        carrier,
        applier: state.lastCast?.caster ?? carrier,
      });
      return null;
    }

    const xp = XP_RE.exec(content);
    if (xp) {
      const character = xp[1].trim();
      return {
        kind: 'xp-gain',
        time,
        character,
        amount: parseFrenchNumber(xp[2]),
        fightId: this.resolveFightIdForName(character),
      };
    }

    const damage = DAMAGE_RE.exec(content);
    if (damage) {
      const sign = damage[2];
      const target = damage[1].trim();
      const amount = parseFrenchNumber(damage[3]);
      const tail = damage[4] ?? '';

      // Le combat à consulter pour résoudre l'attaquant (voir FightParseState) est toujours celui de
      // la CIBLE, connue avec certitude dès la regex — jamais celui de l'attaquant, qu'on est
      // justement en train de résoudre et qui pourrait sinon retomber sur l'état d'un autre combat
      // concurrent (voir FightParseState). C'est aussi le fightId attribué à l'entrée émise.
      const fightId = this.resolveFightIdForName(target);
      const state = this.getFightState(fightId);

      if (sign === '-') {
        const { attacker, spell, element } = this.resolveEffectTail(target, tail, state, {
          selfFallback: false,
          riposteFallback: true,
        });
        state.lastDamage = { attacker, target };
        return { kind: 'damage', time, target, attacker, spell, element, amount, fightId };
      }

      // Soin ("+N PV") : même mécanique de résolution que les dégâts, à deux exceptions près (voir
      // resolveEffectTail) — un passif non rattaché à un sort récent (`riposteFallback: false`) se
      // crédite à la cible elle-même plutôt qu'au dernier lanceur de sort connu, qui pourrait être
      // n'importe qui d'autre (ex. l'ennemi qui vient de frapper cette même cible).
      const { attacker, spell, element } = this.resolveEffectTail(target, tail, state, {
        selfFallback: true,
        riposteFallback: false,
      });
      return { kind: 'heal', time, target, attacker, spell, element, amount, fightId };
    }

    const armor = ARMOR_RE.exec(content);
    if (armor) {
      const sign = armor[2];
      if (sign === '-') return null; // perte d'armure : hors périmètre, seule l'armure DONNÉE compte.
      const target = armor[1].trim();
      const amount = parseFrenchNumber(armor[3]);
      const tail = armor[4] ?? '';
      const fightId = this.resolveFightIdForName(target);
      const { attacker, spell } = this.resolveEffectTail(
        target,
        tail,
        this.getFightState(fightId),
        {
          selfFallback: true,
          riposteFallback: false,
        },
      );
      return { kind: 'armor', time, target, attacker, spell, amount, fightId };
    }

    return null;
  }

  /**
   * Résout qui créditer (`attacker`) et le nom de la source (`spell`) d'une ligne PV/Armure à
   * partir de son tag de fin de ligne (parenthèses) — mécanique commune aux dégâts, soins et
   * armure donnée (voir CLAUDE.md). Un tag reconnu comme élément (voir DAMAGE_ELEMENTS) alimente
   * `element` ; le dernier tag NON élémentaire (hors "Parade !", jamais une cause) est le tag
   * "mécanique" (statut, glyphe, riposte...) qui détermine `attacker`/`spell`.
   *
   * - `riposteFallback: true` (dégâts uniquement, comportement historique inchangé) : à défaut de
   *   statut suivi (`effectOwners`) ou de sort connu (`spellCasters`, ex. glyphe "Canine" posé une
   *   fois qui tape bien plus tard), une riposte pure (ex. "Contre-attaque") crédite la victime du
   *   coup précédent.
   * - `riposteFallback: false` (soins/armure) : un tag non suivi par `effectOwners` est un passif
   *   propre à la cible (ex. "Art Canin", "Digestion") — crédité à la cible elle-même plutôt qu'au
   *   dernier sort connu, qui pourrait être sans rapport (lancé par un tiers). `spellCasters` n'est
   *   volontairement PAS consulté ici (contrairement aux dégâts) : il est global et persiste au-delà
   *   du tour pour N'IMPORTE QUEL sort déjà lancé par N'IMPORTE QUI, ce qui créditerait à tort un
   *   adversaire pour le passif défensif propre de sa cible (ex. armure gagnée par la cible d'une
   *   attaque, taguée du nom du sort qui vient de la toucher — cas réel constaté, voir tests).
   */
  private resolveEffectTail(
    target: string,
    tail: string,
    state: FightParseState,
    options: { selfFallback: boolean; riposteFallback: boolean },
  ): { attacker: string; spell: string; element: DamageElement } {
    let element: DamageElement = 'Inconnu';
    let effectTag: string | null = null;
    for (const tagMatch of tail.matchAll(TAG_RE)) {
      const tag = tagMatch[1];
      if (DAMAGE_ELEMENTS.has(tag)) {
        if (element === 'Inconnu') element = tag as DamageElement;
      } else if (tag !== IGNORED_TAG) {
        effectTag = tag;
      }
    }

    let attacker = state.lastCast?.caster ?? (options.selfFallback ? target : 'Inconnu');
    let spell = state.lastCast?.spell ?? 'Autre';
    if (effectTag) {
      const owner = state.effectOwners.get(effectTag.toLowerCase());
      if (owner) {
        // Un effet porté par la cible elle-même (ex. Hachure) crédite celui
        // qui l'a appliqué ; un effet porté par un tiers (ex. Enflammé) se
        // crédite lui-même, puisqu'il inflige les dégâts à quelqu'un d'autre.
        attacker = owner.carrier === target ? owner.applier : owner.carrier;
      } else if (options.riposteFallback) {
        const caster = state.spellCasters.get(effectTag.toLowerCase());
        if (caster) {
          // Glyphe/zone posé une fois (ex. "Canine") qui tape bien plus tard :
          // on crédite qui l'a posé, peu importe qui a lancé un sort depuis.
          attacker = caster;
        } else if (state.lastDamage && state.lastDamage.attacker === target) {
          // Riposte pure sans statut ni sort connu (ex. "Contre-attaque") :
          // la victime du coup précédent devient l'attaquant de ce coup-ci.
          attacker = state.lastDamage.target;
        }
      } else {
        attacker = target;
      }
      spell = effectTag;
    }
    return { attacker, spell, element };
  }

  /** Ignore les doublons stricts (même type d'événement, mêmes champs hors horodatage) survenant dans un intervalle très court — signature d'une observation multi-compte d'un même combat/échange, où chaque compte connecté loggue sa propre copie du flux serveur. */
  private isDuplicate(entry: LogEntry): boolean {
    if (DEDUPE_EXEMPT_KINDS.has(entry.kind)) return false;
    const { time, ...rest } = entry as unknown as Record<string, unknown>;
    void time;
    if (entry.kind === 'trade-completed') {
      // Le résumé final d'un échange est réémis une fois par confirmation
      // (une par participant) avec les deux "donne" dans l'ordre inverse :
      // trier par nom pour que les deux émissions produisent la même signature.
      (rest as { sides: TradeSide[] }).sides = [...(rest as { sides: TradeSide[] }).sides].sort(
        (a, b) => a.playerName.localeCompare(b.playerName),
      );
    }
    const signature = `${entry.kind}|${JSON.stringify(rest)}`;
    const nowMs = this.timeToMs(entry.time);
    const previous = this.recentSignatures.get(signature);
    this.recentSignatures.set(signature, nowMs);
    if (this.recentSignatures.size > 500) this.pruneSignatures(nowMs);
    return previous !== undefined && nowMs - previous >= 0 && nowMs - previous <= DEDUPE_WINDOW_MS;
  }

  private pruneSignatures(nowMs: number): void {
    for (const [key, seenAt] of this.recentSignatures) {
      if (nowMs - seenAt > DEDUPE_WINDOW_MS) this.recentSignatures.delete(key);
    }
  }

  private timeToMs(time: string): number {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(time);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
  }
}

export type { ChatChannelKey };
