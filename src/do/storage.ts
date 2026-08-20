// The Log's storage schema — DESIGN.md § The Log (Durable Object).
//
// Every key the schema names gets its accessor here, and nothing else in the
// DO touches `state.storage` directly. The version-trail keys ship now, in
// Phase 1, even though no amendment UI ever does in v0 — the schema is the
// contract, not the interface.
//
// | Key               | Value                                              |
// |-------------------|----------------------------------------------------|
// | `meta`            | schema version, next-number counter, created, kind |
// | `index`           | one compact line per record (`Index`)              |
// | `record:{n}`      | current canonical Markdown text of ADR-n           |
// | `record:{n}:v{k}` | full snapshot of ADR-n as of version k             |
// | `draft`           | the in-progress draft + conversation history       |
//
// The stored form of a record is its canonical Markdown text, not JSON.
// Principle 1 makes the plain file *the* record, so stored bytes and exported
// bytes are identical by construction; Phase 4's quote verification checks an
// exact substring "of the stored record", which is only meaningful against
// text; and the byte-stability property (`serializeRecord(parseRecord(text))
// === text`) is already pinned by test. Never store a JSON twin alongside the
// text — they will drift.

import type {
  AdrRecord,
  Index,
  ObjectionsTally,
  PrecedentStatus,
  RecordSections,
} from '../shared/record';
import { citeAdr } from '../shared/record';
import { parseRecord, serializeRecord } from '../shared/format';

/** Sandbox logs self-seed and self-expire; named logs seed empty and persist. */
export type LogKind = 'sandbox' | 'named';

/**
 * The `meta` key. Its *presence* is the initialized marker — seeding writes
 * `meta` in the same DO invocation that writes the seed records, so there is
 * no separate `seeded` flag to fall out of sync with reality.
 */
export interface Meta {
  /** Bumped only by a migration; readers may refuse versions they predate. */
  schemaVersion: 1;
  /**
   * The number the next ratification will take. Only ever increments —
   * numbers are never reused and never renumbered, no matter what happens
   * to the records that hold them.
   */
  nextNumber: number;
  /** ISO 8601 timestamp of first wake. */
  created: string;
  kind: LogKind;
}

/**
 * The `draft` key: the one record-in-progress plus everything the agent loop
 * needs to resume it. Phase 1 fixes this shape so Phase 2 fills it without a
 * storage migration.
 *
 * The scrutiny gauge is *derived* from this state, never stored on it:
 * section coverage and the alternatives count are read off `sections`, while
 * `precedent` and `objections` live here explicitly because they are facts
 * about the conversation, not recoverable from the draft's text.
 */
export interface Draft {
  title: string;
  sections: RecordSections;
  /** Record numbers this draft will supersede if ratified. */
  supersedes: number[];
  precedent: PrecedentStatus;
  objections: ObjectionsTally;
  /** Anthropic conversation turns; the element shape is Phase 2's to own. */
  conversation: unknown[];
}

/** What a draft looks like before anyone has said anything. */
export function emptyDraft(): Draft {
  return {
    title: '',
    sections: {
      context: '',
      decision: '',
      alternativesConsidered: '',
      consequences: '',
      objections: '',
    },
    supersedes: [],
    precedent: 'unchecked',
    objections: { open: 0, addressed: 0 },
    conversation: [],
  };
}

const META_KEY = 'meta';
const INDEX_KEY = 'index';
const DRAFT_KEY = 'draft';

export function recordKey(n: number): string {
  return `record:${n}`;
}

export function snapshotKey(n: number, k: number): string {
  return `record:${n}:v${k}`;
}

/** Prefix under which every version snapshot of ADR-n lives, and nothing else. */
function snapshotPrefix(n: number): string {
  return `record:${n}:v`;
}

/**
 * Every storage access the Log makes, behind intention-revealing names.
 * Methods are fail-loud: reading a record that does not parse, or writing one
 * that does not serialize, throws rather than guessing — corruption surfaces
 * at the boundary it crossed, not three features later.
 */
export class LogStorage {
  constructor(private readonly storage: DurableObjectStorage) {}

  // --- meta -----------------------------------------------------------------

  /** `null` means this log has never been initialized (and never seeded). */
  async getMeta(): Promise<Meta | null> {
    return (await this.storage.get<Meta>(META_KEY)) ?? null;
  }

  /**
   * Create `meta` for a log waking for the first time. Throws if it already
   * exists: re-initializing would reset the next-number counter, and a reused
   * number is the one corruption the log cannot recover from.
   */
  async initMeta(kind: LogKind, created: string): Promise<Meta> {
    if ((await this.getMeta()) !== null) {
      throw new Error('meta already exists; a log is initialized exactly once');
    }
    const meta: Meta = { schemaVersion: 1, nextNumber: 1, created, kind };
    await this.storage.put(META_KEY, meta);
    return meta;
  }

  /**
   * Take the next record number and advance the counter. Numbers come only
   * from here — never from the index, never from counting records — and the
   * DO's single-threading makes take-and-advance atomic in effect.
   */
  async allocateNumber(): Promise<number> {
    const meta = await this.getMeta();
    if (meta === null) {
      throw new Error('cannot allocate a record number before the log is initialized');
    }
    const number = meta.nextNumber;
    await this.storage.put(META_KEY, { ...meta, nextNumber: number + 1 });
    return number;
  }

  // --- index ----------------------------------------------------------------

  /** An uninitialized log has an empty index, not a missing one. */
  async getIndex(): Promise<Index> {
    return (await this.storage.get<Index>(INDEX_KEY)) ?? [];
  }

  async putIndex(index: Index): Promise<void> {
    await this.storage.put(INDEX_KEY, index);
  }

  // --- records --------------------------------------------------------------

  /**
   * The stored bytes of ADR-n, exactly as export and quote verification will
   * see them. `null` when no such record exists.
   */
  async getRecordText(n: number): Promise<string | null> {
    return (await this.storage.get<string>(recordKey(n))) ?? null;
  }

  /** ADR-n parsed. Throws if the stored text is not canonical — see class doc. */
  async getRecord(n: number): Promise<AdrRecord | null> {
    const text = await this.getRecordText(n);
    return text === null ? null : parseRecord(text);
  }

  /**
   * Serialize and store a record under the key its own number names. The
   * serializer validates everything on the way in, so a malformed record
   * never reaches disk.
   */
  async putRecord(record: AdrRecord): Promise<void> {
    await this.storage.put(recordKey(record.number), serializeRecord(record));
  }

  // --- version snapshots ------------------------------------------------------

  async getSnapshotText(n: number, k: number): Promise<string | null> {
    return (await this.storage.get<string>(snapshotKey(n, k))) ?? null;
  }

  /**
   * Store the pre-amendment text of ADR-n as version k. Takes text, not a
   * record, because a snapshot's job is to preserve the exact stored bytes —
   * but it is parsed on the way in so a corrupt snapshot cannot be written,
   * and the text must actually be ADR-n.
   */
  async putSnapshot(n: number, k: number, text: string): Promise<void> {
    if (k < 1 || !Number.isInteger(k)) {
      throw new Error(`snapshot version must be an integer >= 1, got ${k}`);
    }
    const parsed = parseRecord(text);
    if (parsed.number !== n) {
      throw new Error(
        `snapshot text is ${citeAdr(parsed.number)}, not ${citeAdr(n)}`,
      );
    }
    await this.storage.put(snapshotKey(n, k), text);
  }

  /** The version numbers snapshotted for ADR-n, ascending. `[]` when none. */
  async getSnapshotVersions(n: number): Promise<number[]> {
    const entries = await this.storage.list({ prefix: snapshotPrefix(n) });
    return [...entries.keys()]
      .map((key) => Number(key.slice(snapshotPrefix(n).length)))
      .sort((a, b) => a - b);
  }

  // --- draft ------------------------------------------------------------------

  /** There is always a draft; before any conversation it is the empty one. */
  async getDraft(): Promise<Draft> {
    return (await this.storage.get<Draft>(DRAFT_KEY)) ?? emptyDraft();
  }

  async putDraft(draft: Draft): Promise<void> {
    await this.storage.put(DRAFT_KEY, draft);
  }

  /** Ratification's last step: the draft is spent, the next one starts empty. */
  async clearDraft(): Promise<void> {
    await this.storage.delete(DRAFT_KEY);
  }
}
