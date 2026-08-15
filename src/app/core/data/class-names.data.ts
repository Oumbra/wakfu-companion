import { AppLocale } from '../services/i18n.service';

/**
 * Noms de classe localisés (18 classes) — PAS dérivables de la clé interne
 * (`class-icons.data.ts`, proche de l'anglais) par simple capitalisation : plusieurs classes ont un
 * nom radicalement différent selon la langue (ex. `zobal` = "Masqueraider" en anglais, `rogue` =
 * "Tymador" en espagnol/"Ladino" en portugais, `foggernaut` = "Steamer" en français/espagnol/
 * portugais). Relevé manuellement le 2026-08-15 sur l'encyclopédie officielle Ankama (une page par
 * langue, chemin différent selon la locale) :
 * - fr: https://www.wakfu.com/fr/mmorpg/encyclopedie/classes
 * - en: https://www.wakfu.com/en/mmorpg/encyclopedia/classes
 * - es: https://www.wakfu.com/es/mmorpg/enciclopedia/clases
 * - pt: https://www.wakfu.com/pt/mmorpg/enciclopedia/classes
 * À réviser si Ankama renomme une classe dans une de ces langues.
 */
export const CLASS_NAMES: Readonly<Record<string, Readonly<Record<AppLocale, string>>>> = {
  cra: { fr: 'Crâ', en: 'Cra', es: 'Ocra', pt: 'Cra' },
  ecaflip: { fr: 'Ecaflip', en: 'Ecaflip', es: 'Zurcarák', pt: 'Ecaflip' },
  eliotrope: { fr: 'Eliotrope', en: 'Eliotrope', es: 'Selotrop', pt: 'Eliotrope' },
  eniripsa: { fr: 'Eniripsa', en: 'Eniripsa', es: 'Aniripsa', pt: 'Eniripsa' },
  enutrof: { fr: 'Enutrof', en: 'Enutrof', es: 'Anutrof', pt: 'Enutrof' },
  feca: { fr: 'Féca', en: 'Feca', es: 'Feca', pt: 'Feca' },
  foggernaut: { fr: 'Steamer', en: 'Foggernaut', es: 'Steamer', pt: 'Steamer' },
  huppermage: { fr: 'Huppermage', en: 'Huppermage', es: 'Hipermago', pt: 'Huppermago' },
  iop: { fr: 'Iop', en: 'Iop', es: 'Yopuka', pt: 'Iop' },
  osamodas: { fr: 'Osamodas', en: 'Osamodas', es: 'Osamodas', pt: 'Osamodas' },
  ouginak: { fr: 'Ouginak', en: 'Ouginak', es: 'Uginak', pt: 'Kilorf' },
  pandawa: { fr: 'Pandawa', en: 'Pandawa', es: 'Pandawa', pt: 'Pandawa' },
  rogue: { fr: 'Roublard', en: 'Rogue', es: 'Tymador', pt: 'Ladino' },
  sacrier: { fr: 'Sacrieur', en: 'Sacrier', es: 'Sacrógrito', pt: 'Sacrier' },
  sadida: { fr: 'Sadida', en: 'Sadida', es: 'Sadida', pt: 'Sadida' },
  sram: { fr: 'Sram', en: 'Sram', es: 'Sram', pt: 'Sram' },
  xelor: { fr: 'Xélor', en: 'Xelor', es: 'Xelor', pt: 'Xelor' },
  zobal: { fr: 'Zobal', en: 'Masqueraider', es: 'Zobal', pt: 'Zobal' },
};

/** Nom de classe localisé pour la locale donnée — repli sur la clé interne capitalisée si la
 * classe est absente de la table (`className` inconnu) ou vide/non renseignée. */
export function getClassName(className: string | undefined, locale: AppLocale): string {
  if (!className) return '';
  const entry = CLASS_NAMES[className];
  if (entry?.[locale]) return entry[locale];
  return className.charAt(0).toUpperCase() + className.slice(1);
}
