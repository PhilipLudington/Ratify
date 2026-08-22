import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { LOG_KIND_HEADER } from '../src/do/LogDO';
import type { PingRecord } from '../src/do/LogDO';
import { SEED_NEXT_NUMBER, SEEDS, seedIndex } from '../src/do/seeds';
import { LogStorage } from '../src/do/storage';
import type { LogKind } from '../src/do/storage';
import { serializeRecord } from '../src/shared/format';

interface PingResponse {
  log: string;
  ping: PingRecord | null;
}

/** Address a log the way the doorman does, so tests exercise real naming. */
function log(sessionId: string) {
  return env.LOG.get(env.LOG.idFromName(`sandbox:${sessionId}`));
}

/** Fetch the way the doorman forwards: kind header on, sandbox by default. */
function fetchLog(
  sessionId: string,
  path: string,
  init: RequestInit = {},
  kind: LogKind = 'sandbox',
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(LOG_KIND_HEADER, kind);
  return log(sessionId).fetch(`https://log.ratify.internal${path}`, {
    ...init,
    headers,
  });
}

/** Inspect a log's storage through the same accessors the DO uses. */
function inspect<T>(sessionId: string, fn: (store: LogStorage) => Promise<T>): Promise<T> {
  return runInDurableObject(log(sessionId), (_instance, state) =>
    fn(new LogStorage(state.storage)),
  );
}

async function writeNote(sessionId: string, note: string): Promise<PingResponse> {
  const response = await fetchLog(sessionId, '/ping', {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function readNote(sessionId: string): Promise<PingResponse> {
  const response = await fetchLog(sessionId, '/ping');
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

    const response = await fetchLog('guarded-log', '/ping', {
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
    const response = await fetchLog('routing-log', '/nope');
    expect(response.status).toBe(404);
  });

  it('405s a method the route does not serve', async () => {
    const response = await fetchLog('routing-log', '/ping', { method: 'DELETE' });
    expect(response.status).toBe(405);
  });
});

describe('first-wake seeding', () => {
  // PLAN.md Phase 1: a brand-new sandbox self-seeds the six Latchkey ADRs in
  // the same invocation that initializes `meta`, so no request ever sees a
  // half-seeded log.
  it('seeds a fresh sandbox with six records, an index, and the counter at 7', async () => {
    const response = await fetchLog('seeding-log', '/ping');
    expect(response.status).toBe(200);

    await inspect('seeding-log', async (store) => {
      const meta = await store.getMeta();
      expect(meta?.kind).toBe('sandbox');
      expect(meta?.nextNumber).toBe(SEED_NEXT_NUMBER);
      expect(await store.getIndex()).toEqual(seedIndex());
    });
  });

  it('stores each seed as the canonical bytes its serialization produces', async () => {
    await fetchLog('seeding-bytes-log', '/ping');

    await inspect('seeding-bytes-log', async (store) => {
      for (const { record } of SEEDS) {
        expect(await store.getRecordText(record.number)).toBe(serializeRecord(record));
      }
    });
  });

  it('seeds exactly once — a later request finds the log unchanged', async () => {
    await fetchLog('seed-once-log', '/ping');
    const before = await inspect('seed-once-log', (store) => store.getMeta());

    await fetchLog('seed-once-log', '/ping');
    const after = await inspect('seed-once-log', (store) => store.getMeta());

    expect(after).toEqual(before);
    expect(after?.nextNumber).toBe(SEED_NEXT_NUMBER);
  });

  it('seeds a named log empty: meta only, no records, counter at 1', async () => {
    const response = await fetchLog('named-log', '/ping', {}, 'named');
    expect(response.status).toBe(200);

    await inspect('named-log', async (store) => {
      const meta = await store.getMeta();
      expect(meta?.kind).toBe('named');
      expect(meta?.nextNumber).toBe(1);
      expect(await store.getIndex()).toEqual([]);
      expect(await store.getRecordText(1)).toBeNull();
    });
  });

  it('refuses a request that does not say what kind of log it addressed', async () => {
    const response = await log('kindless-log').fetch('https://log.ratify.internal/ping');
    expect(response.status).toBe(400);

    // Refused before touching storage: the log stays uninitialized.
    await inspect('kindless-log', async (store) => {
      expect(await store.getMeta()).toBeNull();
    });
  });

  it('refuses to serve a log addressed as a kind it is not', async () => {
    await fetchLog('mistaken-log', '/ping');

    const response = await fetchLog('mistaken-log', '/ping', {}, 'named');
    expect(response.status).toBe(500);

    // The sandbox itself is untouched by the mistaken request.
    await inspect('mistaken-log', async (store) => {
      expect((await store.getMeta())?.kind).toBe('sandbox');
    });
  });
});
