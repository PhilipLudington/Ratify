// Serialization for the record format — DESIGN.md § The Record Format.
//
// One `.md` file per record: YAML frontmatter for the machine-readable
// fields, `##` prose sections in canonical order, `## History` last. This
// module is deliberately a parser for the *house format*, not for Markdown or
// YAML in general — the grammar is fixed, so a hand-rolled zero-dependency
// implementation stays small, and every deviation from canonical form is a
// loud `RecordFormatError` rather than a guess. The emitted frontmatter is
// nonetheless valid YAML: an exported record must be readable by standard
// tools that know nothing about Ratify (Principle 1).
//
// Losslessness is the contract both directions:
// - `parseRecord(serializeRecord(r))` deep-equals `r` for any canonical
//   record (section bodies trimmed — `serializeRecord` normalizes them).
// - `serializeRecord(parseRecord(text))` returns `text` byte-for-byte for
//   any canonically serialized record, which is what makes "exported files
//   re-parse losslessly" (Phase 5's gate) checkable.
//
// One divergence from DESIGN.md's sketch: the sketch abbreviates the
// objections tally as `1-open`, but the tally is two facts (open, addressed)
// and export may not lose either, so the canonical form is
// `objections: {open: 1, addressed: 0}` — still plain flow-style YAML.

import type {
  AdrRecord,
  HistoryEntry,
  RecordSections,
  RecordStatus,
  Scrutiny,
} from './record';
import { citeAdr } from './record';

/** A record that is not in canonical form. The message says where and why. */
export class RecordFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordFormatError';
  }
}

/** Section storage keys paired with their `##` headings, in canonical order. */
const SECTIONS = [
  ['context', 'Context'],
  ['decision', 'Decision'],
  ['alternativesConsidered', 'Alternatives Considered'],
  ['consequences', 'Consequences'],
  ['objections', 'Objections'],
] as const satisfies ReadonlyArray<readonly [keyof RecordSections, string]>;

const HISTORY_HEADING = 'History';

const FRONTMATTER_KEYS = [
  'number',
  'status',
  'date',
  'supersedes',
  'superseded_by',
  'scrutiny',
] as const;

const STATUSES: ReadonlySet<string> = new Set([
  'ratified',
  'superseded',
  'redacted',
]);
const COVERAGES: ReadonlySet<string> = new Set(['none', 'partial', 'full']);
const PRECEDENTS: ReadonlySet<string> = new Set([
  'unchecked',
  'checked',
  'conflict',
  'conflict-resolved',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_RE = /^# ADR-(\d+):(?: (.*))?$/;
const HISTORY_LINE_RE = /^- (\d{4}-\d{2}-\d{2}) — (.+)$/;

// The whole scrutiny value in one strict shot. A key it does not name —
// including any correctness or "rightness" field — fails the parse, which is
// the format-level enforcement of DESIGN.md's gauge prohibition.
const SCRUTINY_RE =
  /^\{context: (none|partial|full), alternatives: (\d+), precedent: (unchecked|checked|conflict|conflict-resolved), consequences: (none|partial|full), objections: \{open: (\d+), addressed: (\d+)\}\}$/;

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Render a record to its canonical `.md` text. Section bodies are trimmed
 * (the canonical form); everything else must already be well-formed or this
 * throws — the serializer is the last gate before disk, and a malformed
 * record must fail here, not parse strangely later.
 */
export function serializeRecord(r: AdrRecord): string {
  assertCount(r.number, 'number', 1);
  assertEnum(r.status, STATUSES, 'status');
  assertDate(r.date, 'date');
  for (const n of r.supersedes) assertCount(n, 'supersedes entry', 1);
  if (r.supersededBy !== null) assertCount(r.supersededBy, 'superseded_by', 1);
  if (r.title.includes('\n')) {
    throw new RecordFormatError('title must be a single line');
  }

  const out: string[] = [
    '---',
    `number: ${r.number}`,
    `status: ${r.status}`,
    `date: ${r.date}`,
    `supersedes: [${r.supersedes.join(', ')}]`,
    `superseded_by: ${r.supersededBy ?? 'null'}`,
    `scrutiny: ${serializeScrutiny(r.scrutiny)}`,
    '---',
    '',
    `# ${citeAdr(r.number)}:${r.title === '' ? '' : ` ${r.title}`}`,
  ];

  for (const [key, heading] of SECTIONS) {
    const body = r.sections[key].trim();
    assertSectionBody(body, heading);
    out.push('', `## ${heading}`);
    if (body !== '') out.push('', body);
  }

  out.push('', `## ${HISTORY_HEADING}`);
  if (r.history.length > 0) {
    out.push('');
    for (const entry of r.history) out.push(serializeHistoryLine(entry));
  }

  return out.join('\n') + '\n';
}

function serializeScrutiny(s: Scrutiny): string {
  assertEnum(s.context, COVERAGES, 'scrutiny.context');
  assertCount(s.alternatives, 'scrutiny.alternatives', 0);
  assertEnum(s.precedent, PRECEDENTS, 'scrutiny.precedent');
  assertEnum(s.consequences, COVERAGES, 'scrutiny.consequences');
  assertCount(s.objections.open, 'scrutiny.objections.open', 0);
  assertCount(s.objections.addressed, 'scrutiny.objections.addressed', 0);

  return (
    `{context: ${s.context}, alternatives: ${s.alternatives}, ` +
    `precedent: ${s.precedent}, consequences: ${s.consequences}, ` +
    `objections: {open: ${s.objections.open}, addressed: ${s.objections.addressed}}}`
  );
}

function serializeHistoryLine(entry: HistoryEntry): string {
  assertDate(entry.date, 'history entry date');
  if (entry.note.includes('\n') || entry.note.trim() === '') {
    throw new RecordFormatError(
      'a history note must be a single non-empty line',
    );
  }
  return `- ${entry.date} — ${entry.note}`;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse canonical record text back into an {@link AdrRecord}. Strict: a
 * missing section, an unknown frontmatter key, a malformed history line, or
 * a frontmatter/title number disagreement all throw {@link RecordFormatError}
 * rather than producing a best-effort record — the chain doesn't lie, so the
 * parser doesn't guess.
 */
export function parseRecord(text: string): AdrRecord {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    throw new RecordFormatError('record must open with a "---" frontmatter fence');
  }
  const close = lines.indexOf('---', 1);
  if (close === -1) {
    throw new RecordFormatError('frontmatter fence is never closed');
  }

  const fields = readFrontmatter(lines.slice(1, close));
  const number = parseCount(getField(fields, 'number'), 'number');
  if (number < 1) {
    throw new RecordFormatError(`number must be >= 1, got ${number}`);
  }
  const status = parseEnum<RecordStatus>(
    getField(fields, 'status'),
    STATUSES,
    'status',
  );
  const date = parseDate(getField(fields, 'date'), 'date');
  const supersedes = parseSupersedes(getField(fields, 'supersedes'));
  const supersededBy = parseSupersededBy(getField(fields, 'superseded_by'));
  const scrutiny = parseScrutiny(getField(fields, 'scrutiny'));

  const rest = lines.slice(close + 1);
  let i = 0;
  while (i < rest.length && rest[i]?.trim() === '') i++;
  const titleLine = rest[i];
  const titleMatch = titleLine === undefined ? null : TITLE_RE.exec(titleLine);
  if (!titleMatch) {
    throw new RecordFormatError(
      'expected a "# ADR-{n}: {title}" line after the frontmatter',
    );
  }
  const titleNumber = Number(titleMatch[1]);
  if (titleNumber !== number) {
    throw new RecordFormatError(
      `title says ${citeAdr(titleNumber)} but frontmatter says number: ${number}`,
    );
  }
  const title = titleMatch[2] ?? '';

  const groups: Array<{ heading: string; lines: string[] }> = [];
  for (const line of rest.slice(i + 1)) {
    if (line.startsWith('## ')) {
      groups.push({ heading: line.slice(3), lines: [] });
    } else if (groups.length === 0) {
      if (line.trim() !== '') {
        throw new RecordFormatError(
          `unexpected content between the title and the first section: "${line}"`,
        );
      }
    } else {
      groups[groups.length - 1]!.lines.push(line);
    }
  }

  const expected = [...SECTIONS.map(([, heading]) => heading), HISTORY_HEADING];
  const found = groups.map((g) => g.heading);
  if (
    found.length !== expected.length ||
    expected.some((heading, k) => found[k] !== heading)
  ) {
    throw new RecordFormatError(
      `expected sections [${expected.join(', ')}] in order, found [${found.join(', ')}]`,
    );
  }

  const sections = {} as RecordSections;
  SECTIONS.forEach(([key, heading], k) => {
    const body = groups[k]!.lines.join('\n').trim();
    assertSectionBody(body, heading);
    sections[key] = body;
  });

  const history: HistoryEntry[] = [];
  for (const line of groups[SECTIONS.length]!.lines) {
    if (line.trim() === '') continue;
    const entry = HISTORY_LINE_RE.exec(line);
    if (!entry) {
      throw new RecordFormatError(
        `history line is not "- YYYY-MM-DD — note": "${line}"`,
      );
    }
    history.push({ date: entry[1]!, note: entry[2]! });
  }

  return {
    number,
    status,
    date,
    supersedes,
    supersededBy,
    scrutiny,
    title,
    sections,
    history,
  };
}

function readFrontmatter(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const m = /^([a-z_]+): (.*)$/.exec(line);
    if (!m) {
      throw new RecordFormatError(
        `frontmatter line is not "key: value": "${line}"`,
      );
    }
    const key = m[1]!;
    if (fields.has(key)) {
      throw new RecordFormatError(`duplicate frontmatter key "${key}"`);
    }
    fields.set(key, m[2]!);
  }
  for (const key of FRONTMATTER_KEYS) {
    if (!fields.has(key)) {
      throw new RecordFormatError(`frontmatter is missing "${key}"`);
    }
  }
  for (const key of fields.keys()) {
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      throw new RecordFormatError(`unknown frontmatter key "${key}"`);
    }
  }
  return fields;
}

function getField(fields: Map<string, string>, key: string): string {
  // readFrontmatter guarantees presence; this keeps the type checker honest.
  return fields.get(key)!;
}

function parseScrutiny(value: string): Scrutiny {
  const m = SCRUTINY_RE.exec(value);
  if (!m) {
    throw new RecordFormatError(
      `scrutiny is not in canonical form (and may carry no extra fields): "${value}"`,
    );
  }
  return {
    context: m[1] as Scrutiny['context'],
    alternatives: Number(m[2]),
    precedent: m[3] as Scrutiny['precedent'],
    consequences: m[4] as Scrutiny['consequences'],
    objections: { open: Number(m[5]), addressed: Number(m[6]) },
  };
}

function parseSupersedes(value: string): number[] {
  const m = /^\[(.*)\]$/.exec(value);
  if (!m) {
    throw new RecordFormatError(`supersedes must be a "[...]" list, got "${value}"`);
  }
  const inner = m[1]!;
  if (inner === '') return [];
  return inner
    .split(', ')
    .map((part) => parseCount(part, 'supersedes entry'));
}

function parseSupersededBy(value: string): number | null {
  if (value === 'null') return null;
  return parseCount(value, 'superseded_by');
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

// A section body may hold any Markdown below `###` — but a line that would
// itself parse as an `#`/`##` heading would silently change the record's
// structure on the next parse, so both directions reject it.
function assertSectionBody(body: string, heading: string): void {
  for (const line of body.split('\n')) {
    if (/^#{1,2}(?:\s|$)/.test(line)) {
      throw new RecordFormatError(
        `section "${heading}" contains a line that would parse as a heading: "${line}"`,
      );
    }
  }
}

function assertDate(value: string, field: string): void {
  if (!DATE_RE.test(value)) {
    throw new RecordFormatError(`${field} must be YYYY-MM-DD, got "${value}"`);
  }
}

function parseDate(value: string, field: string): string {
  assertDate(value, field);
  return value;
}

function assertCount(value: number, field: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RecordFormatError(
      `${field} must be an integer >= ${min}, got ${value}`,
    );
  }
}

function parseCount(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new RecordFormatError(
      `${field} must be a non-negative integer, got "${value}"`,
    );
  }
  return Number(value);
}

function assertEnum(
  value: string,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  if (!allowed.has(value)) {
    throw new RecordFormatError(
      `${field} must be one of [${[...allowed].join(', ')}], got "${value}"`,
    );
  }
}

function parseEnum<T extends string>(
  value: string,
  allowed: ReadonlySet<string>,
  field: string,
): T {
  assertEnum(value, allowed, field);
  return value as T;
}
