// The log view — PLAN.md Phase 1: "index list with status badges, record
// detail page" and "supersession links in both directions".
//
// Rendering rules this file holds to:
//
// - **The file is the record (Principle 1).** Section bodies are shown as the
//   stored text, wrapped but never reformatted, so what a reader sees on
//   screen is what export hands them. No Markdown renderer sits in between
//   deciding what a line meant; a bullet reads as a bullet and a quoted
//   objection reads as a quote, because that is how it is written on disk.
// - **Nothing is nagged at.** An empty section renders as an empty section
//   (Principle 4 — a thin record is a valid record), and the stamped scrutiny
//   is reported as coverage, never as a score or a target (DESIGN.md § The
//   Scrutiny Gauge).
// - **Text goes in through `textContent`.** Records carry arbitrary prose;
//   nothing here builds HTML out of it.
//
// The draft's live segmented gauge is Phase 2's; what this file renders is the
// snapshot already stamped into a ratified record's frontmatter.

import { SECTIONS } from '../shared/format';
import type {
  AdrRecord,
  Index,
  IndexEntry,
  SectionCoverage,
} from '../shared/record';
import { citeAdr } from '../shared/record';
import { recordHref } from './routes';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A record's status, worn plainly. Superseded is a fact, not a demotion. */
function badge(entry: Pick<AdrRecord, 'status'>): HTMLElement {
  return element('span', `badge badge-${entry.status}`, entry.status);
}

function lookup(index: Index, number: number): IndexEntry | undefined {
  return index.find((entry) => entry.number === number);
}

/** `ADR-3 — PostgreSQL is the system of record`, linked, title if we have it. */
function citation(index: Index, number: number): HTMLElement {
  const wrapper = element('span', 'citation');
  const link = element('a', undefined, citeAdr(number));
  link.href = recordHref(number);
  wrapper.append(link);

  const entry = lookup(index, number);
  if (entry !== undefined) wrapper.append(element('span', 'muted', ` — ${entry.title}`));
  return wrapper;
}

// ---------------------------------------------------------------------------
// The index list
// ---------------------------------------------------------------------------

/**
 * Every record in the log, ascending. The order is the log's own: a decision
 * log reads forward, and the oldest record is the one the precedent check
 * exists to remember.
 */
export function renderIndex(list: HTMLElement, index: Index): void {
  list.replaceChildren(...index.map(renderIndexEntry));
}

function renderIndexEntry(entry: IndexEntry): HTMLElement {
  const item = element('li', 'entry');

  const link = element('a', 'entry-head');
  link.href = recordHref(entry.number);
  link.append(
    element('span', 'cite', citeAdr(entry.number)),
    element('span', 'entry-title', entry.title),
    badge(entry),
  );

  item.append(link, element('p', 'entry-decision muted', entry.decision));
  return item;
}

// ---------------------------------------------------------------------------
// The record detail
// ---------------------------------------------------------------------------

/** Both directions of a supersession chain, as they are stored on disk. */
function renderSupersession(record: AdrRecord, index: Index): HTMLElement[] {
  const lines: HTMLElement[] = [];

  if (record.supersededBy !== null) {
    const line = element('p', 'supersession');
    line.append('Superseded by ', citation(index, record.supersededBy));
    lines.push(line);
  }

  if (record.supersedes.length > 0) {
    const line = element('p', 'supersession');
    line.append('Supersedes ');
    record.supersedes.forEach((number, i) => {
      if (i > 0) line.append(', ');
      line.append(citation(index, number));
    });
    lines.push(line);
  }

  return lines;
}

const COVERAGE_MARK: Record<SectionCoverage, string> = {
  none: '○',
  partial: '◐',
  full: '●',
};

/**
 * The scrutiny stamped at ratification, reported back as what it is: how much
 * of the record got filled in and how the check went. There is no target
 * state here and no judgment of the decision — only a description of the
 * conversation that produced it.
 */
function renderScrutiny(record: AdrRecord): HTMLElement {
  const { scrutiny } = record;
  const list = element('dl', 'scrutiny');

  const row = (term: string, value: string): void => {
    list.append(element('dt', undefined, term), element('dd', undefined, value));
  };

  row('Context', `${COVERAGE_MARK[scrutiny.context]} ${scrutiny.context}`);
  row('Alternatives recorded', String(scrutiny.alternatives));
  row('Precedent', scrutiny.precedent);
  row('Consequences', `${COVERAGE_MARK[scrutiny.consequences]} ${scrutiny.consequences}`);
  row(
    'Objections',
    `${scrutiny.objections.open} open, ${scrutiny.objections.addressed} addressed`,
  );

  return list;
}

function renderSection(heading: string, body: string): HTMLElement {
  const section = element('section', 'record-section');
  section.append(element('h3', undefined, heading));

  // `prose` is `white-space: pre-wrap`: the stored line breaks are the
  // author's, and they survive to the screen unchanged.
  section.append(
    body === ''
      ? element('p', 'prose empty muted', '—')
      : element('div', 'prose', body),
  );
  return section;
}

function renderHistory(record: AdrRecord): HTMLElement {
  const section = element('section', 'record-section');
  section.append(element('h3', undefined, 'History'));

  const list = element('ul', 'history');
  for (const entry of record.history) {
    const item = element('li');
    item.append(element('span', 'date', entry.date), ` — ${entry.note}`);
    list.append(item);
  }
  section.append(list);
  return section;
}

/** One record, whole: heading, frontmatter facts, every section, history. */
export function renderRecord(container: HTMLElement, record: AdrRecord, index: Index): void {
  const heading = element(
    'h2',
    'record-title',
    `${citeAdr(record.number)}${record.title === '' ? '' : `: ${record.title}`}`,
  );

  const meta = element('p', 'record-meta');
  meta.append(badge(record), element('span', 'date', record.date));

  container.replaceChildren(
    heading,
    meta,
    ...renderSupersession(record, index),
    renderScrutiny(record),
    ...SECTIONS.map(([key, sectionHeading]) =>
      renderSection(sectionHeading, record.sections[key]),
    ),
    renderHistory(record),
  );
}

/** Something went wrong reading the log; say so plainly and stop. */
export function renderMessage(container: HTMLElement, message: string): void {
  container.replaceChildren(element('p', 'error', message));
}
