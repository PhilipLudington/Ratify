import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { handleRequest, type DoormanEnv } from '../src/worker/doorman';
import { COOKIE_NAME } from '../src/worker/session';

const PASSPHRASE = 'open-the-log';

const doormanEnv: DoormanEnv = {
  LOG: env.LOG,
  DEMO_PASSPHRASE: PASSPHRASE,
  SESSION_SECRET: 'test-secret-not-the-real-one',
};

function request(path: string, init: RequestInit = {}, cookie?: string): Request {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`https://ratify.example/api${path}`, { ...init, headers });
}

/** The `name=value` pair a browser would send back. */
function cookieFrom(response: Response): string {
  const header = response.headers.get('Set-Cookie');
  expect(header).toBeTruthy();
  return header!.split(';')[0]!;
}

async function authenticate(): Promise<string> {
  const response = await handleRequest(
    request('/auth', { method: 'POST', body: JSON.stringify({ passphrase: PASSPHRASE }) }),
    doormanEnv,
  );
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe('the gate', () => {
  it('turns away a request with no cookie and no passphrase', async () => {
    const response = await handleRequest(request('/ping'), doormanEnv);
    expect(response.status).toBe(401);
  });

  it('turns away the wrong passphrase', async () => {
    const response = await handleRequest(
      request('/auth', { method: 'POST', body: JSON.stringify({ passphrase: 'guess' }) }),
      doormanEnv,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('turns away an empty passphrase even if the secret were empty', async () => {
    const response = await handleRequest(
      request('/auth', { method: 'POST', body: JSON.stringify({ passphrase: '' }) }),
      doormanEnv,
    );
    expect(response.status).toBe(401);
  });

  it('issues a signed cookie for the right passphrase', async () => {
    const cookie = await authenticate();
    expect(cookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
  });

  // These cost three deploys and a lot of confusion to find. An interactive
  // `wrangler secret put` can capture a trailing newline, and a passphrase
  // copied out of submission notes arrives with a space on the end. Both look
  // exactly like a wrong passphrase from outside.
  it('accepts the passphrase when the stored secret has stray whitespace', async () => {
    const response = await handleRequest(
      request('/auth', { method: 'POST', body: JSON.stringify({ passphrase: PASSPHRASE }) }),
      { ...doormanEnv, DEMO_PASSPHRASE: `${PASSPHRASE}\n` },
    );
    expect(response.status).toBe(200);
  });

  it('accepts the passphrase when the submitted value has stray whitespace', async () => {
    const response = await handleRequest(
      request('/auth', { method: 'POST', body: JSON.stringify({ passphrase: ` ${PASSPHRASE} ` }) }),
      doormanEnv,
    );
    expect(response.status).toBe(200);
  });

  it('still refuses a wrong passphrase that only looks close', async () => {
    const response = await handleRequest(
      request('/auth', { method: 'POST', body: JSON.stringify({ passphrase: `${PASSPHRASE}x` }) }),
      doormanEnv,
    );
    expect(response.status).toBe(401);
  });

  it('treats a whitespace-only secret as unset rather than as a passphrase', async () => {
    const response = await handleRequest(request('/ping'), {
      ...doormanEnv,
      DEMO_PASSPHRASE: '   ',
    });
    expect(response.status).toBe(500);
  });

  it('refuses to run at all when its secrets are unset', async () => {
    const response = await handleRequest(request('/ping'), {
      ...doormanEnv,
      DEMO_PASSPHRASE: '',
    });
    expect(response.status).toBe(500);
  });

  it('rejects a cookie whose signature does not hold', async () => {
    const cookie = await authenticate();
    const tampered = `${COOKIE_NAME}=${'0'.repeat(32)}.${cookie.split('.')[1]}`;

    const response = await handleRequest(request('/ping', {}, tampered), doormanEnv);
    expect(response.status).toBe(401);
  });
});

describe('session state', () => {
  it('reports no session before authenticating', async () => {
    const response = await handleRequest(request('/session'), doormanEnv);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('reports a session afterwards', async () => {
    const response = await handleRequest(request('/session', {}, await authenticate()), doormanEnv);
    expect(await response.json()).toEqual({ authenticated: true });
  });

  it('clears the cookie on logout', async () => {
    const response = await handleRequest(
      request('/logout', { method: 'POST' }, await authenticate()),
      doormanEnv,
    );
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});

describe('forwarding to the log', () => {
  // The Phase 0 gate in full: gate → cookie → Durable Object → storage →
  // back out through a second request.
  it('carries a write on one request into a read on the next', async () => {
    const cookie = await authenticate();

    const write = await handleRequest(
      request('/ping', { method: 'POST', body: JSON.stringify({ note: 'adopt ADRs' }) }, cookie),
      doormanEnv,
    );
    expect(write.status).toBe(200);

    const read = await handleRequest(request('/ping', {}, cookie), doormanEnv);
    const body = (await read.json()) as { ping: { note: string } | null };
    expect(body.ping?.note).toBe('adopt ADRs');
  });

  it('sends two sessions to two different logs', async () => {
    const alice = await authenticate();
    const bob = await authenticate();
    expect(alice).not.toBe(bob);

    await handleRequest(
      request('/ping', { method: 'POST', body: JSON.stringify({ note: 'alice' }) }, alice),
      doormanEnv,
    );
    await handleRequest(
      request('/ping', { method: 'POST', body: JSON.stringify({ note: 'bob' }) }, bob),
      doormanEnv,
    );

    const aliceRead = (await (
      await handleRequest(request('/ping', {}, alice), doormanEnv)
    ).json()) as { log: string; ping: { note: string } | null };
    const bobRead = (await (await handleRequest(request('/ping', {}, bob), doormanEnv)).json()) as {
      log: string;
      ping: { note: string } | null;
    };

    expect(aliceRead.ping?.note).toBe('alice');
    expect(bobRead.ping?.note).toBe('bob');
    expect(aliceRead.log).not.toBe(bobRead.log);
  });

  it('passes a 404 from the log through rather than inventing one', async () => {
    const response = await handleRequest(request('/nope', {}, await authenticate()), doormanEnv);
    expect(response.status).toBe(404);
  });
});
