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
/** Émis une fois par transition de tour (jamais pour le premier tour d'un combat) : sert à compter les tours. */
const TURN_CARRY_RE = /^\d+ secondes? reportées? pour le tour suivant\.$/;
const DEFEAT_MARKER_RE = /^Vous avez été vaincu\(e\) !$/;
/** Diffusée à chaque allié mis KO (y compris via abandon de combat, où "est KO !"/"est hors-combat !" peuvent manquer) : signal de défaite le plus fiable, y compris en multi-compte. */
const OCCUPATION_RE = /^Lancement de l'occupation pour le joueur (.+)$/;
/** Marqueur technique fiable de fin de combat, émis systématiquement (y compris pour un entraînement contre un mannequin, qui n'affiche jamais l'écran de fin de combat). Capture l'id pour distinguer plusieurs combats concurrents (multi-compte). */
const FIGHT_END_RE = /^\[FIGHT\] End fight with id (-?\d+)$/;
const COMBAT_START_MARKER = 'CREATION DU COMBAT';
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
const TAG_RE = /\(([^)]+)\)/g;
/** Application/rafraîchissement d'un effet à stacks : "Personnage: NomEffet (Niv. N)" ou "(+N Niv.)". */
const STATUS_EFFECT_RE = /^(.+?): (.+?) \((?:Niv\. \d+|\+\d+ Niv\.)\)$/;
const STATUS_REMOVE_RE = /^(.+?): n'est plus sous l'emprise de '(.+?)'\.?$/;
/** Purement informatif (le coup a été paré) : jamais une source de dégâts. */
const IGNORED_TAG = 'Parade !';
/** "le joueur X donne : NK ; 1xObjet (refId=I) 2xAutre (refId=J) " — répété une fois par participant dans le résumé final d'un échange. */
const TRADE_DONNE_RE = /le joueur (.+?) donne\s*:\s*\d+\s*K\s*;\s*(.*?)(?=le joueur .+? donne\s*:|$)/g;
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
/** Types de ligne pour lesquels un contenu identique répété est plausible sans être un doublon d'observation (chat, butin farmé en boucle) : jamais dédoublonnés. */
const DEDUPE_EXEMPT_KINDS = new Set<string>(['loot', 'chat', 'fighter-joined']);

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
 * doublon — sauf butin/chat, où une répétition légitime est plausible.
 */
export class LogParser {
  private lastCast: { caster: string; spell: string } | null = null;
  private lastDamage: { attacker: string; target: string } | null = null;
  private readonly effectOwners = new Map<string, EffectOwnership>();
  /** Dernier lanceur connu de chaque sort (persiste au-delà du tour, pour les glyphes/zones posés une fois et qui tapent bien plus tard, ex. "Canine"). */
  private readonly spellCasters = new Map<string, string>();

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
    this.lastCast = null;
    this.lastDamage = null;
    this.effectOwners.clear();
    this.spellCasters.clear();
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
      const itemsText = match[2];
      const items: { name: string; quantity: number }[] = [];
      for (const itemMatch of itemsText.matchAll(TRADE_ITEM_RE)) {
        items.push({ quantity: Number(itemMatch[1]), name: itemMatch[2].trim() });
      }
      sides.push({ playerName, items });
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
    if (this.currentFightId === fightId) this.currentFightId = null;
  }

  /** Résout le combat d'un combattant nommé : sans ambiguïté si ce nom n'appartient qu'à un seul combat actif, sinon repli sur le dernier combat résolu. */
  private resolveFightIdForName(name: string): number | null {
    const ids = this.nameToFightIds.get(name);
    if (ids && ids.size === 1) {
      const [id] = ids;
      this.currentFightId = id;
    }
    return this.currentFightId;
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
    if (ambiguous) return this.currentFightId;
    return resolved ?? this.currentFightId;
  }

  private parseGameLine(time: string, content: string): LogEntry | null {
    const gain = KAMA_GAIN_RE.exec(content);
    if (gain) {
      return { kind: 'kama-gain', time, amount: parseFrenchNumber(gain[1]) };
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
        fightId: this.currentFightId,
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
      if (this.currentFightId !== null) this.fightLostFlags.set(this.currentFightId, true);
      return { kind: 'combat-defeat-marker', time, fightId: this.currentFightId };
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

    if (TURN_CARRY_RE.test(content)) {
      return { kind: 'turn-marker', time, fightId: this.currentFightId };
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
      this.lastCast = { caster, spell };
      this.spellCasters.set(spell.toLowerCase(), caster);
      this.resolveFightIdForName(caster);
      return { kind: 'spell-cast', time, caster, spell, critical };
    }

    const statusRemoval = STATUS_REMOVE_RE.exec(content);
    if (statusRemoval) {
      this.effectOwners.delete(statusRemoval[2].trim().toLowerCase());
      return null;
    }

    const statusEffect = STATUS_EFFECT_RE.exec(content);
    if (statusEffect) {
      const carrier = statusEffect[1].trim();
      const effectName = statusEffect[2].trim();
      this.effectOwners.set(effectName.toLowerCase(), {
        carrier,
        applier: this.lastCast?.caster ?? carrier,
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
      if (sign !== '-') return null; // on ne suit pas les soins
      const target = damage[1].trim();
      const amount = parseFrenchNumber(damage[3]);
      const tail = damage[4] ?? '';

      let element: DamageElement = 'Inconnu';
      let effectTag: string | null = null;
      for (const tagMatch of tail.matchAll(TAG_RE)) {
        const tag = tagMatch[1];
        if (DAMAGE_ELEMENTS.has(tag)) {
          if (element === 'Inconnu') element = tag as DamageElement;
        } else if (tag !== IGNORED_TAG) {
          // Le tag "mécanique" (statut, glyphe, riposte...) fait foi ; s'il
          // y en a plusieurs, le dernier (le plus proche de la fin de ligne)
          // est la vraie cause, les autres ne sont que des qualificatifs.
          effectTag = tag;
        }
      }

      let attacker = this.lastCast?.caster ?? 'Inconnu';
      let spell = this.lastCast?.spell ?? 'Autre';
      if (effectTag) {
        const owner = this.effectOwners.get(effectTag.toLowerCase());
        const caster = this.spellCasters.get(effectTag.toLowerCase());
        if (owner) {
          // Un effet porté par la cible elle-même (ex. Hachure) crédite celui
          // qui l'a appliqué ; un effet porté par un tiers (ex. Enflammé) se
          // crédite lui-même, puisqu'il inflige les dégâts à quelqu'un d'autre.
          attacker = owner.carrier === target ? owner.applier : owner.carrier;
        } else if (caster) {
          // Glyphe/zone posé une fois (ex. "Canine") qui tape bien plus tard :
          // on crédite qui l'a posé, peu importe qui a lancé un sort depuis.
          attacker = caster;
        } else if (this.lastDamage && this.lastDamage.attacker === target) {
          // Riposte pure sans statut ni sort connu (ex. "Contre-attaque") :
          // la victime du coup précédent devient l'attaquant de ce coup-ci.
          attacker = this.lastDamage.target;
        }
        spell = effectTag;
      }

      this.lastDamage = { attacker, target };

      return {
        kind: 'damage',
        time,
        target,
        attacker,
        spell,
        element,
        amount,
        fightId: this.resolveFightIdForName(attacker),
      };
    }

    return null;
  }

  /** Ignore les doublons stricts (même type d'événement, mêmes champs hors horodatage) survenant dans un intervalle très court — signature d'une observation multi-compte d'un même combat, où chaque compte connecté loggue sa propre copie du flux serveur. */
  private isDuplicate(entry: LogEntry): boolean {
    if (DEDUPE_EXEMPT_KINDS.has(entry.kind)) return false;
    const { time, ...rest } = entry as unknown as Record<string, unknown>;
    void time;
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
