/**
 * Normalise un nom d'objet/monstre pour les recherches dans le catalogue
 * (voir core/api/catalog.service.ts) : minuscule, espaces superflus
 * retirés, apostrophes typographiques (’‘)
 * uniformisées en apostrophe droite ('), accents retirés (le "é" de
 * "Éclat" ne doit pas empêcher de le trouver en tapant "eclat") — le
 * référentiel Ankama source mélange les deux formes d'apostrophe selon
 * l'objet (ex. "Bague d'El Pochito" vs "Masque d’El Pochito"), alors que
 * les noms lus dans wakfu.log utilisent toujours l'apostrophe droite.
 */
export function normalizeWakfuName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[’‘]/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
