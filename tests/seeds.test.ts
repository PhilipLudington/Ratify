import { describe, expect, it } from 'vitest';

import { parseRecord, serializeRecord } from '../src/shared/format';
import { SEED_NEXT_NUMBER, SEEDS, seedIndex } from '../src/do/seeds';

// The seeds are fiction, but the log they seed is not allowed to lie: every
// invariant the real ratification path will enforce must already hold in the
// authored set, or the demo opens on a log the product itself could never
// have produced.

describe('the seed set', () => {
  it('is exactly six records, numbered 1..6 with no gaps', () => {
    expect(SEEDS.map((s) => s.record.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(SEED_NEXT_NUMBER).toBe(7);
  });

  it('every seed serializes to canonical text and round-trips losslessly', () => {
    for (const { record } of SEEDS) {
      const text = serializeRecord(record);
      expect(parseRecord(text)).toEqual(record);
      expect(serializeRecord(parseRecord(text))).toBe(text);
    }
  });

  it('dates ascend with numbers — the history reads chronologically', () => {
    const dates = SEEDS.map((s) => s.record.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('every history opens with "ratified (v1)" on the record\'s own date', () => {
    for (const { record } of SEEDS) {
      expect(record.history[0]).toEqual({
        date: record.date,
        note: 'ratified (v1)',
      });
    }
  });
});

describe('the seeded supersession chain', () => {
  it('contains exactly one superseded record, with both links mirrored', () => {
    const superseded = SEEDS.filter((s) => s.record.status === 'superseded');
    expect(superseded).toHaveLength(1);

    const old = superseded[0]!.record;
    expect(old.supersededBy).not.toBeNull();
    const successor = SEEDS.find(
      (s) => s.record.number === old.supersededBy,
    )!.record;
    expect(successor.supersedes).toContain(old.number);
    expect(successor.status).toBe('ratified');
    // The overturn is a resolved precedent conflict, and the gauge says so.
    expect(successor.scrutiny.precedent).toBe('conflict-resolved');
    // The superseded record's history records its own overturning.
    expect(old.history.at(-1)?.note).toBe(`superseded by ADR-${successor.number}`);
  });

  it('every supersedes link points back at a seed that agrees', () => {
    for (const { record } of SEEDS) {
      for (const n of record.supersedes) {
        const target = SEEDS.find((s) => s.record.number === n)!.record;
        expect(target.status).toBe('superseded');
        expect(target.supersededBy).toBe(record.number);
      }
      if (record.supersededBy === null) {
        expect(record.status).not.toBe('superseded');
      }
    }
  });
});

describe('scrutiny stamps match the authored sections', () => {
  it('coverage is none exactly when the section is empty', () => {
    for (const { record } of SEEDS) {
      expect(record.scrutiny.context === 'none').toBe(
        record.sections.context === '',
      );
      expect(record.scrutiny.consequences === 'none').toBe(
        record.sections.consequences === '',
      );
    }
  });

  it('the alternatives count matches the bullets in the section', () => {
    for (const { record } of SEEDS) {
      const bullets = record.sections.alternativesConsidered
        .split('\n')
        .filter((line) => line.startsWith('- ')).length;
      expect(record.scrutiny.alternatives).toBe(bullets);
    }
  });

  it('open objections appear verbatim in the section, addressed ones do not', () => {
    for (const { record } of SEEDS) {
      expect(record.scrutiny.objections.open > 0).toBe(
        record.sections.objections !== '',
      );
    }
    // Exactly one seed carries the log's open objection.
    const open = SEEDS.filter((s) => s.record.scrutiny.objections.open > 0);
    expect(open).toHaveLength(1);
  });

  it('no ratified record is precedent-unchecked — the check always runs', () => {
    for (const { record } of SEEDS) {
      expect(record.scrutiny.precedent).not.toBe('unchecked');
    }
  });
});

describe('the seed index', () => {
  it('carries one line per record, denormalized faithfully and in order', () => {
    const index = seedIndex();
    expect(index).toHaveLength(SEEDS.length);
    index.forEach((entry, i) => {
      const { record, decision } = SEEDS[i]!;
      expect(entry).toEqual({
        number: record.number,
        title: record.title,
        status: record.status,
        decision,
      });
    });
  });

  it('every index decision is one non-empty sentence', () => {
    for (const { decision } of seedIndex()) {
      expect(decision).not.toBe('');
      expect(decision.includes('\n')).toBe(false);
      expect(decision.endsWith('.')).toBe(true);
    }
  });
});
