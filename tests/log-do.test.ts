import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { PingRecord } from '../src/do/LogDO';

interface PingResponse {
  log: string;
  ping: PingRecord | null;
}

/** Address a log the way the doorman does, so tests exercise real naming. */
function log(sessionId: string) {
  return env.LOG.get(env.LOG.idFromName(`sandbox:${sessionId}`));
}

async function writeNote(sessionId: string, note: string): Promise<PingResponse> {
  const response = await log(sessionId).fetch('https://log.ratify.internal/ping', {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function readNote(sessionId: string): Promise<PingResponse> {
  const response = await log(sessionId).fetch('https://log.ratify.internal/ping');
  expect(response.status).toBe(200);
  return response.json();
}

describe('LogDO storage', () => {
  it('starts empty rather than erroring', async () => {
    const { ping } = await readNote('fresh-log');
    expect(ping).toBeNull();
  });

  it('returns on a later request what an earlier request wrote', async () => {
    await writeNote('persistent-log', 'use Postgres for the job queue');
    const { ping } = await readNote('persistent-log');

    expect(ping?.note).toBe('use Postgres for the job queue');
    expect(ping?.writes).toBe(1);
  });

  it('accumulates across writes, proving state is not per-request', async () => {
    await writeNote('counting-log', 'first');
    await writeNote('counting-log', 'second');
    const { ping } = await readNote('counting-log');

    expect(ping?.note).toBe('second');
    expect(ping?.writes).toBe(2);
  });

  it('rejects a malformed body without corrupting stored state', async () => {
    await writeNote('guarded-log', 'good value');

    const response = await log('guarded-log').fetch('https://log.ratify.internal/ping', {
      method: 'POST',
      body: 'not json',
    });
    expect(response.status).toBe(400);

    const { ping } = await readNote('guarded-log');
    expect(ping?.note).toBe('good value');
    expect(ping?.writes).toBe(1);
  });
});

describe('log isolation', () => {
  // DESIGN.md goal: "two simultaneous visitors cannot observe or affect each
  // other." This is the test that goal reduces to.
  it('keeps two sessions in separate objects with separate storage', async () => {
    const alice = await writeNote('session-alice', 'ship on Fly.io');
    const bob = await writeNote('session-bob', 'ship on Cloudflare');

    expect(alice.log).not.toBe(bob.log);
    expect((await readNote('session-alice')).ping?.note).toBe('ship on Fly.io');
    expect((await readNote('session-bob')).ping?.note).toBe('ship on Cloudflare');
  });

  it('gives the same session the same object every time', async () => {
    const first = await readNote('stable-session');
    const second = await readNote('stable-session');
    expect(first.log).toBe(second.log);
  });
});

describe('LogDO routing', () => {
  it('404s an unknown path', async () => {
    const response = await log('routing-log').fetch('https://log.ratify.internal/nope');
    expect(response.status).toBe(404);
  });

  it('405s a method the route does not serve', async () => {
    const response = await log('routing-log').fetch('https://log.ratify.internal/ping', {
      method: 'DELETE',
    });
    expect(response.status).toBe(405);
  });
});
