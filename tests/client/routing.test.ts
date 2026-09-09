// The app shell's navigation — `src/client/main.ts`.
//
// The case this file exists for: a record fetch that resolves *after* the
// reader has already navigated somewhere else. Painting the late response
// leaves the URL and the screen disagreeing, and the way back from a record is
// a link to `#/` — which, when the hash is already `#/`, fires no `hashchange`
// and so re-routes nothing. The view would stay wrong until a reload.
//
// `main.ts` wires itself to the document and starts on import, so each test
// builds the page, stubs `fetch`, and imports the module fresh.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serializeRecord } from '../../src/shared/format';
import type { AdrRecord, Index } from '../../src/shared/record';

const INDEX: Index = [
  { number: 1, title: 'Store everything in DynamoDB', status: 'superseded', decision: 'Use DynamoDB.' },
  { number: 3, title: 'PostgreSQL is the system of record', status: 'ratified', decision: 'Use Postgres.' },
];

const ADR_3: AdrRecord = {
  number: 3,
  status: 'ratified',
  date: '2026-07-14',
  supersedes: [1],
  supersededBy: null,
  scrutiny: {
    context: 'full',
    alternatives: 3,
    precedent: 'conflict-resolved',
    consequences: 'full',
    objections: { open: 0, addressed: 1 },
  },
  title: 'PostgreSQL is the system of record',
  sections: {
    context: 'Six weeks into DynamoDB.',
    decision: 'PostgreSQL, managed, is the system of record.',
    alternativesConsidered: '- MongoDB Atlas — rejected.',
    consequences: 'A real migration.',
    objections: '',
  },
  history: [{ date: '2026-07-14', note: 'ratified (v1)' }],
};

const PAGE = `
  <section id="gate" hidden>
    <form id="gate-form"><input id="passphrase" type="password" /></form>
    <p id="gate-error" hidden></p>
  </section>
  <section id="log" hidden>
    <p id="log-empty" hidden></p>
    <ol id="log-index"></ol>
    <button type="button" id="logout"></button>
  </section>
  <section id="record" hidden><article id="record-body"></article></section>
`;

interface Deferred {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function deferred(): Deferred {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Let queued microtasks and the timer queue drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
}

function panel(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** The record fetch currently in flight, held open until a test resolves it. */
let pendingRecord: Deferred | null = null;

function navigate(hash: string): void {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
}

beforeEach(() => {
  document.body.innerHTML = PAGE;
  window.location.hash = '';
  pendingRecord = null;

  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/session') return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === '/api/log') return Promise.resolve(jsonResponse({ index: INDEX }));
    if (url.startsWith('/api/record/')) {
      pendingRecord = deferred();
      return pendingRecord.promise;
    }
    if (url === '/api/logout') return Promise.resolve(jsonResponse({ authenticated: false }));
    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot(): Promise<void> {
  await import('../../src/client/main');
  await settle();
}

describe('navigation', () => {
  it('opens on the log', async () => {
    await boot();

    expect(panel('log').hidden).toBe(false);
    expect(panel('record').hidden).toBe(true);
    expect(document.querySelectorAll('#log-index li.entry')).toHaveLength(2);
  });

  it('shows a record when the hash asks for one', async () => {
    await boot();

    navigate('#/adr/3');
    await settle();
    pendingRecord!.resolve(new Response(serializeRecord(ADR_3)));
    await settle();

    expect(panel('record').hidden).toBe(false);
    expect(panel('log').hidden).toBe(true);
    expect(document.querySelector('.record-title')?.textContent).toBe(
      'ADR-3: PostgreSQL is the system of record',
    );
  });

  // The regression test. Without the generation guard in `route`, the late
  // ADR-3 response hides the log and shows the record while the URL reads
  // `#/`, and the "← The log" link cannot recover it.
  it('drops a record response that arrives after the reader has gone back', async () => {
    await boot();

    navigate('#/adr/3');
    await settle();
    expect(pendingRecord).not.toBeNull();

    navigate('#/');
    await settle();
    expect(panel('log').hidden).toBe(false);

    pendingRecord!.resolve(new Response(serializeRecord(ADR_3)));
    await settle();

    expect(panel('log').hidden).toBe(false);
    expect(panel('record').hidden).toBe(true);
    expect(document.querySelector('.record-title')).toBeNull();
  });

  // Logging out is a navigation too: the log panel and its "Forget this
  // session" button stay on screen while a record is being fetched, so the
  // session can end with a record response still in flight.
  it('drops a record response that arrives after the reader has logged out', async () => {
    await boot();

    navigate('#/adr/3');
    await settle();
    expect(pendingRecord).not.toBeNull();

    panel('logout').click();
    await settle();
    expect(panel('gate').hidden).toBe(false);

    pendingRecord!.resolve(new Response(serializeRecord(ADR_3)));
    await settle();

    expect(panel('gate').hidden).toBe(false);
    expect(panel('record').hidden).toBe(true);
    expect(document.querySelector('.record-title')).toBeNull();
  });

  it('drops a stale record response when the reader opened a different record', async () => {
    await boot();

    navigate('#/adr/3');
    await settle();
    const first = pendingRecord!;

    navigate('#/adr/1');
    await settle();
    const second = pendingRecord!;
    expect(second).not.toBe(first);

    // The first record answers last; the reader asked for ADR-1.
    second.resolve(new Response(serializeRecord({ ...ADR_3, number: 1, supersedes: [] })));
    await settle();
    first.resolve(new Response(serializeRecord(ADR_3)));
    await settle();

    expect(document.querySelector('.record-title')?.textContent).toContain('ADR-1');
  });
});
