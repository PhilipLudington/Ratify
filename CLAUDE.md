# Ratify — Claude Code Instructions

## Read these first

The project is built through a document pipeline. Before changing anything,
know which document governs the change:

- [PHILOSOPHY.md](PHILOSOPHY.md) — five **ordered** principles. When two good
  options tie, the earlier principle wins. This is the tie-breaker, not a
  preamble.
- [DESIGN.md](DESIGN.md) — what v0 is, and the **Non-Goals** fence. If a change
  is on the wrong side of that fence, it does not ship in v0 regardless of how
  small it looks.
- [PLAN.md](PLAN.md) — the phase order and each phase's readiness gate.

## Running tests

```bash
./run-tests.sh
```

Do NOT run `npm test`, `vitest`, or `npx vitest` directly. The wrapper writes
`.test-results.json`, which is what the AirTower badge reads; running the tool
directly leaves the badge stale.

## Building

```bash
./run-build.sh
```

Do NOT run `npm run build`, `vite build`, or `tsc` directly, for the same
reason — the wrapper writes `.build-results.json`. It also regenerates
`worker-configuration.d.ts` from `wrangler.log.toml`, so a config change that
breaks types surfaces here rather than at deploy time.

## Deploying

Two deployments, and the order is not optional:

```bash
npm run deploy:log      # ratify-log — defines the LogDO class
npm run deploy:pages    # ratify — the client and the doorman
```

A Pages Function can bind to a Durable Object but cannot define one, so the
class lives in its own Worker and Pages reaches it through `script_name`.
Deploying Pages against a `ratify-log` that does not yet have the class leaves
the `LOG` binding pointing at nothing.

## Where code belongs

| Path | Holds |
|---|---|
| `functions/` | Pages Function entry points only — doorways, no logic |
| `src/worker/` | the doorman: gate, session cookie, DO addressing, forwarding |
| `src/do/` | `LogDO` — storage, agent loop, precedent check, ratification |
| `src/shared/` | types and the record format, used by both DO and client |
| `src/client/` | vanilla TypeScript, no framework |
| `tests/` | Vitest, running in the real workerd runtime |

The doorman "holds no state and makes no decisions" (DESIGN.md). If logic
starts accumulating in `src/worker/`, it belongs in the Durable Object.

Ratification's multi-step write lives in the DO specifically because
single-threading makes it atomic in effect. Do not move any part of it out.

## Things that are load-bearing

- **Quote verification.** `raise_conflict` must verify the quote is an exact
  substring of the stored record, in code, inside the DO, before anything
  reaches the client. Never relax this to make the model's life easier; on
  repeated failure, suppress the claim instead.
- **Ratify is never gated.** No disabled state, no "complete these sections
  first", no nagging copy. A nearly-empty draft must ratify into a valid record.
- **The scrutiny gauge is descriptive.** Derived mechanically from draft state,
  never from model judgment. No target state, no praise, no correctness or
  "rightness" score — that last one is forbidden outright.
- **Record numbers are never reused or renumbered**, and come only from `meta`.
- **No secret enters git.** Local values live in `.dev.vars` (gitignored);
  deployed values are set through Wrangler.
