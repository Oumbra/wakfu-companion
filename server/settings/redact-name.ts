/**
 * Retrait d'un pseudonyme de joueur dans une valeur de configuration synchronisée
 * (`user_settings.value`, du `jsonb` opaque côté serveur).
 *
 * Raison d'être : la politique de confidentialité (§1.3) promet à tout joueur tiers le retrait de
 * son pseudonyme de nos bases sur simple demande (RGPD art. 17 et 21 — droit d'opposition à un
 * traitement fondé sur l'intérêt légitime). Deux des onze clés synchronisées peuvent porter le
 * pseudonyme d'un AUTRE joueur que le titulaire du compte :
 *
 * - `chatFilters` : `[{ text, channel }]` — le texte d'un filtre est libre, donc parfois un pseudo ;
 * - `damageReassignments` : `[{ fightId, spellName, from: { name }, to: { name } }]` — `name` est
 *   un nom de personnage, qui peut être celui d'un allié tiers.
 *
 * (`watchlist` ne porte que des noms de monstres et d'objets, `itemReassignments` que des clés de
 * contenu et des noms d'objets, `profile`/`roster` que les personnages du titulaire — voir
 * `user-data.keys.ts`. Ce module ne présume toutefois d'AUCUN schéma : il parcourt la valeur telle
 * quelle, ce qui le laisse correct si une clé change de forme ou si une nouvelle clé arrive.)
 *
 * Stratégie : le pseudonyme est retiré au grain le PLUS FIN — chaque tableau est d'abord nettoyé en
 * profondeur, puis un élément n'est retiré que s'il porte ENCORE le pseudonyme une fois ses propres
 * enfants nettoyés (un filtre de chat sur un pseudo, une correction d'attribution qui le nomme,
 * n'ont plus d'objet une fois le pseudonyme retiré). Sans cet ordre, un personnage nommé dans une
 * liste imbriquée emporterait tout le compte qui le contient. Une occurrence qui subsiste faute de
 * pouvoir être retirée seule — le champ d'un objet racine, par exemple — n'est jamais réécrite en
 * silence : elle est comptée dans `residual` et remontée à l'opérateur, qui tranche. Mieux vaut une
 * demande traitée à la main qu'une valeur mutilée automatiquement.
 *
 * La comparaison est insensible à la casse et aux espaces de bord, comme le filtrage du chat côté
 * client (`matchesFilterText`, chat-panel.service.ts, compare en minuscules) ; jamais une
 * comparaison « contient », qui retirerait « Bobby » pour une demande de « Bob ».
 */

export interface RedactionResult<T = unknown> {
  /** La valeur nettoyée — la même référence si rien n'a changé. */
  value: T;
  /** Nombre d'éléments de tableau retirés. */
  removed: number;
  /** Occurrences du pseudonyme laissées en place faute de pouvoir les retirer seules (voir ci-dessus). */
  residual: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** `true` si `value` contient, quelque part, une chaîne égale au pseudonyme. */
export function containsName(value: unknown, name: string): boolean {
  const target = normalize(name);
  const walk = (node: unknown): boolean => {
    if (typeof node === 'string') return normalize(node) === target;
    if (Array.isArray(node)) return node.some(walk);
    if (node && typeof node === 'object') return Object.values(node).some(walk);
    return false;
  };
  return walk(value);
}

/**
 * Retire `name` de `value`. Voir la doc de tête pour la stratégie ; `value` n'est jamais mutée
 * (copie uniquement des branches modifiées).
 */
export function redactName<T>(value: T, name: string): RedactionResult<T> {
  const target = normalize(name);
  let removed = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const kept: unknown[] = [];
      for (const item of node) {
        // Nettoyer l'élément AVANT de décider de son sort : ce qui n'est nommé qu'en profondeur
        // est retiré là où il se trouve, sans emporter l'élément qui le contient.
        const cleaned = walk(item);
        if (containsName(cleaned, name)) {
          removed += 1;
          continue;
        }
        kept.push(cleaned);
      }
      return kept;
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) out[key] = walk(child);
      return out;
    }
    return node;
  };

  const result = walk(value) as T;

  // Ce qui reste après nettoyage, et qu'aucun retrait d'élément ne pouvait emporter.
  let residual = 0;
  const count = (node: unknown): void => {
    if (typeof node === 'string') {
      if (normalize(node) === target) residual += 1;
    } else if (Array.isArray(node)) node.forEach(count);
    else if (node && typeof node === 'object') Object.values(node).forEach(count);
  };
  count(result);

  return { value: removed === 0 && residual === 0 ? value : result, removed, residual };
}
