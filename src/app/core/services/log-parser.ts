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

const LINE_RE = /^(\d{2}:\d{2}:\d{2},\d{3}) - \[([^\]]+)\] ?(.*)$/;
const CHAT_CONTENT_RE = /^(.+?) : (.*)$/;
const KAMA_GAIN_RE = new RegExp(`^Vous avez gagné (${NUM}) kamas\\.?$`);
const KAMA_LOSS_RE = new RegExp(`^Vous avez perdu (${NUM}) kamas\\.?$`);
const RAMASSE_RE = new RegExp(`^Vous avez ramassé (${NUM})x (.+?)\\s*\\.?$`);
const XP_RE = new RegExp(`^(.+?) : \\+(${NUM}) points d'XP\\.`);
const SPELL_CAST_RE = /^(.+?) lance le sort (.+)$/;
const CRITICAL_SUFFIX_RE = /^(.*) \(Critiques\)$/;
const KO_RE = /^(.+?) est KO !$/;
const DEFEAT_MARKER_RE = /^Vous avez été vaincu\(e\) !$/;
const COMBAT_END_RE = /^Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat\.?/;
const DAMAGE_RE = new RegExp(`^(.+?): ([+-])(${NUM}) PV\\b(.*)$`);
const ELEMENT_RE = /\((Neutre|Terre|Feu|Eau|Air|Lumière|Stasis)\)/;

/**
 * Parseur à état du log de chat Wakfu. Doit recevoir les lignes dans l'ordre
 * chronologique : l'attribution des dégâts au bon sort/attaquant et la
 * détection victoire/défaite dépendent du contexte des lignes précédentes.
 */
export class LogParser {
  private lastCast: { caster: string; spell: string } | null = null;
  private combatLostFlag = false;

  parseLine(rawLine: string): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return null;

    const lineMatch = LINE_RE.exec(line);
    if (!lineMatch) return null;
    const [, time, category, contentRaw] = lineMatch;
    const content = contentRaw.trim();

    const chatChannel = resolveChatChannel(category);
    if (chatChannel) {
      const chatMatch = CHAT_CONTENT_RE.exec(content);
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
      return this.parseGameLine(time, content);
    }

    if (category === 'Information (combat)') {
      return this.parseCombatLine(time, content);
    }

    return null;
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

    if (COMBAT_END_RE.test(content)) {
      const result: 'won' | 'lost' = this.combatLostFlag ? 'lost' : 'won';
      this.combatLostFlag = false;
      return { kind: 'combat-end', time, result };
    }

    const ko = KO_RE.exec(content);
    if (ko) {
      return { kind: 'enemy-defeated', time, name: ko[1].trim() };
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
      return { kind: 'spell-cast', time, caster, spell, critical };
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
      const elementMatch = ELEMENT_RE.exec(damage[4] ?? '');
      const element: DamageElement = (elementMatch?.[1] as DamageElement) ?? 'Inconnu';
      return {
        kind: 'damage',
        time,
        target,
        attacker: this.lastCast?.caster ?? 'Inconnu',
        spell: this.lastCast?.spell ?? 'Autre',
        element,
        amount,
      };
    }

    return null;
  }
}

export type { ChatChannelKey };
