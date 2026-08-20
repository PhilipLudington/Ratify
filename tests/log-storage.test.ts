import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { RecordFormatError, serializeRecord } from '../src/shared/format';
import type { AdrRecord } from '../src/shared/record';
import { emptyDraft, LogStorage } from '../src/do/storage';
import type { Draft } from '../src/do/storage';

// Each test names its own DO so storage starts empty, and runs against the
// real workerd storage API — the accessors are the schema, so they get the
// same no-mocks treatment the rest of the DO does.
function withStorage<T>(
  name: string,
  fn: (log: LogStorage) => Promise<T>,
): Promise<T> {
  const stub = env.LOG.get(env.LOG.idFromName(`storage-test:${name}`));
  return runInDurableObject(stub, (_instance, state) =>
    fn(new LogStorage(state.storage)),
  );
}

function fixtureRecord(number: number, title = 'Use Postgres for the job queue'): AdrRecord {
  return {
    number,
    status: 'ratified',
    date: '2026-08-20',
    supersedes: [],
    supersededBy: null,
    scrutiny: {
      context: 'full',
      alternatives: 2,
      precedent: 'checked',
      consequences: 'partial',
      objections: { open: 0, addressed: 1 },
    },
    title,
    sections: {
      context: 'We need a durable queue and already operate Postgres.',
      decision: 'Use Postgres (SELECT ... FOR UPDATE SKIP LOCKED) as the queue.',
      alternativesConsidered: '- Redis streams\n- SQS',
      consequences: 'One datastore to operate; queue depth is a SQL query away.',
      objections: '',
    },
    history: [{ date: '2026-08-20', note: 'ratified (v1)' }],
  };
}

describe('meta and the next-number counter', () => {
  it('reads null before the log is ever initialized', () =>
    withStorage('meta-fresh', async (log) => {
      expect(await log.getMeta()).toBeNull();
    }));

  it('initializes once, with the counter starting at 1', () =>
    withStorage('meta-init', async (log) => {
      const created = await log.initMeta('sandbox', '2026-08-20T12:00:00.000Z');
      expect(created).toEqual({
        schemaVersion: 1,
        nextNumber: 1,
        created: '2026-08-20T12:00:00.000Z',
        kind: 'sandbox',
      });
      expect(await log.getMeta()).toEqual(created);
    }));

  it('refuses to initialize twice — re-init would reset the counter', () =>
    withStorage('meta-reinit', async (log) => {
      await log.initMeta('named', '2026-08-20T12:00:00.000Z');
      await expect(
        log.initMeta('named', '2026-08-21T12:00:00.000Z'),
      ).rejects.toThrow(/initialized exactly once/);
    }));

  it('refuses to allocate a number before initialization', () =>
    withStorage('meta-early-alloc', async (log) => {
      await expect(log.allocateNumber()).rejects.toThrow(/before the log is initialized/);
    }));

  it('allocates consecutive numbers and persists the advance', () =>
    withStorage('meta-alloc', async (log) => {
      await log.initMeta('sandbox', '2026-08-20T12:00:00.000Z');
      expect(await log.allocateNumber()).toBe(1);
      expect(await log.allocateNumber()).toBe(2);
      expect(await log.allocateNumber()).toBe(3);
      expect((await log.getMeta())?.nextNumber).toBe(4);
    }));
});

describe('record storage', () => {
  it('reads null, text and parsed both, for a record that does not exist', () =>
    withStorage('record-absent', async (log) => {
      expect(await log.getRecordText(1)).toBeNull();
      expect(await log.getRecord(1)).toBeNull();
    }));

  it('stores canonical Markdown text as the truth', () =>
    withStorage('record-text-truth', async (log) => {
      const record = fixtureRecord(1);
      await log.putRecord(record);
      // The stored bytes ARE the serialized record — what quote verification
      // substring-checks and what export ships, with no other representation.
      expect(await log.getRecordText(1)).toBe(serializeRecord(record));
      expect(await log.getRecord(1)).toEqual(record);
    }));

  it('rejects a malformed record before anything reaches disk', () =>
    withStorage('record-malformed', async (log) => {
      const bad = { ...fixtureRecord(1), date: 'yesterday' };
      await expect(log.putRecord(bad)).rejects.toThrow(RecordFormatError);
      expect(await log.getRecordText(1)).toBeNull();
    }));

  it('keeps ADR-1 and ADR-12 in distinct keys', () =>
    withStorage('record-key-shape', async (log) => {
      await log.putRecord(fixtureRecord(1, 'First'));
      await log.putRecord(fixtureRecord(12, 'Twelfth'));
      expect((await log.getRecord(1))?.title).toBe('First');
      expect((await log.getRecord(12))?.title).toBe('Twelfth');
    }));
});

describe('version snapshots', () => {
  it('reads null for a snapshot that does not exist', () =>
    withStorage('snapshot-absent', async (log) => {
      expect(await log.getSnapshotText(1, 1)).toBeNull();
      expect(await log.getSnapshotVersions(1)).toEqual([]);
    }));

  it('preserves the exact pre-amendment bytes', () =>
    withStorage('snapshot-bytes', async (log) => {
      const text = serializeRecord(fixtureRecord(3));
      await log.putSnapshot(3, 1, text);
      expect(await log.getSnapshotText(3, 1)).toBe(text);
    }));

  it('refuses text whose number is not the record being snapshotted', () =>
    withStorage('snapshot-wrong-number', async (log) => {
      const text = serializeRecord(fixtureRecord(4));
      await expect(log.putSnapshot(3, 1, text)).rejects.toThrow(/ADR-4, not ADR-3/);
    }));

  it('refuses text that is not a canonical record at all', () =>
    withStorage('snapshot-corrupt', async (log) => {
      await expect(log.putSnapshot(3, 1, 'not a record')).rejects.toThrow(
        RecordFormatError,
      );
    }));

  it('refuses a version below 1', () =>
    withStorage('snapshot-bad-version', async (log) => {
      const text = serializeRecord(fixtureRecord(3));
      await expect(log.putSnapshot(3, 0, text)).rejects.toThrow(/>= 1/);
    }));

  it('lists versions in numeric order, not lexicographic', () =>
    withStorage('snapshot-versions', async (log) => {
      const text = serializeRecord(fixtureRecord(5));
      for (const k of [10, 1, 2]) await log.putSnapshot(5, k, text);
      expect(await log.getSnapshotVersions(5)).toEqual([1, 2, 10]);
    }));

  it('keeps snapshots and current records out of each other\'s way', () =>
    withStorage('snapshot-isolation', async (log) => {
      const record = fixtureRecord(7);
      await log.putRecord(record);
      await log.putSnapshot(7, 1, serializeRecord(record));
      // The snapshot listing sees only `record:7:v{k}`, and the current
      // record read sees only `record:7` — the key shapes cannot collide.
      expect(await log.getSnapshotVersions(7)).toEqual([1]);
      expect(await log.getRecord(7)).toEqual(record);
      expect(await log.getSnapshotVersions(70)).toEqual([]);
    }));
});

describe('the index', () => {
  it('is empty, not missing, on a fresh log', () =>
    withStorage('index-fresh', async (log) => {
      expect(await log.getIndex()).toEqual([]);
    }));

  it('round-trips entries', () =>
    withStorage('index-roundtrip', async (log) => {
      const index = [
        { number: 1, title: 'First', status: 'superseded' as const, decision: 'Do A.' },
        { number: 2, title: 'Second', status: 'ratified' as const, decision: 'Do B instead.' },
      ];
      await log.putIndex(index);
      expect(await log.getIndex()).toEqual(index);
    }));
});

describe('the draft', () => {
  it('is the empty draft before anyone has said anything', () =>
    withStorage('draft-fresh', async (log) => {
      expect(await log.getDraft()).toEqual(emptyDraft());
    }));

  it('round-trips in-progress state', () =>
    withStorage('draft-roundtrip', async (log) => {
      const draft: Draft = {
        ...emptyDraft(),
        title: 'Adopt a job queue',
        sections: {
          ...emptyDraft().sections,
          context: 'Emails send inline today and time out.',
        },
        precedent: 'conflict',
        objections: { open: 1, addressed: 0 },
        conversation: [{ role: 'user', content: 'We need a queue.' }],
      };
      await log.putDraft(draft);
      expect(await log.getDraft()).toEqual(draft);
    }));

  it('clears back to the empty draft after ratification', () =>
    withStorage('draft-clear', async (log) => {
      await log.putDraft({ ...emptyDraft(), title: 'Spent draft' });
      await log.clearDraft();
      expect(await log.getDraft()).toEqual(emptyDraft());
    }));
});
