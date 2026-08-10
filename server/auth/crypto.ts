/**
 * Primitives cryptographiques de l'authentification (lot 5, prompt 5.1).
 *
 * Tout passe par la WebCrypto standard (`crypto.getRandomValues`,
 * `crypto.subtle.digest`), disponible telle quelle dans le runtime Workers
 * comme dans Node ≥ 18 — aucune dépendance npm ajoutée, et le même code est
 * testable hors edge (voir server/auth/*.spec.ts).
 */

/** Encode des octets en base64url (RFC 4648 §5) — sans `=`, `+`, `/`. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Jeton opaque aléatoire. 32 octets = 256 bits d'entropie, exigence du §7 du plan. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** SHA-256 hexadécimal — sert à ne stocker en base que l'empreinte du jeton de session. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Challenge PKCE S256 associé à un `code_verifier`. */
export async function pkceChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Comparaison à temps constant de deux chaînes ASCII (jeton CSRF, jeton de
 * service). Une comparaison `===` classique s'arrête au premier caractère
 * différent : la durée de l'appel fuit alors le préfixe correct.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
