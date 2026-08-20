import { describe, expect, it } from 'vitest';

import {
  parseRecord,
  RecordFormatError,
  serializeRecord,
} from '../src/shared/format';
import type { AdrRecord, Scrutiny } from '../src/shared/record';

// ---------------------------------------------------------------------------
// A deterministic record generator for the round-trip property test. Seeded
// PRNG rather than a property-testing dependency: the generator is ~60 lines,
// fully under our control (it must emit *canonical* records — trimmed bodies,
// no body line that is itself an h1/h2 heading), and a fixed seed means a
// failure reproduces exactly.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const WORDS = [
  'queue', 'postgres', 'latency', 'deploy', 'managed', 'cache', 'retry',
  'sandbox', 'record', 'precedent', 'gateway', 'session', 'durable', 'index',
  'stream', 'objection', 'verdict', 'rollback', 'shard', 'cursor',
];

function int(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[int(rng, items.length)]!;
}

function words(rng: Rng, n: number): string {
  return Array.from({ length: n }, () => pick(rng, WORDS)).join(' ');
}

function sentence(rng: Rng): string {
  const w = words(rng, 4 + int(rng, 6));
  return w.charAt(0).toUpperCase() + w.slice(1) + '.';
}

// Blocks a section body can hold: paragraphs, bullets, an `###` subheading.
// Never an `#`/`##` line — the format forbids those inside a body.
function block(rng: Rng): string {
  switch (int(rng, 3)) {
    case 0:
      return Array.from({ length: 1 + int(rng, 2) }, () => sentence(rng)).join(' ');
    case 1:
      return Array.from({ length: 2 + int(rng, 3) }, () => `- ${words(rng, 3)}`).join('\n');
    default:
      return `### ${words(rng, 2)}\n\n${sentence(rng)}`;
  }
}

function body(rng: Rng): string {
  if (rng() < 0.15) return '';
  return Array.from({ length: 1 + int(rng, 3) }, () => block(rng)).join('\n\n');
}

function date(rng: Rng): string {
  return `20${20 + int(rng, 10)}-${String(1 + int(rng, 12)).padStart(2, '0')}-${String(1 + int(rng, 28)).padStart(2, '0')}`;
}

function scrutiny(rng: Rng): Scrutiny {
  return {
    context: pick(rng, ['none', 'partial', 'full'] as const),
    alternatives: int(rng, 5),
    precedent: pick(rng, ['unchecked', 'checked', 'conflict', 'conflict-resolved'] as const),
    consequences: pick(rng, ['none', 'partial', 'full'] as const),
    objections: { open: int(rng, 3), addressed: int(rng, 3) },
  };
}

function record(rng: Rng): AdrRecord {
  const status = pick(rng, ['ratified', 'superseded', 'redacted'] as const);
  return {
    number: 1 + int(rng, 40),
    status,
    date: date(rng),
    supersedes: Array.from({ length: int(rng, 3) }, () => 1 + int(rng, 40)),
    supersededBy: status === 'superseded' ? 1 + int(rng, 40) : null,
    scrutiny: scrutiny(rng),
    // Colons in titles are common ("Use X: the short version") and must not
    // confuse the `# ADR-{n}: {title}` parse.
    title: rng() < 0.2 ? `${words(rng, 2)}: ${words(rng, 3)}` : words(rng, 3 + int(rng, 3)),
    sections: {
      context: body(rng),
      decision: body(rng),
      alternativesConsidered: body(rng),
      consequences: body(rng),
      objections: body(rng),
    },
    history: Array.from({ length: int(rng, 4) }, (_, k) => ({
      date: date(rng),
      note: k === 0 ? 'ratified (v1)' : `amended (v${k + 1}): ${words(rng, 3)}`,
    })),
  };
}

// ---------------------------------------------------------------------------

const CANONICAL: AdrRecord = {
  number: 7,
  status: 'ratified',
  date: '2026-08-13',
  supersedes: [4],
  supersededBy: null,
  scrutiny: {
    context: 'full',
    alternatives: 2,
    precedent: 'conflict-resolved',
    consequences: 'partial',
    objections: { open: 1, addressed: 0 },
  },
  title: 'Use Postgres for the job queue',
  sections: {
    context: 'The team needs a job queue and already runs Postgres.',
    decision: 'Use Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`).',
    alternativesConsidered: '- Redis streams\n- SQS',
    consequences: '',
    objections: 'Redis would be faster to adopt; overruled on ops burden.',
  },
  history: [{ date: '2026-08-13', note: 'ratified (v1)' }],
};

const CANONICAL_TEXT = `---
number: 7
status: ratified
date: 2026-08-13
supersedes: [4]
superseded_by: null
scrutiny: {context: full, alternatives: 2, precedent: conflict-resolved, consequences: partial, objections: {open: 1, addressed: 0}}
---

# ADR-7: Use Postgres for the job queue

## Context

The team needs a job queue and already runs Postgres.

## Decision

Use Postgres (\`SELECT ... FOR UPDATE SKIP LOCKED\`).

## Alternatives Considered

- Redis streams
- SQS

## Consequences

## Objections

Redis would be faster to adopt; overruled on ops burden.

## History

- 2026-08-13 — ratified (v1)
`;

describe('canonical form', () => {
  it('serializes the reference record to the exact canonical text', () => {
    expect(serializeRecord(CANONICAL)).toBe(CANONICAL_TEXT);
  });

  it('parses the canonical text back to the reference record', () => {
    expect(parseRecord(CANONICAL_TEXT)).toEqual(CANONICAL);
  });

  it('is byte-stable: serialize(parse(text)) === text', () => {
    expect(serializeRecord(parseRecord(CANONICAL_TEXT))).toBe(CANONICAL_TEXT);
  });
});

describe('round-trip property', () => {
  it('parse(serialize(r)) deep-equals r for 300 generated records', () => {
    const rng = mulberry32(20260816);
    for (let i = 0; i < 300; i++) {
      const r = record(rng);
      expect(parseRecord(serializeRecord(r))).toEqual(r);
    }
  });
});

describe('shapes the testing strategy names', () => {
  it('round-trips a superseded record with both link directions', () => {
    const r: AdrRecord = {
      ...CANONICAL,
      status: 'superseded',
      supersedes: [2, 3],
      supersededBy: 11,
    };
    expect(parseRecord(serializeRecord(r))).toEqual(r);
  });

  it('round-trips an empty ## Objections section', () => {
    const r: AdrRecord = {
      ...CANONICAL,
      sections: { ...CANONICAL.sections, objections: '' },
    };
    expect(parseRecord(serializeRecord(r))).toEqual(r);
  });

  it('round-trips a version trail (amended history)', () => {
    const r: AdrRecord = {
      ...CANONICAL,
      history: [
        { date: '2026-08-13', note: 'ratified (v1)' },
        { date: '2026-08-14', note: 'amended (v2): fixed typo in Context' },
      ],
    };
    expect(parseRecord(serializeRecord(r))).toEqual(r);
  });

  // Principle 4: a nearly-empty draft still ratifies into a valid record.
  it('round-trips a nearly-empty record', () => {
    const r: AdrRecord = {
      number: 1,
      status: 'ratified',
      date: '2026-08-16',
      supersedes: [],
      supersededBy: null,
      scrutiny: {
        context: 'none',
        alternatives: 0,
        precedent: 'checked',
        consequences: 'none',
        objections: { open: 0, addressed: 0 },
      },
      title: '',
      sections: {
        context: '',
        decision: '',
        alternativesConsidered: '',
        consequences: '',
        objections: '',
      },
      history: [],
    };
    expect(parseRecord(serializeRecord(r))).toEqual(r);
  });
});

describe('parse rejects non-canonical text', () => {
  it('rejects text with no frontmatter fence', () => {
    expect(() => parseRecord('# ADR-1: no frontmatter')).toThrow(RecordFormatError);
  });

  it('rejects a missing section', () => {
    const text = CANONICAL_TEXT.replace('\n## Decision\n', '\n');
    expect(() => parseRecord(text)).toThrow(/expected sections/);
  });

  it('rejects sections out of order', () => {
    const text = CANONICAL_TEXT
      .replace('## Context', '## SWAP')
      .replace('## Decision', '## Context')
      .replace('## SWAP', '## Decision');
    expect(() => parseRecord(text)).toThrow(RecordFormatError);
  });

  it('rejects a frontmatter/title number disagreement', () => {
    const text = CANONICAL_TEXT.replace('# ADR-7:', '# ADR-8:');
    expect(() => parseRecord(text)).toThrow(/ADR-8.*number: 7/);
  });

  it('rejects a malformed history line', () => {
    const text = CANONICAL_TEXT.replace(
      '- 2026-08-13 — ratified (v1)',
      '- yesterday — ratified (v1)',
    );
    expect(() => parseRecord(text)).toThrow(/history line/);
  });

  it('rejects an unknown frontmatter key', () => {
    const text = CANONICAL_TEXT.replace('---\n\n# ADR-7', 'mood: confident\n---\n\n# ADR-7');
    expect(() => parseRecord(text)).toThrow(/unknown frontmatter key/);
  });

  it('rejects a duplicate frontmatter key', () => {
    const text = CANONICAL_TEXT.replace('status: ratified', 'status: ratified\nstatus: redacted');
    expect(() => parseRecord(text)).toThrow(/duplicate/);
  });

  // The gauge prohibition, enforced at the format layer: scrutiny carrying a
  // correctness/"rightness" field is not a scrutiny value at all.
  it('rejects a scrutiny value carrying an extra field', () => {
    const text = CANONICAL_TEXT.replace(
      'objections: {open: 1, addressed: 0}}',
      'objections: {open: 1, addressed: 0}, rightness: 9}',
    );
    expect(() => parseRecord(text)).toThrow(/scrutiny/);
  });

  it('rejects a bad status', () => {
    const text = CANONICAL_TEXT.replace('status: ratified', 'status: tentative');
    expect(() => parseRecord(text)).toThrow(/status/);
  });
});

describe('serialize rejects malformed records', () => {
  it('rejects a section body containing a line that would parse as a heading', () => {
    const r: AdrRecord = {
      ...CANONICAL,
      sections: { ...CANONICAL.sections, context: 'Fine.\n\n## Sneaky' },
    };
    expect(() => serializeRecord(r)).toThrow(/heading/);
  });

  it('rejects a multi-line title', () => {
    expect(() => serializeRecord({ ...CANONICAL, title: 'one\ntwo' })).toThrow(
      /single line/,
    );
  });

  it('rejects a non-date date', () => {
    expect(() => serializeRecord({ ...CANONICAL, date: 'today' })).toThrow(
      /YYYY-MM-DD/,
    );
  });

  it('rejects a multi-line history note', () => {
    const r: AdrRecord = {
      ...CANONICAL,
      history: [{ date: '2026-08-13', note: 'line one\nline two' }],
    };
    expect(() => serializeRecord(r)).toThrow(/history note/);
  });

  it('normalizes untrimmed section bodies to canonical form', () => {
    const r: AdrRecord = {
      ...CANONICAL,
      sections: { ...CANONICAL.sections, context: '\n\nPadded.\n' },
    };
    expect(parseRecord(serializeRecord(r)).sections.context).toBe('Padded.');
  });
});
