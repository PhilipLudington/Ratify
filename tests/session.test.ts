import { describe, expect, it } from 'vitest';

import {
  COOKIE_NAME,
  newSessionId,
  readSessionCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
} from '../src/worker/session';

const SECRET = 'test-secret-not-the-real-one';

describe('session identifiers', () => {
  it('produces 128 bits of lowercase hex', () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, newSessionId));
    expect(ids.size).toBe(200);
  });
});

describe('cookie signing', () => {
  it('round-trips a session ID', async () => {
    const id = newSessionId();
    expect(await verifySession(await signSession(id, SECRET), SECRET)).toBe(id);
  });

  // The session ID is the Durable Object's address, so a forged cookie would
  // be a forged log address. These are the cases that must not survive.
  it('rejects a tampered session ID', async () => {
    const token = await signSession(newSessionId(), SECRET);
    const [id, signature] = token.split('.');
    const forged = `${'0'.repeat(32)}.${signature}`;

    expect(forged).not.toBe(token);
    expect(id).toBeDefined();
    expect(await verifySession(forged, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(newSessionId(), 'some-other-secret');
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it('rejects an unsigned session ID', async () => {
    expect(await verifySession(newSessionId(), SECRET)).toBeNull();
  });

  it('rejects a session ID that is not the shape we issue', async () => {
    const token = await signSession('log:phil-main', SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it('rejects junk', async () => {
    for (const junk of ['', '.', 'abc', '.sig', `${'0'.repeat(32)}.`]) {
      expect(await verifySession(junk, SECRET)).toBeNull();
    }
  });
});

describe('cookie headers', () => {
  it('reads its own cookie back off a request', () => {
    const request = new Request('https://ratify.example/api/session', {
      headers: { Cookie: serializeSessionCookie('token-value').split(';')[0]! },
    });
    expect(readSessionCookie(request)).toBe('token-value');
  });

  it('finds the cookie among others', () => {
    const request = new Request('https://ratify.example/api/session', {
      headers: { Cookie: `other=1; ${COOKIE_NAME}=token-value; another=2` },
    });
    expect(readSessionCookie(request)).toBe('token-value');
  });

  it('returns null when absent', () => {
    const bare = new Request('https://ratify.example/api/session');
    expect(readSessionCookie(bare)).toBeNull();

    const unrelated = new Request('https://ratify.example/api/session', {
      headers: { Cookie: 'other=1' },
    });
    expect(readSessionCookie(unrelated)).toBeNull();
  });

  it('marks the cookie HttpOnly, Secure and SameSite', () => {
    const cookie = serializeSessionCookie('token-value');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });
});
