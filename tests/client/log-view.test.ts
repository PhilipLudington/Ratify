// The log view's rendering — PLAN.md Phase 1's two view tasks.
//
// This layer had no coverage until happy-dom was added as a second Vitest
// project (2026-09-08): workerd has no DOM, so nothing here could be asserted
// at all. What it guards, in rough order of what would hurt most to lose:
//
// - the `textContent`-only rule. Records will soon carry model-authored prose
//   (Phase 2) and quoted objections copied from anywhere; the moment one
//   `innerHTML` appears in this file, a record becomes a script.
// - the gauge prohibition. The scrutiny block must stay five descriptive rows
//   with no target state, no praise, and no score (CLAUDE.md, DESIGN.md
//   § The Scrutiny Gauge) — the format parser guards the file, this guards
//   the screen.
// - Principle 4. An empty section renders as an empty section, with nothing
//   that reads as a deficiency.
// - both directions of a supersession chain, which is the only structure in
//   the log a reader cannot reconstruct from a single record.

import { beforeEach, describe, expect, it } from 'vitest';

import { renderIndex, renderMessage, renderRecord } from '../../src/client/log-view';
import { SECTIONS } from '../../src/shared/format';
import type { AdrRecord, Index } from '../../src/shared/record';

function record(overrides: Partial<AdrRecord> = {}): AdrRecord {
  return {
    number: 3,
    status: 'ratified',
    date: '2026-07-14',
    supersedes: [],
    supersededBy: null,
    scrutiny: {
      context: 'full',
      alternatives: 3,
      precedent: 'checked',
      consequences: 'full',
      objections: { open: 0, addressed: 1 },
    },
    title: 'PostgreSQL is the system of record',
    sections: {
      context: 'Six weeks into DynamoDB, the single-table design has been remodeled.',
      decision: 'PostgreSQL, managed, is the system of record.',
      alternativesConsidered: '- MongoDB Atlas — rejected; the pain is relational queries.',
      consequences: 'A real migration with a two-week dual-write window.',
      objections: '',
    },
    history: [{ date: '2026-07-14', note: 'ratified (v1)' }],
    ...overrides,
  };
}

const INDEX: Index = [
  {
    number: 1,
    title: 'Store everything in DynamoDB',
    status: 'superseded',
    decision: 'Use DynamoDB for all persistent data.',
  },
  {
    number: 2,
    title: 'Prefer managed services over self-hosting',
    status: 'ratified',
    decision: 'Buy managed services by default.',
  },
  {
    number: 3,
    title: 'PostgreSQL is the system of record',
    status: 'ratified',
    decision: 'PostgreSQL is the system of record; no second primary datastore.',
  },
];

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
});

describe('the index list', () => {
  it('renders one linked row per record, in the order given', () => {
    renderIndex(container, INDEX);

    const rows = container.querySelectorAll('li.entry');
    expect(rows).toHaveLength(3);
    expect([...container.querySelectorAll('a.entry-head')].map((a) => a.getAttribute('href'))).toEqual(
      ['#/adr/1', '#/adr/2', '#/adr/3'],
    );
    expect([...container.querySelectorAll('.cite')].map((n) => n.textContent)).toEqual([
      'ADR-1',
      'ADR-2',
      'ADR-3',
    ]);
  });

  it("shows each record's title, status badge, and one-line decision", () => {
    renderIndex(container, INDEX);

    const first = container.querySelector('li.entry')!;
    expect(first.querySelector('.entry-title')?.textContent).toBe('Store everything in DynamoDB');
    expect(first.querySelector('.badge')?.textContent).toBe('superseded');
    expect(first.querySelector('.entry-decision')?.textContent).toBe(
      'Use DynamoDB for all persistent data.',
    );
    expect(container.querySelectorAll('li.entry')[1]?.querySelector('.badge')?.textContent).toBe(
      'ratified',
    );
  });

  it('renders an empty log as an empty list rather than anything else', () => {
    renderIndex(container, []);
    expect(container.children).toHaveLength(0);
  });

  it('replaces the previous list rather than appending to it', () => {
    renderIndex(container, INDEX);
    renderIndex(container, [INDEX[0]!]);
    expect(container.querySelectorAll('li.entry')).toHaveLength(1);
  });
});

describe('supersession, in both directions', () => {
  it("points a superseded record forward, with the successor's title", () => {
    renderRecord(container, record({ number: 1, status: 'superseded', supersededBy: 3 }), INDEX);

    const line = container.querySelector('.supersession')!;
    expect(line.textContent).toBe('Superseded by ADR-3 — PostgreSQL is the system of record');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('#/adr/3');
  });

  it('points a superseding record back at what it overturned', () => {
    renderRecord(container, record({ supersedes: [1] }), INDEX);

    const line = container.querySelector('.supersession')!;
    expect(line.textContent).toBe('Supersedes ADR-1 — Store everything in DynamoDB');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('#/adr/1');
  });

  it('lists several superseded records on one line', () => {
    renderRecord(container, record({ supersedes: [1, 2] }), INDEX);

    const line = container.querySelector('.supersession')!;
    expect(line.textContent).toBe(
      'Supersedes ADR-1 — Store everything in DynamoDB, ADR-2 — Prefer managed services over self-hosting',
    );
    expect([...line.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/adr/1',
      '#/adr/2',
    ]);
  });

  it('still cites a record the index does not carry, with no dangling separator', () => {
    renderRecord(container, record({ supersedes: [1] }), []);

    const line = container.querySelector('.supersession')!;
    expect(line.textContent).toBe('Supersedes ADR-1');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('#/adr/1');
  });

  it('says nothing at all when a record stands alone', () => {
    renderRecord(container, record(), INDEX);
    expect(container.querySelector('.supersession')).toBeNull();
  });
});

describe('record content', () => {
  it("renders every section, in the file's own order and under its own headings", () => {
    renderRecord(container, record(), INDEX);

    const headings = [...container.querySelectorAll('.record-section h3')].map((h) => h.textContent);
    expect(headings).toEqual([...SECTIONS.map(([, heading]) => heading), 'History']);
  });

  it('renders section bodies as text, exactly as stored', () => {
    const body = '- One — first\n- Two — second';
    renderRecord(container, record({ sections: { ...record().sections, consequences: body } }), INDEX);

    const consequences = [...container.querySelectorAll('.record-section')].find(
      (s) => s.querySelector('h3')?.textContent === 'Consequences',
    )!;
    expect(consequences.querySelector('.prose')?.textContent).toBe(body);
  });

  it('renders the title and date', () => {
    renderRecord(container, record(), INDEX);

    expect(container.querySelector('.record-title')?.textContent).toBe(
      'ADR-3: PostgreSQL is the system of record',
    );
    expect(container.querySelector('.record-meta .date')?.textContent).toBe('2026-07-14');
  });

  it('renders a history line per entry', () => {
    renderRecord(
      container,
      record({
        history: [
          { date: '2026-06-02', note: 'ratified (v1)' },
          { date: '2026-07-14', note: 'superseded by ADR-3' },
        ],
      }),
      INDEX,
    );

    expect([...container.querySelectorAll('.history li')].map((li) => li.textContent)).toEqual([
      '2026-06-02 — ratified (v1)',
      '2026-07-14 — superseded by ADR-3',
    ]);
  });
});

// The load-bearing one. Nothing in a record is ever built into markup, and
// nothing in a record can become one — not a section body, not a title, not an
// objection quoted verbatim from wherever the objector got it.
describe('record prose is text, never markup', () => {
  const HOSTILE = '<img src=x onerror="globalThis.pwned = true"> & <script>alert(1)</script>';

  it('renders a hostile section body as the characters it is', () => {
    renderRecord(
      container,
      record({ sections: { ...record().sections, context: HOSTILE } }),
      INDEX,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.prose')?.textContent).toBe(HOSTILE);
  });

  it('renders a hostile title as the characters it is', () => {
    renderRecord(container, record({ title: HOSTILE }), INDEX);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.record-title')?.textContent).toBe(`ADR-3: ${HOSTILE}`);
  });

  it('renders a hostile index entry as the characters it is', () => {
    renderIndex(container, [{ number: 9, title: HOSTILE, status: 'ratified', decision: HOSTILE }]);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.entry-title')?.textContent).toBe(HOSTILE);
  });

  it('renders a server error message as the characters it is', () => {
    renderMessage(container, HOSTILE);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.error')?.textContent).toBe(HOSTILE);
  });
});

// DESIGN.md § The Scrutiny Gauge and CLAUDE.md: descriptive, mechanically
// derived, and never a score. A "rightness" field is forbidden outright — the
// format parser refuses one in the file, and this refuses one on the screen.
describe('the scrutiny stamp', () => {
  const TERMS = ['Context', 'Alternatives recorded', 'Precedent', 'Consequences', 'Objections'];

  it('reports exactly the five coverage facts, and nothing else', () => {
    renderRecord(container, record(), INDEX);

    const scrutiny = container.querySelector('.scrutiny')!;
    expect([...scrutiny.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(TERMS);
    expect([...scrutiny.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
      '● full',
      '3',
      'checked',
      '● full',
      '0 open, 1 addressed',
    ]);
  });

  it('describes coverage without praising or prescribing it', () => {
    renderRecord(
      container,
      record({
        scrutiny: {
          context: 'none',
          alternatives: 0,
          precedent: 'unchecked',
          consequences: 'partial',
          objections: { open: 1, addressed: 0 },
        },
      }),
      INDEX,
    );

    const scrutiny = container.querySelector('.scrutiny')!.textContent!;
    expect(scrutiny).toContain('○ none');
    expect(scrutiny).toContain('◐ partial');
    expect(scrutiny).toContain('unchecked');
    expect(scrutiny).toContain('1 open, 0 addressed');
    // No score, no target, no verdict on the decision itself.
    for (const forbidden of ['score', 'rating', 'rightness', 'incomplete', 'missing', 'should']) {
      expect(scrutiny.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('renders the precedent states no seeded record carries', () => {
    for (const precedent of ['unchecked', 'checked', 'conflict', 'conflict-resolved'] as const) {
      renderRecord(container, record({ scrutiny: { ...record().scrutiny, precedent } }), INDEX);
      expect(container.querySelector('.scrutiny')?.textContent).toContain(precedent);
    }
  });

  it('renders every record status, including the one nothing produces yet', () => {
    for (const status of ['ratified', 'superseded', 'redacted'] as const) {
      renderRecord(container, record({ status }), INDEX);
      expect(container.querySelector('.record-meta .badge')?.textContent).toBe(status);
    }
  });
});

// Principle 4: a nearly-empty draft ratifies into a valid record, so the view
// must render one as a record — not as a record with something wrong with it.
describe('a thin record', () => {
  const THIN = record({
    title: '',
    sections: {
      context: '',
      decision: '',
      alternativesConsidered: '',
      consequences: '',
      objections: '',
    },
    scrutiny: {
      context: 'none',
      alternatives: 0,
      precedent: 'checked',
      consequences: 'none',
      objections: { open: 0, addressed: 0 },
    },
    history: [{ date: '2026-07-14', note: 'ratified (v1)' }],
  });

  it('renders every empty section as an em dash and nothing more', () => {
    renderRecord(container, THIN, INDEX);

    const bodies = [...container.querySelectorAll('.record-section .prose')].map(
      (n) => n.textContent,
    );
    expect(bodies).toEqual(['—', '—', '—', '—', '—']);
  });

  it('renders an untitled record as its number alone', () => {
    renderRecord(container, THIN, INDEX);
    expect(container.querySelector('.record-title')?.textContent).toBe('ADR-3');
  });

  it('says nothing anywhere about what the record lacks', () => {
    renderRecord(container, THIN, INDEX);

    // "Alternatives Considered" is a canonical section heading, so the probe
    // is for phrases that can only be nagging, never for the word "consider".
    const text = container.textContent!.toLowerCase();
    for (const nag of ['empty', 'missing', 'incomplete', 'needs ', 'consider adding', 'you should']) {
      expect(text).not.toContain(nag);
    }
  });
});
