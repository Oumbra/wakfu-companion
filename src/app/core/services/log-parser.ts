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
/** Fuite d'un combattant, JAMAIS précédée d'un marqueur "est hors-combat !" pour ce même nom — signal
 * exclusivement observé, à ce jour, sur les monstres "Mimic X" (Sucré/Runique/Domestique/Fragmenté)
 * qui se révèlent puis fuient plutôt que de mourir (confirmé sur 3 vrais fichiers :
 * erz-sniping/la-crête-givrée/Le Hammamamoule, voir CLAUDE.md). Générique dans le texte du log
 * (n'importe quel combattant POURRAIT théoriquement l'émettre), donc traité comme tel plutôt que
 * réservé aux mimiques : voir StatsStoreService.registerFightFlee. */
const DISAPPEAR_RE = /^(.+?): disparaît$/;
/** "X: Invoque un(e) Y"/"X: Invoque une créature du Y" — annonce une invocation sur le point de
 * rejoindre le combat. Groupe 1 = lanceur, TOUJOURS exploité. Groupe 2 = `Y`, capturé UNIQUEMENT
 * pour la forme "un(e) Y" — cette forme s'est vérifiée fiable comme nom de la créature qui rejoint
 * réellement (constaté sur le fichier de test dédié aux transformations, "Invoque un(e) Dark
 * Lapino" → jointure "Dark Lapino", ET sur un vrai fichier de farm, "Cendragon: Invoque un(e)
 * Cendragon" → jointure "Cendragon", voir plus bas). La forme "une créature du Y" reste PAS fiable
 * (le sort "Invocation" de l'Osamodas l'annonce mais le combattant qui rejoint peut porter un tout
 * autre nom, ex. "Chafer Elite" pour "Invoque une créature du Gobgob" — voir CLAUDE.md) : `undefined`
 * pour cette forme, voir FightParseState.pendingSummonCasters.expectedName/parseFighterJoin (aucun
 * filtre par nom appliqué dans ce cas, comportement historique inchangé).
 *
 * Ce nom sert de filtre de correspondance, PAS de source de vérité absolue : bug réel corrigé le
 * 2026-08-31 (un mimique qui se révèle pendant qu'un monstre proche spamme "Invoque un(e) X" en
 * rafale, ex. Cendragon qui s'auto-invoque en boucle lors d'une resynchronisation, était avalé à
 * tort par une entrée en attente PÉRIMÉE mais toujours dans la fenêtre de `SUMMON_JOIN_WINDOW_MS` —
 * sans corrélation par nom, la file FIFO consommait aveuglément la plus ancienne entrée quel que
 * soit le nom du véritable nouveau venu). */
const SUMMON_ANNOUNCE_RE = /^(.+?): Invoque (?:un\(e\) (.+?)|une créature du .+?)\s*$/;
/** Délai maximum toléré entre une annonce "Invoque" et la jointure qu'elle corrèle — voir
 * FightParseState.pendingSummonCasters. Généreux (60x) par rapport au maximum réel observé (8ms) sur
 * le fichier de référence : marge pour la latence/l'entrelacement multi-compte, tout en restant très
 * en-dessous du moindre écart entre deux véritables combattants distincts (secondes à minutes). */
const SUMMON_JOIN_WINDOW_MS = 500;
/** Ligne technique SANS crochet de catégorie ("(eXG:105) - Instanciation d'une nouvelle invocation
 * avec un id de N", ou son équivalent anglais côté client "(eXM:91) - New summon with id N" — les
 * deux variantes coexistent dans un même fichier, vérifié sur le fichier de référence Fayto,
 * probablement deux sous-systèmes client différents) émise juste avant la ligne "[_FL_] ... join the
 * fight" de TOUTE invocation, y compris celles qu'aucune annonce "X: Invoque ..." ne précède (bug
 * réel corrigé le 2026-08-24, ex. les "Rocher" d'un mécanisme de boss "Sor'Hon, Seigneur de la
 * Flamme: fait tomber des rochers au sol" déclenché par le sort "Effondrement", sans aucune annonce
 * "Invoque" détectable) — voir parseContent, qui l'exploite en repli de SUMMON_ANNOUNCE_RE plutôt
 * qu'à sa place (celui-ci reste la source la PLUS fiable, avec le nom du lanceur explicite dans le
 * texte ; ce repli déduit le lanceur du dernier sort casté dans ce même combat, `FightParseState.lastCast`,
 * moins direct mais fonctionne pour toute invocation liée à un sort qui vient d'être lancé, allié ou
 * ennemi). Une précédente tentative d'exploiter cette même ligne pour CORRÉLER une annonce précise à
 * son instanciation (appariement par comptage) avait été abandonnée (voir CLAUDE.md) à cause d'un
 * écart de comptage entre les deux — non pertinent ici : ce nouvel usage ne compte ni n'apparie rien,
 * il sert uniquement de GARDE-FOU binaire ("cette jointure est une invocation, qui que soit son
 * invocateur présumé") gated par ANNOUNCE_TO_INSTANTIATION_WINDOW_MS pour ne jamais pousser un doublon
 * quand SUMMON_ANNOUNCE_RE vient déjà de pousser LA MÊME invocation l'instant d'avant. */
const INVOCATION_INSTANTIATED_RE =
  /^(?:Instanciation d'une nouvelle invocation avec un id de|New summon with id) -?\d+$/;
/** Écart maximum toléré entre une annonce "Invoque" (SUMMON_ANNOUNCE_RE, qui pousse déjà son propre
 * invocateur dans pendingSummonCasters) et la ligne technique INVOCATION_INSTANTIATED_RE qui la suit
 * TOUJOURS de très près (0 à 8ms observés, comme pour SUMMON_JOIN_WINDOW_MS) : sert uniquement à
 * détecter "cette ligne technique est la continuation d'une annonce déjà traitée" pour ne pas pousser
 * un second invocateur (potentiellement erroné si `lastCast` a changé entre-temps) en double —
 * beaucoup plus court que SUMMON_JOIN_WINDOW_MS, volontairement : seul le tout dernier événement
 * "Invoque" compte ici, pas une fenêtre large de corrélation. */
const ANNOUNCE_TO_INSTANTIATION_WINDOW_MS = 50;
/** "X: transformé(e) en Y !" (ex. Poupée Lapino du Sadida qui évolue en cours de combat) — la
 * nouvelle forme rejoint le combat via sa PROPRE ligne "[_FL_] ... join the fight" quelques lignes
 * plus tard, sans nouvelle annonce "Invoque" ni ligne d'instanciation : c'est le nom X qui doit être
 * reconnu comme invocation déjà connue pour que Y hérite du même invocateur (voir
 * FightParseState.summonOwners, propagé dans parseCombatLine). */
const TRANSFORM_RE = /^(.+?): transformée? en (.+?)\s*!?$/;
/** "Vous avez été vaincu(e) !" : marqueur PERSONNEL et TRANSITOIRE — un allié mis KO en cours de
 * combat peut être relevé (soin, résurrection...) et le combat se terminer malgré tout par une
 * victoire de l'équipe. NE contribue PLUS à `fightLostFlags` depuis le 2026-08-25 (voir
 * OCCUPATION_RE juste en dessous, qui reste le seul signal explicite fiable) : bug réel corrigé,
 * un combat effectivement long (5 KO "vaincu(e)" de personnages DIFFÉRENTS répartis sur ~15
 * minutes, chacun relevé entre-temps) finissant par une authentique victoire (le boss meurt, XP de
 * fin de combat) était marqué à tort comme perdu, la toute première occurrence de ce marqueur
 * suffisant à armer `fightLostFlags` pour le reste du combat. Toujours renvoyé en LogEntry
 * (`combat-defeat-marker`, actuellement un no-op côté StatsStoreService) au cas où un futur usage
 * (UI temps réel affichant les KO en cours, par exemple) en aurait besoin. */
const DEFEAT_MARKER_RE = /^Vous avez été vaincu\(e\) !$/;
/** "Lancement de l'occupation pour le joueur X" : diffusé UNE FOIS PAR ALLIÉ, mais seulement au
 * moment où le combat se conclut RÉELLEMENT par une défaite totale de l'équipe (vérifié sur un vrai
 * fichier multi-compte, 2026-08-25 — ne se déclenche JAMAIS pour un simple KO relevable en cours de
 * combat, y compris quand "Vous avez été vaincu(e) !"/"est KO !" apparaissent à plusieurs reprises
 * dans un combat finalement gagné) — y compris via abandon de combat, où "est KO !"/"est
 * hors-combat !" peuvent manquer. Signal de défaite le plus fiable, y compris en multi-compte : seul
 * marqueur explicite autorisé à armer `fightLostFlags` (voir DEFEAT_MARKER_RE ci-dessus). */
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
 * Extrait uniquement l'heure d'une ligne brute (et, le cas échéant, la date calendaire si cette ligne
 * est un ancrage `CLIENT_BUILD_DATE_RE`) — SANS passer par le pipeline stateful de `LogParser`
 * (bufferisation multi-lignes, dédoublonnage...). Fonction pure, appelée par StatsStoreService pour
 * un pré-balayage en LECTURE SEULE d'un lot de lignes avant traitement normal (voir
 * `primeLogDateAnchorFromBatch`) : retrouver un ancrage de date situé plus loin dans le lot que la
 * toute première ligne, pour dater correctement les lignes qui le PRÉCÈDENT (bug réel — voir
 * CLAUDE.md/mémoire projet : un fichier contenant déjà des combats d'une session de jeu antérieure au
 * lancement client qui a produit la ligne d'ancrage affichait ces combats à la date système du jour
 * de LECTURE au lieu de leur vraie date).
 */
export function peekLineTime(
  rawLine: string,
): { time: string; buildDate: { year: number; month: number; day: number } | null } | null {
  const headerMatch = HEADER_RE.exec(rawLine.replace(/\r$/, ''));
  if (!headerMatch) return null;
  const [, , time, content] = headerMatch;
  const buildMatch = CLIENT_BUILD_DATE_RE.exec(content);
  const buildDate = buildMatch
    ? { year: Number(buildMatch[1]), month: Number(buildMatch[2]), day: Number(buildMatch[3]) }
    : null;
  return { time, buildDate };
}

/**
 * "fightId=X Nom breed : B [id] isControlledByAI=true/false obstacleId : O join the fight at {...}"
 * — présent pour chaque combattant de chaque combat. `obstacleId` (groupe 6, capturé mais plus
 * exploité pour filtrer — voir plus bas) a longtemps été supposé signaler du décor pur (ex. "Larme
 * d'Ogrest") dès qu'il diffère de -1 ; vérifié FAUX sur un vrai fichier multi-donjons (2026-08-24,
 * `wakfu.log` de Fayto) : la majorité des MONSTRES RÉELS d'un combat (jusqu'à 61% des lignes
 * "join the fight" du fichier) ont un `obstacleId` non -1 — probablement leur position de départ sur
 * une case elle-même praticable/obstacle, sans rapport avec leur nature de combattant. Un ancien
 * filtre `obstacleId !== '-1' => ignoré` (voir git blame, fix ciblant "Larme d'Ogrest") faisait donc
 * disparaître silencieusement la MAJORITÉ des ennemis de nombreux combats du récap (bug réel corrigé :
 * absence d'illustration de combat malgré un monstre solo ayant infligé des dizaines de milliers de
 * dégâts, dégâts reçus/infligés sous-comptés) — retiré, voir parseFighterJoin. Les invocations (voir
 * SUMMON_ANNOUNCE_RE) sont désormais distinguées des vrais ennemis par corrélation à leur invocateur,
 * pas par ce champ.
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
  /** Invocateur par nom d'invocation CONNUE de ce combat (voir CLAUDE.md, section invocations) :
   * alimentée dès qu'une invocation rejoint le combat (voir parseFighterJoin) et propagée à sa
   * nouvelle forme le cas échéant (voir TRANSFORM_RE) — consultée en dernière étape de
   * resolveEffectTail pour réattribuer toute action de l'invocation (dégâts/soin/armure) à son
   * invocateur, avec le nom de l'invocation comme libellé de "sort" (voir CLAUDE.md). */
  summonOwners: Map<string, string>;
  /** Casters en attente d'une invocation qui va rejoindre CE combat (FIFO, horodatée) — alimentée
   * par SUMMON_ANNOUNCE_RE (annonce "X: Invoque ...", `source: 'announce'`, la plus fiable) ET, en
   * repli, par INVOCATION_INSTANTIATED_RE (ligne technique d'instanciation SANS annonce "Invoque"
   * détectable, `source: 'fallback'`, caster déduit de `lastCast` — voir CLAUDE.md, cas "Rocher" du
   * 2026-08-24), consommée par le PROCHAIN combattant au fighterId encore jamais vu de ce combat
   * SURVENANT DANS LES `SUMMON_JOIN_WINDOW_MS` SUIVANTS (voir seenFighterIds/parseFighterJoin,
   * CLAUDE.md) — un tout nouveau fighterId N'EST PAS forcément une invocation : un combat long peut
   * voir un vrai monstre/allié supplémentaire rejoindre bien plus tard (renfort de boss à plusieurs
   * phases, vague d'une brèche...), et un monstre peut LUI AUSSI invoquer (annonce "Invoque"
   * identique, ex. un boss qui invoque des adds). Sans cette fenêtre, une annonce laissée en attente
   * (invocation jamais matérialisée, ou combat très long) capturait à tort N'IMPORTE QUEL combattant
   * suivant, même des dizaines de secondes/minutes plus tard (bug réel corrigé : de vrais boss d'un
   * combat ultime "invoqués" par un allié qui n'avait rien à voir). Fenêtre calibrée sur le fichier
   * réel qui a servi à ce fix : les 186 annonces "Invoque" y sont TOUJOURS suivies de leur propre
   * jointure en 0 à 8ms (log quasi synchrone) — voir SUMMON_JOIN_WINDOW_MS.
   *
   * `source` distingue les deux origines pour parseFighterJoin : voir sa doc (bug réel corrigé le
   * 2026-08-31 — un mimique qui se révèle déclenche EXACTEMENT la même ligne technique
   * INVOCATION_INSTANTIATED_RE qu'une vraie invocation, sans qu'aucune annonce "Invoque" ne l'ait
   * jamais précédé, et disparaissait donc entièrement du récap comme s'il avait été invoqué par le
   * dernier lanceur de sort du combat, quel qu'il soit).
   *
   * `expectedName` (voir SUMMON_ANNOUNCE_RE) : nom attendu du prochain joueur qui consommera CETTE
   * entrée précise, quand l'annonce le permet ("un(e) Y", fiable) — `null` sinon (forme "une
   * créature du Y", non fiable, ET toute entrée `source: 'fallback'`, sans texte d'annonce du tout).
   * Sert de filtre dans parseFighterJoin : une entrée dont `expectedName` ne correspond PAS au
   * nouveau venu est IGNORÉE (laissée en file, jamais consommée par erreur) plutôt que consommée en
   * pur FIFO — bug réel corrigé le 2026-08-31 (rafale d'auto-invocation d'un monstre, ex. "Cendragon:
   * Invoque un(e) Cendragon" répété lors d'une resynchronisation, laissant une entrée périmée mais
   * toujours dans la fenêtre ; un mimique sans rapport rejoignant PENDANT cette rafale se faisait
   * avaler par cette entrée, FIFO ne vérifiant jamais que le nom correspondait). */
  pendingSummonCasters: {
    caster: string;
    timeMs: number;
    source: 'announce' | 'fallback';
    expectedName: string | null;
  }[];
  /** fighterId déjà vus dans CE combat (voir FightParseState.pendingSummonCasters) — distingue un
   * combattant réellement nouveau (candidat à consommer la file d'invocations en attente) d'une
   * simple resynchronisation ("[_FL_] ... join the fight" est réémis de nombreuses fois par
   * combattant au fil d'un même combat, pas seulement à son arrivée). */
  seenFighterIds: Set<number>;
}

function createFightParseState(): FightParseState {
  return {
    lastCast: null,
    lastDamage: null,
    effectOwners: new Map(),
    spellCasters: new Map(),
    summonOwners: new Map(),
    pendingSummonCasters: [],
    seenFighterIds: new Set(),
  };
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
  /**
   * `isKnownMonsterName` : prédicat optionnel injecté par l'appelant (voir StatsStoreService, seule
   * couche qui a accès au catalogue — LogParser reste volontairement pur/sans dépendance réseau ou
   * catalogue) — voir parseFighterJoin pour son unique usage : distinguer un vrai monstre catalogué
   * d'un nom d'invocation inconnu quand `INVOCATION_INSTANTIATED_RE` (repli SANS annonce "Invoque")
   * est sur le point de l'avaler à tort. Par défaut (tests, `new LogParser()` sans argument) toujours
   * `false` — comportement historique inchangé, aucune régression sur les ~200 tests existants qui ne
   * couvrent pas ce cas précis.
   */
  constructor(private readonly deps: { isKnownMonsterName?: (name: string) => boolean } = {}) {}

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

    if (INVOCATION_INSTANTIATED_RE.test(content)) {
      const state = this.getFightState(this.resolveCurrentFightId());
      const nowMs = this.timeToMs(time);
      const lastPending = state.pendingSummonCasters[state.pendingSummonCasters.length - 1];
      const justAnnounced =
        !!lastPending && nowMs - lastPending.timeMs <= ANNOUNCE_TO_INSTANTIATION_WINDOW_MS;
      if (!justAnnounced && state.lastCast) {
        state.pendingSummonCasters.push({
          caster: state.lastCast.caster,
          timeMs: nowMs,
          source: 'fallback',
          expectedName: null,
        });
      }
      return null;
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
    if (!join) return null;
    const fightId = Number(join[1]);
    const name = join[2].trim();
    const breed = Number(join[3]);
    const fighterId = Number(join[4]);
    const isControlledByAI = join[5] === 'true';

    // Voir FightParseState.summonOwners/pendingSummonCasters/seenFighterIds : une invocation déjà
    // connue de ce nom (rejointe une 1ʳᵉ fois, ou héritée d'une transformation, voir TRANSFORM_RE)
    // garde son invocateur ; sinon, un fighterId encore jamais vu dans CE combat, survenant dans la
    // fenêtre SUMMON_JOIN_WINDOW_MS suivant la plus ancienne annonce en attente, consomme celle-ci.
    const state = this.getFightState(fightId);
    const isNewFighter = !state.seenFighterIds.has(fighterId);
    state.seenFighterIds.add(fighterId);
    const joinTimeMs = this.timeToMs(time);
    while (
      state.pendingSummonCasters.length > 0 &&
      joinTimeMs - state.pendingSummonCasters[0].timeMs > SUMMON_JOIN_WINDOW_MS
    ) {
      // Annonce trop ancienne, jamais suivie d'une jointure dans la fenêtre : abandonnée (invocation
      // qui n'a en pratique jamais rejoint le combat, ou dont la jointure a été manquée) plutôt que
      // laissée bloquer indéfiniment la file pour toute future jointure sans rapport.
      state.pendingSummonCasters.shift();
    }
    let summonedBy = state.summonOwners.get(name) ?? null;
    if (!summonedBy && isNewFighter && state.pendingSummonCasters.length > 0) {
      // Cherche la plus ancienne entrée dont expectedName correspond (ou n'en a pas — voir sa doc)
      // PLUTÔT que de dépiler aveuglément la plus ancienne (FIFO pur) : une entrée dont le nom
      // attendu ne correspond PAS reste en file (une autre jointure la consommera peut-être plus
      // tard) au lieu d'être imposée à ce nouveau venu sans rapport — bug réel corrigé le 2026-08-31
      // (voir doc de SUMMON_ANNOUNCE_RE/pendingSummonCasters.expectedName).
      const matchIndex = state.pendingSummonCasters.findIndex(
        (p) => p.expectedName === null || p.expectedName.toLowerCase() === name.toLowerCase(),
      );
      if (matchIndex !== -1) {
        const [pending] = state.pendingSummonCasters.splice(matchIndex, 1);
        // Une entrée de source 'fallback' (voir sa doc) n'a AUCUNE preuve textuelle propre —
        // seulement une coïncidence temporelle avec la dernière ligne technique d'instanciation,
        // elle-même émise à l'identique pour un vrai monstre qui se révèle (ex. un mimique, voir
        // CLAUDE.md) que pour une authentique invocation. Un nom déjà catalogué comme vrai monstre
        // n'est donc jamais avalé par ce seul repli — sans conséquence sur le cas déjà géré par
        // 'announce' (annonce explicite "X: Invoque..."), qui reste appliqué sans condition : c'est
        // justement ce qui permet à une invocation de partager son nom avec un vrai monstre du même
        // combat (ex. "Chimère veilleuse").
        const isUnreliableFallbackOnRealMonster =
          pending.source === 'fallback' && (this.deps.isKnownMonsterName?.(name) ?? false);
        if (!isUnreliableFallbackOnRealMonster) {
          summonedBy = pending.caster;
          state.summonOwners.set(name, summonedBy);
        }
      }
    }

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

    return {
      kind: 'fighter-joined',
      time,
      fightId,
      name,
      breed,
      fighterId,
      isControlledByAI,
      summonedBy,
    };
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
      return {
        kind: 'challenge-result',
        time,
        name: challengeSuccess[1].trim(),
        success: true,
        fightId: this.resolveCurrentFightId(),
      };
    }
    const challengeFail = CHALLENGE_FAIL_RE.exec(content);
    if (challengeFail) {
      return {
        kind: 'challenge-result',
        time,
        name: challengeFail[1].trim(),
        success: false,
        fightId: this.resolveCurrentFightId(),
      };
    }
    return null;
  }

  private parseCombatLine(time: string, content: string): LogEntry | null {
    if (DEFEAT_MARKER_RE.test(content)) {
      // N'arme PLUS fightLostFlags (voir doc de DEFEAT_MARKER_RE) : un simple KO relevable ne
      // suffit pas à conclure à une défaite du combat entier.
      return { kind: 'combat-defeat-marker', time, fightId: this.resolveCurrentFightId() };
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

    const disappear = DISAPPEAR_RE.exec(content);
    if (disappear) {
      const name = disappear[1].trim();
      return { kind: 'enemy-fled', time, name, fightId: this.resolveFightIdForName(name) };
    }

    const summonAnnounce = SUMMON_ANNOUNCE_RE.exec(content);
    if (summonAnnounce) {
      const caster = summonAnnounce[1].trim();
      const expectedName = summonAnnounce[2]?.trim() ?? null;
      const fightId = this.resolveFightIdForName(caster);
      this.getFightState(fightId).pendingSummonCasters.push({
        caster,
        timeMs: this.timeToMs(time),
        source: 'announce',
        expectedName,
      });
      return null;
    }

    const transform = TRANSFORM_RE.exec(content);
    if (transform) {
      const from = transform[1].trim();
      const to = transform[2].trim();
      const state = this.getFightState(this.resolveFightIdForName(from));
      // Remonte jusqu'au sommet de la chaîne (voir resolveSummonRootOwner) plutôt qu'une seule
      // résolution : `from` peut lui-même être une invocation d'une AUTRE invocation (ex. Poupée
      // Lapino invoquée, puis évoluant) — propager l'invocateur RACINE évite le même piège que dans
      // resolveEffectTail (nom fantôme, jamais un vrai combattant du récap).
      const owner = this.resolveSummonRootOwner(state, from);
      if (owner) state.summonOwners.set(to, owner);
      return null;
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
   *
   * Dernière étape, commune à tous les appelants : si l'`attacker` résolu ci-dessus est le nom d'une
   * invocation connue de ce combat (voir FightParseState.summonOwners), l'action est réattribuée à
   * son invocateur avec le nom de l'invocation comme libellé de "sort" — ex. le Sadida "Fayto"
   * apparaît crédité d'un sort nommé "Dark Lapino" plutôt que "Dark Lapino" d'un sort nommé "Murmures
   * d'affaiblissement" (voir CLAUDE.md, section invocations : une invocation est traitée comme un
   * sort de son invocateur, jamais comme une entité séparée du combat).
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

    const rootOwner = this.resolveSummonRootOwner(state, attacker);
    if (rootOwner) {
      spell = attacker;
      attacker = rootOwner;
    }
    return { attacker, spell, element };
  }

  /**
   * Remonte la chaîne `summonOwners` jusqu'à son sommet (un nom qui n'est lui-même l'invocation de
   * personne) plutôt qu'une seule résolution — bug réel corrigé le 2026-08-24, cas "boss qui
   * réinstancie une invocation déjà connue via sa propre annonce Invoque" (ex. fichier Fayto,
   * fightId 1680001273 : "Glouto" — vrai ennemi, jamais lui-même une invocation — meurt puis
   * réapparaît via "Résidu: Invoque un(e) Glouto", "Résidu" étant DÉJÀ une invocation connue de
   * "Druidre" ; sans ce parcours, une seule résolution attribuait l'action à "Résidu" — qui n'a
   * lui-même jamais rejoint `fight.enemies`/`fight.allies` en tant qu'invocation — laissant
   * `attacker` pointer vers un nom fantôme, absent du récap mais réapparaissant comme ligne à part
   * via le repli de `buildEntityDamageRows`, CLAUDE.md). Garde anti-cycle (`visited`) au cas où deux
   * invocations finiraient par se désigner mutuellement comme invocateur (non observé en pratique,
   * mais `summonOwners` est alimenté par du texte de log, pas une structure garantie acyclique).
   * Renvoie `null` si `name` n'est l'invocation de personne (cas de très loin le plus fréquent).
   */
  private resolveSummonRootOwner(state: FightParseState, name: string): string | null {
    let current = name;
    let owner = state.summonOwners.get(current);
    if (!owner) return null;
    const visited = new Set<string>([current]);
    while (!visited.has(owner)) {
      visited.add(owner);
      current = owner;
      const next = state.summonOwners.get(current);
      if (!next) break;
      owner = next;
    }
    return owner;
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
    if (entry.kind === 'combat-end') {
      // Doublon multi-compte : chaque compte connecté au même combat loggue sa propre ligne
      // "[FIGHT] End fight with id N", mais `result` peut différer entre les deux occurrences —
      // `forgetFight` (voir parseContent) efface `fightLostFlags` dès la 1ʳᵉ occurrence traitée, donc
      // la 2ᵉ relit une défaite déjà oubliée et calcule à tort 'won'. Dédoublonner sur le seul
      // `fightId` (jamais sur `result`) : bug réel corrigé le 2026-08-25, un combat réellement perdu
      // (vaincu total de l'équipe, marqueurs [DEATH] confirmés) affiché comme gagné à cause de ce
      // 2e événement bogué qui écrasait le bon résultat dans StatsStoreService.
      delete (rest as { result?: unknown }).result;
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
