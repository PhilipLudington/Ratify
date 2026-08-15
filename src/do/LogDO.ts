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

export interface LogEnv {
  /** Bound so the DO can address sibling logs later; unused in Phase 0. */
  LOG: DurableObjectNamespace;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;
  ANTHROPIC_MODEL: string;
  /** Set as a secret; absent until Phase 2 wires up the agent. */
  ANTHROPIC_API_KEY?: string;
}

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
    const { pathname } = new URL(request.url);

    if (pathname === '/ping') {
      if (request.method === 'GET') return this.readPing();
      if (request.method === 'POST') return this.writePing(request);
      return this.json({ error: 'Method not allowed.' }, 405);
    }

    return this.json({ error: `No route for ${pathname}.` }, 404);
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
