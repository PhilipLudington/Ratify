// The log's read API — PLAN.md Phase 1: `GET /api/log` and
// `GET /api/record/:n`. These run against the Durable Object directly; the
// doorman's part (gate, then forward unchanged) is pinned in doorman.test.ts.
//
// The contract worth defending here is that a record comes back as the exact
// bytes on disk. Principle 1 makes the plain file *the* record, so the client
// parses the same text export will hand a reviewer, and Phase 4's quote
// verification checks substrings of that same text. A JSON projection would
// be a second representation to drift.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { LOG_KIND_HEADER } from '../src/do/LogDO';
import { SEEDS, seedIndex } from '../src/do/seeds';
import type { LogKind } from '../src/do/storage';
import { parseRecord, serializeRecord } from '../src/shared/format';
import type { Index } from '../src/shared/record';

function fetchLog(
  sessionId: string,
  path: string,
  init: RequestInit = {},
  kind: LogKind = 'sandbox',
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(LOG_KIND_HEADER, kind);
  return env.LOG.get(env.LOG.idFromName(`sandbox:${sessionId}`)).fetch(
    `https://log.ratify.internal${path}`,
    { ...init, headers },
  );
}

async function readIndex(sessionId: string, kind: LogKind = 'sandbox'): Promise<Index> {
  const response = await fetchLog(sessionId, '/log', {}, kind);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { index: Index };
  return body.index;
}

describe('GET /log', () => {
  it('returns every seeded record, in order, with no recency filter', async () => {
    // Tier 1 of the precedent check reads this same index: the oldest record
    // must be as present as the newest.
    expect(await readIndex('api-index-log')).toEqual(seedIndex());
  });

  it('carries the status each record wears in the log view', async () => {
    const index = await readIndex('api-badge-log');
    const byNumber = new Map(index.map((entry) => [entry.number, entry.status]));

    expect(byNumber.get(1)).toBe('superseded');
    expect(byNumber.get(3)).toBe('ratified');
  });

  it('is empty, not missing, for a named log that seeded empty', async () => {
    expect(await readIndex('api-named-log', 'named')).toEqual([]);
  });

  it('405s a write to a read-only route', async () => {
    const response = await fetchLog('api-method-log', '/log', { method: 'POST' });
    expect(response.status).toBe(405);
  });
});

describe('GET /record/{n}', () => {
  it('returns the stored bytes verbatim, as Markdown', async () => {
    const response = await fetchLog('api-record-log', '/record/3');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(await response.text()).toBe(serializeRecord(SEEDS[2]!.record));
  });

  it('serves every seeded record, each re-parsing to what was authored', async () => {
    for (const { record } of SEEDS) {
      const response = await fetchLog('api-all-records-log', `/record/${record.number}`);
      expect(response.status).toBe(200);
      expect(parseRecord(await response.text())).toEqual(record);
    }
  });

  // What the detail view renders as "Supersedes ADR-1" / "Superseded by
  // ADR-3" is read off the record itself, so both directions have to arrive
  // through this endpoint — not be reconstructed by the client.
  it('carries both directions of a supersession chain', async () => {
    const older = parseRecord(await (await fetchLog('api-chain-log', '/record/1')).text());
    const newer = parseRecord(await (await fetchLog('api-chain-log', '/record/3')).text());

    expect(older.status).toBe('superseded');
    expect(older.supersededBy).toBe(3);
    expect(newer.supersedes).toContain(1);
    expect(newer.supersededBy).toBeNull();
  });

  it('404s a record this log does not have', async () => {
    const response = await fetchLog('api-missing-log', '/record/99');
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toEqual({
      error: 'ADR-99 is not in this log.',
    });
  });

  it('400s anything that is not a record number', async () => {
    for (const path of ['/record/abc', '/record/0', '/record/-1', '/record/3.5', '/record/03']) {
      const response = await fetchLog('api-bad-number-log', path);
      expect({ path, status: response.status }).toEqual({ path, status: 400 });
    }
  });

  it('405s a write to a read-only route', async () => {
    const response = await fetchLog('api-record-method-log', '/record/1', { method: 'POST' });
    expect(response.status).toBe(405);
  });
});
