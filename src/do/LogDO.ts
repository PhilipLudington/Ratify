// LogDO — one Durable Object per decision log.
//
// DESIGN.md, System Topology: this is the product. It owns all storage, runs
// the agent loop, executes the precedent check, verifies quotes, assigns
// numbers, and writes records. Cloudflare's single-threading guarantee is what
// makes ratification's multi-step write atomic in effect, so those steps stay
// here rather than being split across the doorman.
//
// Phase 0 implements none of that. What it implements is proof that the pipe
// works end to end: a value written on one request is still here on the next,
// and this instance can name itself so session isolation is observable.

import { SEEDS, seedIndex } from './seeds';
import { LogStorage } from './storage';
import type { LogKind } from './storage';

export interface LogEnv {
  /** Bound so the DO can address sibling logs later; unused in Phase 0. */
  LOG: DurableObjectNamespace;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;
  ANTHROPIC_MODEL: string;
  /** Set as a secret; absent until Phase 2 wires up the agent. */
  ANTHROPIC_API_KEY?: string;
}

/**
 * Header the doorman sets on every forwarded request to say what kind of log
 * it addressed. The DO cannot recover its own name from `state.id`, so the
 * caller who derived the address is the only one who knows whether this log
 * is a session sandbox or an owner's named log — and the kind decides what a
 * first wake seeds.
 */
export const LOG_KIND_HEADER = 'X-Ratify-Log-Kind';

/** Storage key holding the Phase 0 round-trip value. */
const PING_KEY = 'ping';

export interface PingRecord {
  note: string;
  writes: number;
  updatedAt: string;
}

export class LogDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: LogEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const kind = request.headers.get(LOG_KIND_HEADER);
    if (kind !== 'sandbox' && kind !== 'named') {
      // Fail loud before touching storage: a request that cannot say what
      // kind of log it addressed must not decide what a first wake seeds.
      return this.json(
        { error: `${LOG_KIND_HEADER} must be "sandbox" or "named".` },
        400,
      );
    }

    const initFailure = await this.ensureInitialized(kind);
    if (initFailure !== null) return initFailure;

    const { pathname } = new URL(request.url);

    if (pathname === '/ping') {
      if (request.method === 'GET') return this.readPing();
      if (request.method === 'POST') return this.writePing(request);
      return this.json({ error: 'Method not allowed.' }, 405);
    }

    return this.json({ error: `No route for ${pathname}.` }, 404);
  }

  /**
   * First wake: initialize the log before serving anything. A sandbox seeds
   * the six Latchkey starter ADRs so the demo opens on a populated, readable
   * log; a named log seeds empty — its history is the owner's to write.
   *
   * Seed numbers are pulled through `allocateNumber()` one by one rather than
   * jumping the counter, so even fictional numbering is sourced solely from
   * `meta`. `blockConcurrencyWhile` keeps a second request from observing the
   * log mid-seed, and the platform's output gate holds every response until
   * the writes are durable — a half-seeded log is never visible.
   *
   * Returns an error response when this log was addressed as a kind it is
   * not; that is a doorman addressing bug, and serving anything from the
   * wrong log would cross session boundaries.
   */
  private ensureInitialized(kind: LogKind): Promise<Response | null> {
    return this.state.blockConcurrencyWhile(async () => {
      const log = new LogStorage(this.state.storage);

      const meta = await log.getMeta();
      if (meta !== null) {
        if (meta.kind !== kind) {
          return this.json(
            { error: `This log is ${meta.kind} but was addressed as ${kind}.` },
            500,
          );
        }
        return null;
      }

      await log.initMeta(kind, new Date().toISOString());
      if (kind === 'sandbox') {
        for (const seed of SEEDS) {
          const number = await log.allocateNumber();
          if (number !== seed.record.number) {
            throw new Error(
              `seeding expected the counter to allocate ${seed.record.number}, got ${number}`,
            );
          }
          await log.putRecord(seed.record);
        }
        await log.putIndex(seedIndex());
      }
      return null;
    });
  }

  /** Read back whatever this log last stored. Empty storage is not an error. */
  private async readPing(): Promise<Response> {
    const stored = await this.state.storage.get<PingRecord>(PING_KEY);
    return this.json({ log: this.state.id.toString(), ping: stored ?? null });
  }

  private async writePing(request: Request): Promise<Response> {
    let note = '';
    try {
      const body = (await request.json()) as { note?: unknown };
      if (typeof body.note === 'string') note = body.note;
    } catch {
      return this.json({ error: 'Expected a JSON body.' }, 400);
    }

    const previous = await this.state.storage.get<PingRecord>(PING_KEY);
    const record: PingRecord = {
      note,
      writes: (previous?.writes ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.state.storage.put(PING_KEY, record);

    return this.json({ log: this.state.id.toString(), ping: record });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
