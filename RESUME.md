# RESUME — Ratify Phase 1: The Log

**Last updated:** 2026-08-21 (seeds authored + first-wake seeding wired)
**Branch:** main (all work commits directly to main — see Open Threads)
**Related:** [PLAN.md](PLAN.md) Phase 1; Phase 0 complete but for one task

## What We're Doing

Building v0 of Ratify, a conversational decision-record engine: a chat agent
that pressure-tests an engineering decision, checks it against the existing
decision log, and — on the human's command — ratifies it into a numbered,
permanent, versioned record. It is a Cloudflare assignment build and a
portfolio piece.

Read these first, in order. They are short and they govern the work:
[PHILOSOPHY.md](PHILOSOPHY.md) (five **ordered** principles — earlier beats
later in a tie), [DESIGN.md](DESIGN.md) (v0's shape and, critically, its
Non-Goals fence), [PLAN.md](PLAN.md) (phase order and readiness gates).
[CLAUDE.md](CLAUDE.md) lists what is load-bearing and must not be relaxed.

**Phase 0 is finished and deployed.** Phase 1, "The Log", is in flight:
records exist and a fresh sandbox self-seeds six of them. What remains is
making them *visible* — the log view UI and the two read APIs — before any
agent exists.

## Done So Far

- [x] Phase 0 in full, bar the custom hostname. Deployed and verified in
      production at <https://ratify-4pp.pages.dev>
- [x] Two-deployment topology, because a Pages Function can bind to a Durable
      Object but cannot define one: `wrangler.toml` (Pages: client + doorman)
      and `wrangler.log.toml` (the `ratify-log` Worker that defines `LogDO`,
      no public route). **Deploy order is not optional** — `npm run deploy:log`
      before `npm run deploy:pages`
- [x] The doorman — `src/worker/doorman.ts`, `src/worker/session.ts`:
      constant-time passphrase check, HMAC-signed session cookie, sandbox DO
      address derived as `sandbox:{sessionId}`, forwarding with the `/api`
      prefix stripped. Holds no state, makes no decisions
- [x] `LogDO` — `src/do/LogDO.ts`: Phase 0 scope only, a `/ping` storage
      round-trip that proves persistence and reports its own object ID
- [x] `GET /api/version` — reports which deployment is serving, its commit, and
      whether each secret is present. Ungated and answered before the config
      check, so it works on a deployment refusing everything else
- [x] Client shell — vanilla TS + Vite, `src/client/`. Passphrase form plus a
      visible round-trip panel
- [x] 36 tests in the real workerd runtime via `@cloudflare/vitest-pool-workers`
- [x] `scripts/verify-gate.sh` (live readiness check, 17/17 green) and
      `scripts/set-passphrase.sh` (set + deploy + verify in one pass)
- [x] AirTower wired: `.airtower.json`, `run-tests.sh`, `run-build.sh`
- [x] Repo public at <https://github.com/PhilipLudington/Ratify>, FSL-1.1-MIT
- [x] `src/shared/record.ts` — the record format types (2026-08-16): `AdrRecord`
      (named so because `Record` shadows TS's built-in utility type), `Index`,
      `Scrutiny`, `RecordSections`, `HistoryEntry`, plus `citeAdr()`. Both
      tsconfigs already included `src/shared/`; build and tests green (36)
- [x] `src/shared/format.ts` — `serializeRecord` / `parseRecord` /
      `RecordFormatError` (2026-08-16): zero-dependency, strict-canonical,
      fail-loud parser for the house format (not general YAML/Markdown).
      Emitted frontmatter is still valid plain YAML so exports read in
      standard tools. Divergence from DESIGN.md's sketch, recorded in
      PLAN.md: objections tally serializes as `{open: n, addressed: m}`, not
      the lossy `1-open` shorthand. A scrutiny value carrying any extra
      field (e.g. "rightness") fails to parse — the gauge prohibition
      enforced at the format layer, with a test pinning it
- [x] `tests/record-format.test.ts` (2026-08-16): seeded-PRNG round-trip
      property test (300 generated records, no new dependency), byte-
      stability `serialize(parse(text)) === text` (what makes Phase 5's
      "exports re-parse losslessly" gate checkable), the shapes PLAN.md's
      testing strategy names, and strict-rejection cases. Suite now 58
      passing; `./run-build.sh` green
- [x] `src/do/storage.ts` — `LogStorage` accessors for every schema key
      (2026-08-20): `meta`, `index`, `record:{n}`, `record:{n}:v{k}`, `draft`.
      Records and snapshots store canonical Markdown **text** as the single
      truth (decision committed — see Open Threads); `putRecord` serializes
      (so nothing malformed reaches disk), `getRecord` parses fail-loud,
      `putSnapshot` validates the text parses and is the right ADR. `Meta` is
      `{schemaVersion: 1, nextNumber, created, kind}`; `initMeta` throws on
      re-init; `allocateNumber()` is the only number source. `Draft`'s empty
      shape is fixed (`emptyDraft()`): title, sections, supersedes,
      precedent, objections tally, `conversation: unknown[]` (element shape
      is Phase 2's). `tests/log-storage.test.ts` runs it all in the real DO
      via `runInDurableObject` — suite now 79 passing, build green
- [x] `src/do/seeds.ts` — the six Latchkey starter ADRs (2026-08-21), authored
      as `AdrRecord` values so the serializer validates them on the way to
      disk. Latchkey: four engineers, appointment scheduling for repair
      shops. Quotable conflict lines target what a reviewer actually brings:
      a broker (ADR-4), a second datastore (ADR-3), Kubernetes (ADR-5),
      self-hosting (ADR-2). ADR-1→ADR-3 is the supersession chain; ADR-6
      (monorepo) carries the open objection. `tests/seeds.test.ts` pins the
      invariants the real ratify path will enforce
- [x] First-wake seeding wired (2026-08-21, `LogDO.ensureInitialized`,
      commit 1c526bc). The doorman stamps `X-Ratify-Log-Kind` on every
      forwarded request (the DO cannot recover its name from `state.id`);
      sandbox logs seed the six ADRs, named logs seed empty. Missing kind →
      400 before storage is touched; kind contradicting stored `meta` → 500.
      Seed numbers are pulled through `allocateNumber()` one at a time, so
      numbering is sourced solely from `meta` even for fiction;
      `blockConcurrencyWhile` + the output gate make first wake atomic.
      Suite now 97 passing, build green

## Next Steps

Phase 1's tasks, in PLAN.md order. The first item is the literal next action.

- [ ] Build the log view: index list with status badges, record detail page
- [ ] Render supersession links in both directions in the detail view
- [ ] Add `GET /api/log` and `GET /api/record/:n` through the Worker

## Open Threads / Half-Made Decisions

- **Stored form of a record: DECIDED and committed (2026-08-20) — canonical
  Markdown text, not JSON.** `src/do/storage.ts` stores serialized text under
  `record:{n}` and `record:{n}:v{k}`; no JSON twin exists anywhere. The three
  reasons that forced it: Principle 1 makes the plain file *the* record;
  Phase 4's quote verification substring-checks the stored text; and
  byte-stability is pinned by test. Do not add a parallel representation.
- **`meta` shape: DECIDED (2026-08-20).** `{schemaVersion: 1, nextNumber,
  created, kind: 'sandbox'|'named'}`. No separate `seeded` flag — `meta`'s
  *presence* is the initialized marker, because seeding must write `meta` in
  the same DO invocation that writes the seed records. `initMeta` throws if
  meta exists (re-init would reset the counter).
- **The `draft` key's empty shape: DECIDED (2026-08-20).** `emptyDraft()` in
  `src/do/storage.ts`: empty title/sections, `supersedes: []`,
  `precedent: 'unchecked'`, `objections: {open: 0, addressed: 0}`,
  `conversation: []`. `precedent` and the objections tally are stored
  explicitly because they are facts about the conversation, not derivable
  from section text; section coverage and the alternatives count are derived
  from `sections` and never stored. The `conversation` element shape is
  deliberately `unknown` — Phase 2 owns it, and an empty array migrates for
  free.
- **`IndexEntry.decision` one-liner: DECIDED the other way (2026-08-21) —
  separately authored, not derived.** An earlier lean toward deriving it from
  the first sentence of `## Decision` was overtaken: seeds carry an authored
  `Seed.decision` line, denormalized into the index by `seedIndex()`. The
  index line is tier-1 context the precedent check scans, and a first
  sentence is not reliably the decision in one scannable line. Do not
  "simplify" this back to derivation. (The real ratify path in Phase 3 will
  need its own ruling on where the line comes from for user records.)
- **Seed quality risk: addressed, verdict pending.** The seeds were authored
  against the decisions a reviewer actually brings (broker, second datastore,
  Kubernetes, self-hosting) per the risk register. Whether they trip a
  *natural* conflict is only provable at Phase 4's gate with a real cold
  attempt — leave that gate honest.
- **`src/shared/` now exists**, created by `record.ts` (2026-08-16). It was
  deliberately absent through Phase 0 — nothing was shared, and an empty
  directory is not a scaffold.
- **The passphrase is known only to the human.** It was set with
  `scripts/set-passphrase.sh` and never echoed, because Phase 6 assembles
  `docs/prompt-history.md` from these sessions into the public repo. Do not ask
  for it in a transcript; if a live check is needed, have the human run
  `scripts/verify-gate.sh` themselves. Local dev has its own value in
  `.dev.vars` (gitignored).
- **Passphrase trimming is unverified as a fix.** `handleAuth` trims both sides
  before comparing, added while chasing a production 401. The real cause turned
  out to be elsewhere (two separate prompts capturing different bytes). The
  trim is defensible on its own merits and has four tests pinning it — but do
  not cite it as the thing that fixed the gate, because it was not.
- **Deploying is full of traps that all look identical from outside** — a flat
  401 or 500. A non-TTY `wrangler pages secret put` uploads an empty value and
  reports success; Pages binds secrets only at deploy time; and the binding
  trails the deployment flip by a few seconds even after `/api/version` reports
  the new build live. Start any deploy problem at `curl .../api/version`. Full
  account is in PLAN.md § Decided During Phase 0.
- **Custom hostname is the one Phase 0 task left.** `ratify.philipludington.com`
  needs the Cloudflare dashboard — wrangler 4.123 has no `pages domain`
  command — and needs that zone to be on the "Mr. Phil Games" account, which is
  unconfirmed. `pages.dev` is the named fallback; nothing is blocked.
- **`ANTHROPIC_API_KEY` was moved from Phase 0 to Phase 2**, where it is first
  used. It is not set yet, and Phase 1 does not need it.
- **No git worktrees, and commits only when asked.** Work directly on `main` —
  the whole history is on it, and DESIGN.md treats that history as part of the
  portfolio artifact.

## How to Verify

Phase 1 is done when its readiness gate passes:

- [ ] A brand-new session shows six seeded records — the storage half is done
      and tested; "shows" waits on the log view
- [x] Record format round-trips losslessly, verified by test (2026-08-16)
- [x] The seeded log contains at least one supersession chain (ADR-1→ADR-3)
      and one open objection (ADR-6), pinned by `tests/seeds.test.ts`
      (2026-08-21)
- [x] Numbering is monotonic and sourced solely from `meta` — seeding pulls
      every number through `allocateNumber()`, pinned by test (2026-08-21)

The gates to run:

```sh
./run-tests.sh     # must stay green; currently 97 passing
./run-build.sh     # typechecks both halves, builds, dry-runs the DO Worker
```

Never run `npm test`, `vitest`, `vite build`, or `tsc` directly — the wrappers
write the JSON files AirTower reads, and bypassing them leaves the badge stale.

For the deployed stack (needs the human, who has the passphrase):

```sh
scripts/verify-gate.sh https://ratify-4pp.pages.dev    # 17/17 as of 2026-08-15
```

Local dev is two terminals, because it is two deployments:

```sh
npm run dev:pages                                    # :8788 client + doorman
npx wrangler dev -c wrangler.log.toml --port 8787    # the LogDO
```

They find each other through Wrangler's dev registry. Look for
`env.LOG (LogDO, defined in ratify-log) … [connected]`.

---

Delete this file once Phase 1 is complete — its state will live in PLAN.md's
checkboxes and the committed work.
