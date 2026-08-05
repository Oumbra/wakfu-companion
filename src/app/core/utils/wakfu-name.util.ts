/**
 * Normalise un nom d'objet/monstre pour les recherches dans les
 * référentiels (wakfu-items.data.ts, wakfu-monsters.data.ts, etc.) :
 * minuscule, espaces superflus retirés, apostrophes typographiques (’‘)
 * uniformisées en apostrophe droite (') — le référentiel Ankama source
 * mélange les deux formes selon l'objet (ex. "Bague d'El Pochito" vs
 * "Masque d’El Pochito"), alors que les noms lus dans wakfu.log utilisent
 * toujours l'apostrophe droite.
 */
export function normalizeWakfuName(name: string): string {
  return name.toLowerCase().trim().replace(/[’‘]/g, "'");
}
