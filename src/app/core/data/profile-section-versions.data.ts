import { ProfileTab } from '../services/navigation.service';

/**
 * Version courante de chaque section de la page profil (rail desktop — voir
 * `NewSectionBadgeService`/CLAUDE.md). N'inclut délibérément QUE les `ProfileTab` : mentions
 * légales et politique de confidentialité (`AppView` 'legal', pas un `ProfileTab`) n'ont jamais de
 * badge "new", elles n'apparaissent même pas dans ce type.
 *
 * Incrémenter la version d'une section fait réapparaître son badge "new" (rail + avatar du header,
 * desktop uniquement) pour tout utilisateur qui l'avait déjà visitée à une version antérieure —
 * c'est le mécanisme à utiliser pour signaler une nouveauté/un changement notable dans cette
 * section. Ne toucher QUE la ou les entrées concernées par le changement en cours ; les autres
 * restent à leur valeur (un utilisateur qui a déjà vu une section ne doit pas revoir son badge pour
 * un changement ailleurs).
 */
export const PROFILE_SECTION_VERSIONS: Record<ProfileTab, number> = {
  avatar: 1,
  customization: 1,
  colorblind: 1,
  connection: 1,
  alerts: 1,
  characters: 1,
};
