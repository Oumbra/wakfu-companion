import { describe, expect, it } from 'vitest';
import {
  TURNSTILE_ACTION,
  TURNSTILE_SITEVERIFY_URL,
  isTurnstileTestSecret,
  verifyTurnstileToken,
} from './turnstile';

const HOSTS = new Set(['wakfu-companion.com']);
const SECRET = 'secret-reel';

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('vérification Turnstile (siteverify)', () => {
  it('accepte un jeton validé pour la bonne action et un hôte attendu', async () => {
    const result = await verifyTurnstileToken({
      secret: SECRET,
      token: 'jeton',
      remoteIp: '203.0.113.7',
      expectedHostnames: HOSTS,
      fetchImpl: fetchReturning({
        success: true,
        action: TURNSTILE_ACTION,
        hostname: 'wakfu-companion.com',
      }),
    });
    expect(result).toEqual({ ok: true, hostname: 'wakfu-companion.com' });
  });

  it('transmet secret, jeton et IP en formulaire', async () => {
    let sent = '';
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response(
        JSON.stringify({
          success: true,
          action: TURNSTILE_ACTION,
          hostname: 'wakfu-companion.com',
        }),
      );
    }) as typeof fetch;
    await verifyTurnstileToken({
      secret: SECRET,
      token: 'jeton',
      remoteIp: '203.0.113.7',
      expectedHostnames: HOSTS,
      fetchImpl,
    });
    const params = new URLSearchParams(sent);
    expect(params.get('secret')).toBe(SECRET);
    expect(params.get('response')).toBe('jeton');
    expect(params.get('remoteip')).toBe('203.0.113.7');
  });

  it('refuse un jeton absent, vide ou trop long sans appeler siteverify', async () => {
    const neverCalled = (async () => {
      throw new Error('ne doit pas être appelé');
    }) as unknown as typeof fetch;
    for (const token of [undefined, null, '', 'x'.repeat(2049), 42]) {
      const result = await verifyTurnstileToken({
        secret: SECRET,
        token,
        remoteIp: null,
        expectedHostnames: HOSTS,
        fetchImpl: neverCalled,
      });
      expect(result).toEqual({ ok: false, reason: 'missing_token', errorCodes: [] });
    }
  });

  it('refuse (fail closed) sur success:false, action ou hôte inattendus', async () => {
    const base = { secret: SECRET, token: 'jeton', remoteIp: null, expectedHostnames: HOSTS };
    expect(
      await verifyTurnstileToken({
        ...base,
        fetchImpl: fetchReturning({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
      }),
    ).toEqual({ ok: false, reason: 'rejected', errorCodes: ['timeout-or-duplicate'] });
    expect(
      await verifyTurnstileToken({
        ...base,
        fetchImpl: fetchReturning({
          success: true,
          action: 'login',
          hostname: 'wakfu-companion.com',
        }),
      }),
    ).toEqual({ ok: false, reason: 'action_mismatch', errorCodes: [] });
    expect(
      await verifyTurnstileToken({
        ...base,
        fetchImpl: fetchReturning({
          success: true,
          action: TURNSTILE_ACTION,
          hostname: 'evil.example',
        }),
      }),
    ).toEqual({ ok: false, reason: 'hostname_mismatch', errorCodes: [] });
  });

  it('refuse (fail closed) sur erreur réseau, statut non 2xx ou corps non JSON', async () => {
    const base = { secret: SECRET, token: 'jeton', remoteIp: null, expectedHostnames: HOSTS };
    const throwing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect((await verifyTurnstileToken({ ...base, fetchImpl: throwing })).ok).toBe(false);
    expect((await verifyTurnstileToken({ ...base, fetchImpl: fetchReturning({}, 502) })).ok).toBe(
      false,
    );
    const notJson = (async () =>
      new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect((await verifyTurnstileToken({ ...base, fetchImpl: notJson })).ok).toBe(false);
  });

  it('relâche action et hôte pour les seuls secrets de test Cloudflare', async () => {
    expect(isTurnstileTestSecret('1x0000000000000000000000000000000AA')).toBe(true);
    expect(isTurnstileTestSecret('2x0000000000000000000000000000000AA')).toBe(true);
    expect(isTurnstileTestSecret(SECRET)).toBe(false);
    const result = await verifyTurnstileToken({
      secret: '1x0000000000000000000000000000000AA',
      token: 'XXXX.DUMMY.TOKEN.XXXX',
      remoteIp: null,
      expectedHostnames: HOSTS,
      fetchImpl: fetchReturning({ success: true, action: '', hostname: 'example.com' }),
    });
    expect(result).toEqual({ ok: true, hostname: 'example.com' });
  });
});
