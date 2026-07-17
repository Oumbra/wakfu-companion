import {
  ChatChannelInfo,
  ChatChannelKey,
  DamageElement,
  LogEntry,
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
 * une fois cette enveloppe retirée.
 */
const LOG_LINE_RE =
  /^\s*(?:INFO|WARN|ERROR)\s+(\d{2}:\d{2}:\d{2},\d{3})\s+\[[^\]]*\]\s+\([^)]*\)\s+-\s+(.*)$/;
const BRACKET_RE = /^\[([^\]]+)\] ?(.*)$/;
const CHAT_CONTENT_RE = /^(.+?) : (.*)$/;
const KAMA_GAIN_RE = new RegExp(`^Vous avez gagné (${NUM}) kamas\\.?$`);
const KAMA_LOSS_RE = new RegExp(`^Vous avez perdu (${NUM}) kamas\\.?$`);
const RAMASSE_RE = new RegExp(`^Vous avez ramassé (${NUM})x (.+?)\\s*\\.?$`);
const XP_RE = new RegExp(`^(.+?) : \\+(${NUM}) points d'XP\\.`);
const SPELL_CAST_RE = /^(.+?) lance le sort (.+)$/;
const CRITICAL_SUFFIX_RE = /^(.*) \(Critiques\)$/;
const KO_RE = /^(.+?) est KO !$/;
/** Émis une fois par transition de tour (jamais pour le premier tour d'un combat) : sert à compter les tours. */
const TURN_CARRY_RE = /^\d+ secondes? reportées? pour le tour suivant\.$/;
const DEFEAT_MARKER_RE = /^Vous avez été vaincu\(e\) !$/;
/** Marqueur technique fiable de fin de combat, émis systématiquement (y compris pour un entraînement contre un mannequin, qui n'affiche jamais l'écran de fin de combat). */
const FIGHT_END_RE = /^\[FIGHT\] End fight with id -?\d+$/;
const COMBAT_START_MARKER = 'CREATION DU COMBAT';
const DAMAGE_RE = new RegExp(`^(.+?): ([+-])(${NUM}) PV\\b(.*)$`);
const TAG_RE = /\(([^)]+)\)/g;
/** Application/rafraîchissement d'un effet à stacks : "Personnage: NomEffet (Niv. N)" ou "(+N Niv.)". */
const STATUS_EFFECT_RE = /^(.+?): (.+?) \((?:Niv\. \d+|\+\d+ Niv\.)\)$/;
const STATUS_REMOVE_RE = /^(.+?): n'est plus sous l'emprise de '(.+?)'\.?$/;
/** Purement informatif (le coup a été paré) : jamais une source de dégâts. */
const IGNORED_TAG = 'Parade !';

const DAMAGE_ELEMENTS = new Set<string>([
  'Neutre',
  'Terre',
  'Feu',
  'Eau',
  'Air',
  'Lumière',
  'Stasis',
]);

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
 */
export class LogParser {
  private lastCast: { caster: string; spell: string } | null = null;
  private lastDamage: { attacker: string; target: string } | null = null;
  private combatLostFlag = false;
  private readonly effectOwners = new Map<string, EffectOwnership>();
  /** Dernier lanceur connu de chaque sort (persiste au-delà du tour, pour les glyphes/zones posés une fois et qui tapent bien plus tard, ex. "Canine"). */
  private readonly spellCasters = new Map<string, string>();

  parseLine(rawLine: string): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return null;

    const lineMatch = LOG_LINE_RE.exec(line);
    if (!lineMatch) return null;
    const [, time, contentRaw] = lineMatch;
    const content = contentRaw.trim();

    if (FIGHT_END_RE.test(content)) {
      const result: 'won' | 'lost' = this.combatLostFlag ? 'lost' : 'won';
      this.resetFightState();
      return { kind: 'combat-end', time, result };
    }

    if (content === COMBAT_START_MARKER) {
      this.resetFightState();
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

    return null;
  }

  /** Réinitialise l'état propre à un combat (statuts, dernier sort, flag de défaite). */
  private resetFightState(): void {
    this.combatLostFlag = false;
    this.lastCast = null;
    this.lastDamage = null;
    this.effectOwners.clear();
    this.spellCasters.clear();
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
      };
    }
    return null;
  }

  private parseCombatLine(time: string, content: string): LogEntry | null {
    if (DEFEAT_MARKER_RE.test(content)) {
      this.combatLostFlag = true;
      return { kind: 'combat-defeat-marker', time };
    }

    const ko = KO_RE.exec(content);
    if (ko) {
      return { kind: 'enemy-defeated', time, name: ko[1].trim() };
    }

    if (TURN_CARRY_RE.test(content)) {
      return { kind: 'turn-marker', time };
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
      return {
        kind: 'xp-gain',
        time,
        character: xp[1].trim(),
        amount: parseFrenchNumber(xp[2]),
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
      };
    }

    return null;
  }
}

export type { ChatChannelKey };
