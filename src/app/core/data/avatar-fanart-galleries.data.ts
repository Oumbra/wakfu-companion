/**
 * Galeries d'avatars "Fan-Art" du compte Ankama (`https://account.ankama.com/fr/compte/profil/avatar`,
 * menu déroulant en haut de la sélection d'avatar) — en plus de la "Galerie MMO" (planche de classes
 * déjà gérée par `class-portraits.data.ts`). Chaque galerie est une simple plage d'ids numériques
 * contigus servis par `static.ankama.com/web-test/{id}.png` : la plage contient quelques trous (ids
 * sans image valide, constaté en pratique — le nombre d'images réellement affichées dans le compte
 * Ankama est inférieur à la taille de la plage) qui n'ont pas de liste séparée connue ; l'appelant
 * doit masquer au chargement les urls dont l'`<img>` échoue (voir profile-page.component, événement
 * `error`) plutôt que de coder en dur une liste d'ids valides.
 */

export type AvatarFanartGalleryId = 'barbottine' | 'hoopyon' | 'papetona';

export interface AvatarFanartGalleryDef {
  id: AvatarFanartGalleryId;
  /** Clé i18n du libellé affiché dans le switch (voir translations.ts). */
  labelKey: string;
  /** Plage d'ids (bornes incluses) sur `static.ankama.com/web-test/{id}.png`. */
  start: number;
  end: number;
}

export const AVATAR_FANART_GALLERIES: readonly AvatarFanartGalleryDef[] = [
  { id: 'barbottine', labelKey: 'profile.avatarGalleryBarbottine', start: 1101, end: 1133 },
  { id: 'hoopyon', labelKey: 'profile.avatarGalleryHoopyon', start: 203852, end: 203881 },
  { id: 'papetona', labelKey: 'profile.avatarGalleryPapetona', start: 203994, end: 204039 },
];

export function avatarFanartUrl(id: number): string {
  return `https://static.ankama.com/web-test/${id}.png`;
}

/** Toutes les urls (bornes incluses) d'une galerie fan-art, dans l'ordre croissant. */
export function avatarFanartUrls(gallery: AvatarFanartGalleryDef): readonly string[] {
  const urls: string[] = [];
  for (let id = gallery.start; id <= gallery.end; id++) {
    urls.push(avatarFanartUrl(id));
  }
  return urls;
}

/** Galerie fan-art dont la plage contient cette url (repli `undefined` si absente/hors plage,
 * ex. url appartenant à la "Galerie MMO" ou invalide) — sert à présélectionner le switch sur la
 * bonne galerie au chargement de la page profil, à partir du seul avatar externe déjà enregistré. */
export function findAvatarFanartGallery(url: string | null): AvatarFanartGalleryDef | undefined {
  if (!url) return undefined;
  const match = /^https:\/\/static\.ankama\.com\/web-test\/(\d+)\.png$/.exec(url);
  if (!match) return undefined;
  const id = Number(match[1]);
  return AVATAR_FANART_GALLERIES.find((g) => id >= g.start && id <= g.end);
}
