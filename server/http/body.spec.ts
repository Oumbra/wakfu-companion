import { describe, expect, it } from 'vitest';
import { readBodyLimited, readJsonBodyLimited } from './body';

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api', { method: 'POST', body, headers });
}

/** Flux « chunked » (sans Content-Length), qui compte les segments effectivement lus. */
function streamingRequest(chunks: Uint8Array[]): { request: Request; pulled: () => number } {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  });
  const request = new Request('https://example.test/api', {
    method: 'POST',
    body: stream,
    // Requis par Node pour un corps en flux ; sans effet sur le runtime Workers.
    duplex: 'half',
  } as RequestInit);
  return { request, pulled: () => index };
}

describe('readBodyLimited', () => {
  it('lit un corps sous la borne', async () => {
    expect(await readBodyLimited(post('{"a":1}'), 100)).toEqual({ ok: true, text: '{"a":1}' });
  });

  it('renvoie une chaîne vide sans corps', async () => {
    const request = new Request('https://example.test/api', { method: 'POST' });
    expect(await readBodyLimited(request, 10)).toEqual({ ok: true, text: '' });
  });

  it('refuse d’emblée un Content-Length déclaré au-delà de la borne (413)', async () => {
    const request = post('x', { 'content-length': '1000000' });
    const result = await readBodyLimited(request, 10);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('compte des OCTETS, pas des unités UTF-16', async () => {
    // 4 caractères « é » = 4 unités UTF-16, mais 8 octets UTF-8.
    expect(await readBodyLimited(post('éééé'), 8)).toEqual({ ok: true, text: 'éééé' });
    expect(await readBodyLimited(post('éééé'), 7)).toMatchObject({ ok: false, status: 413 });
  });

  it('décode correctement un caractère multi-octets coupé entre deux segments', async () => {
    const bytes = new TextEncoder().encode('aé');
    const { request } = streamingRequest([bytes.slice(0, 2), bytes.slice(2)]);
    expect(await readBodyLimited(request, 10)).toEqual({ ok: true, text: 'aé' });
  });

  it('abandonne un flux sans Content-Length dès que la borne est franchie', async () => {
    const chunk = new Uint8Array(1024).fill(0x61);
    const { request, pulled } = streamingRequest(Array.from({ length: 100 }, () => chunk));
    const result = await readBodyLimited(request, 4096);
    expect(result).toMatchObject({ ok: false, status: 413 });
    // Lecture interrompue bien avant la fin du flux (100 segments).
    expect(pulled()).toBeLessThan(10);
  });
});

describe('readJsonBodyLimited', () => {
  it('analyse un JSON valide', async () => {
    expect(await readJsonBodyLimited(post('{"entries":[]}'), 100)).toEqual({
      ok: true,
      value: { entries: [] },
    });
  });

  it('400 sur un JSON invalide, 413 au-delà de la borne', async () => {
    expect(await readJsonBodyLimited(post('{'), 100)).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBodyLimited(post('[1,2,3]'), 3)).toMatchObject({
      ok: false,
      status: 413,
    });
  });
});
