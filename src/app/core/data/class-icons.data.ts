/**
 * Icônes de classe (source : site de référence, public/assets/img/classes/),
 * servies en fichiers statiques depuis public/assets/classes/ (noms hashés
 * pour un cache navigateur immuable — régénérer le hash si le fichier change)
 * plutôt qu'embarquées en base64 : l'app n'a plus de contrainte de
 * fonctionnement 100% hors-ligne (voir docs/plan-migration-serveur.md).
 */
export type Gender = 'm' | 'f';

export const CLASS_ICON_DATA_URI: Readonly<Record<string, string>> = {
  cra: '/assets/classes/cra-m-6b6816dc.png',
  ecaflip: '/assets/classes/ecaflip-m-d84eff73.png',
  eliotrope: '/assets/classes/eliotrope-m-d9c53f18.png',
  eniripsa: '/assets/classes/eniripsa-m-36885287.png',
  enutrof: '/assets/classes/enutrof-m-03f5dda9.png',
  feca: '/assets/classes/feca-m-ba01fa55.png',
  foggernaut: '/assets/classes/foggernaut-m-f8a16961.png',
  huppermage: '/assets/classes/huppermage-m-2043b589.png',
  iop: '/assets/classes/iop-m-db2cc41a.png',
  osamodas: '/assets/classes/osamodas-m-a3acab12.png',
  ouginak: '/assets/classes/ouginak-m-4a975ef7.png',
  pandawa: '/assets/classes/pandawa-m-1231fbcb.png',
  rogue: '/assets/classes/rogue-m-eee88654.png',
  sacrier: '/assets/classes/sacrier-m-37afa15a.png',
  sadida: '/assets/classes/sadida-m-eee765bc.png',
  sram: '/assets/classes/sram-m-021deb0f.png',
  xelor: '/assets/classes/xelor-m-ef1fc207.png',
  zobal: '/assets/classes/zobal-m-c69b1a16.png',
};

/** Icône générique de repli (classe/monstre inconnu ou hors-ligne). */
export const UNKNOWN_ENTITY_ICON_DATA_URI = '/assets/ui/unknown-entity-236e6908.png';
/**
 * Icônes de classe féminines (source : site de référence,
 * public/assets/img/classes/, suffixe -f). Même jeu de clés que
 * CLASS_ICON_DATA_URI.
 */
export const CLASS_ICON_FEMALE_DATA_URI: Readonly<Record<string, string>> = {
  cra: '/assets/classes/cra-f-0a487098.png',
  ecaflip: '/assets/classes/ecaflip-f-98113853.png',
  eliotrope: '/assets/classes/eliotrope-f-5a37dcf7.png',
  eniripsa: '/assets/classes/eniripsa-f-25ccb06b.png',
  enutrof: '/assets/classes/enutrof-f-ed146aa3.png',
  feca: '/assets/classes/feca-f-9df3a0fe.png',
  foggernaut: '/assets/classes/foggernaut-f-e86414ab.png',
  huppermage: '/assets/classes/huppermage-f-6e372c28.png',
  iop: '/assets/classes/iop-f-b8c1292c.png',
  osamodas: '/assets/classes/osamodas-f-667cfe5d.png',
  ouginak: '/assets/classes/ouginak-f-be1213a2.png',
  pandawa: '/assets/classes/pandawa-f-30e4822c.png',
  rogue: '/assets/classes/rogue-f-e86482a1.png',
  sacrier: '/assets/classes/sacrier-f-1fc54563.png',
  sadida: '/assets/classes/sadida-f-8898fbbb.png',
  sram: '/assets/classes/sram-f-9de7c5f8.png',
  xelor: '/assets/classes/xelor-f-bbe3da3f.png',
  zobal: '/assets/classes/zobal-f-19b6d889.png',
};

/** URI de l'icône de classe pour ce nom (repli sur l'icône masculine si la
 * classe n'a pas d'icône féminine dédiée), 'inconnu' si `className` absent. */
export function getClassIconUri(className: string | undefined, gender: Gender): string {
  if (!className) return UNKNOWN_ENTITY_ICON_DATA_URI;
  const icons = gender === 'f' ? CLASS_ICON_FEMALE_DATA_URI : CLASS_ICON_DATA_URI;
  return icons[className] || CLASS_ICON_DATA_URI[className] || UNKNOWN_ENTITY_ICON_DATA_URI;
}
