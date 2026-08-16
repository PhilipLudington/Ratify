// The record format — DESIGN.md § The Record Format.
//
// This module is the single source of truth for what a record *is*, shared by
// the Durable Object (which stores and mutates records) and the client (which
// renders them). A house format, deliberately MADR-shaped: YAML frontmatter
// carries the machine-readable fields, prose sections carry the human content,
// and `## Objections` + `## History` are the two sections that are Ratify's
// signature.
//
// Naming: PLAN.md calls this the `Record` type, but `Record` is a TypeScript
// built-in utility type, and a shared module must not shadow it. The unit is
// an ADR (DESIGN.md: A = Any, per MADR's own rename), so the type is
// `AdrRecord`.

/**
 * Lifecycle status. `superseded` records stay in the log and keep their
 * number; `redacted` removes content, never the fact that content existed.
 */
export type RecordStatus = 'ratified' | 'superseded' | 'redacted';

/**
 * How covered a prose section is. Derived mechanically from draft state,
 * never from model judgment — this is the scrutiny gauge's vocabulary
 * (rendered ○ / ◐ / ●).
 */
export type SectionCoverage = 'none' | 'partial' | 'full';

/**
 * Where the precedent check stands for a decision. `unchecked` exists only
 * for drafts; by ratification the check has always run (pinned behavior 1).
 */
export type PrecedentStatus =
  | 'unchecked'
  | 'checked'
  | 'conflict'
  | 'conflict-resolved';

/**
 * Objections tallied by fate. `open` objections are pushback that lost and
 * was preserved verbatim in `## Objections`; `addressed` ones were resolved
 * in conversation. Both counts are facts about the draft, not judgments.
 */
export interface ObjectionsTally {
  open: number;
  addressed: number;
}

/**
 * The scrutiny gauge: a coverage snapshot, never a score. Stamped into
 * frontmatter at ratification so the log remembers how examined each decision
 * was. A correctness or "rightness" field is forbidden outright (DESIGN.md
 * § The Scrutiny Gauge) — do not add one.
 */
export interface Scrutiny {
  context: SectionCoverage;
  /** Count of alternatives recorded, not a quality measure. */
  alternatives: number;
  precedent: PrecedentStatus;
  consequences: SectionCoverage;
  objections: ObjectionsTally;
}

/**
 * The prose sections, in canonical order. Values are Markdown bodies without
 * their `##` heading; empty string means the section is present but empty —
 * a nearly-empty draft still ratifies into a valid record (Principle 4), so
 * every section always exists.
 *
 * Deliberate omission (DESIGN.md): no "Pros and Cons of the Options". The
 * conversation is where options get weighed; the record keeps the
 * alternatives and the verdict.
 */
export interface RecordSections {
  context: string;
  decision: string;
  alternativesConsidered: string;
  consequences: string;
  /** Unresolved pushback, verbatim — the argument that lost, preserved. */
  objections: string;
}

/**
 * One line of `## History`: the human-readable changelog, one entry per
 * version. Snapshots (`record:{n}:v{k}`) are the proof; this is the index
 * into them that needs no tooling to read.
 */
export interface HistoryEntry {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** What happened, e.g. `ratified (v1)` or `amended (v2): fixed typo in Context`. */
  note: string;
}

/**
 * A full decision record — one `.md` file, one `record:{n}` storage key.
 *
 * Invariants the type cannot express:
 * - `number` comes only from `meta`'s counter; never reused, never renumbered.
 * - `supersedes` / `supersededBy` are written in both directions in the same
 *   DO invocation — a link on disk is always mirrored.
 * - `history` is append-only and never empty once ratified (v1 is the first line).
 */
export interface AdrRecord {
  number: number;
  status: RecordStatus;
  /** ISO date of ratification, `YYYY-MM-DD`. */
  date: string;
  /** Record numbers this one supersedes; empty when it overturns nothing. */
  supersedes: number[];
  /** The record that superseded this one, or null while it stands. */
  supersededBy: number | null;
  scrutiny: Scrutiny;
  /** Title without the `ADR-{n}: ` prefix; the prefix is derived from `number`. */
  title: string;
  sections: RecordSections;
  history: HistoryEntry[];
}

/**
 * One compact line in the log's index — the tier-1 context the precedent
 * check reads on every turn (DESIGN.md § The Precedent Check), and the row
 * the log view lists. Everything here is denormalized from the record it
 * points at; the record is the truth.
 */
export interface IndexEntry {
  number: number;
  title: string;
  status: RecordStatus;
  /** The decision in one sentence, for index-line scanning. */
  decision: string;
}

/**
 * The whole index, stored under the `index` key: every record's line, in
 * ascending record order with no recency filter — old precedent is exactly
 * what nobody in the room remembers.
 */
export type Index = IndexEntry[];

/** The canonical citation form: `ADR-7`. */
export function citeAdr(number: number): string {
  return `ADR-${number}`;
}
