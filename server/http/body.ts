/**
 * Lecture bornée du corps d'une requête — remplace le motif `await request.text(); if (raw.length >
 * MAX)`, qui avait deux défauts :
 *
 * 1. le corps ENTIER était lu en mémoire avant la moindre vérification — un appelant pouvait donc
 *    faire bufferiser des dizaines de Mo à la fonction avant d'être refusé ;
 * 2. `raw.length` compte des unités UTF-16, pas des octets : une charge utile de caractères
 *    multi-octets dépassait silencieusement la borne annoncée (jusqu'à ×3).
 *
 * Ici : refus immédiat (413) sur un `Content-Length` déclaré au-delà de la borne, puis lecture en
 * flux avec un plafond en OCTETS — le flux est abandonné (`cancel`) dès que la borne est franchie,
 * même si `Content-Length` est absent (transfert `chunked`) ou mensonger.
 *
 * Pur (ne dépend que de `Request`/`ReadableStream`/`TextDecoder`, natifs au runtime Workers comme
 * à Node ≥ 18) : testé dans `body.spec.ts`.
 */

export type BodyReadResult =
  { ok: true; text: string } | { ok: false; status: 400 | 413; error: string };

export type JsonBodyResult =
  | { ok: true; value: unknown; /** Taille lue, en octets UTF-8. */ bytes: number }
  | { ok: false; status: 400 | 413; error: string };

const TOO_LARGE_ERROR = 'corps de requête trop volumineux';

/**
 * Lit le corps de `request` comme texte UTF-8, sans jamais dépasser `maxBytes` octets en mémoire
 * (à un segment de flux près). `413` si la borne est dépassée, `400` si le flux échoue en cours de
 * lecture (connexion coupée côté client).
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) {
    return { ok: false, status: 413, error: TOO_LARGE_ERROR };
  }

  const body = request.body;
  if (body === null) return { ok: true, text: '' };

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value as Uint8Array;
      received += chunk.byteLength;
      if (received > maxBytes) {
        // Libère la connexion sans lire le reste : c'est tout l'intérêt de la lecture en flux.
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: TOO_LARGE_ERROR };
      }
      text += decoder.decode(chunk, { stream: true });
    }
  } catch {
    return { ok: false, status: 400, error: 'corps de requête illisible' };
  }
  text += decoder.decode();
  return { ok: true, text };
}

/** `readBodyLimited` + `JSON.parse` — `400` sur un JSON invalide, jamais une exception. */
export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const raw = await readBodyLimited(request, maxBytes);
  if (!raw.ok) return raw;
  try {
    return {
      ok: true,
      value: JSON.parse(raw.text) as unknown,
      bytes: new TextEncoder().encode(raw.text).byteLength,
    };
  } catch {
    return { ok: false, status: 400, error: 'corps JSON invalide' };
  }
}
