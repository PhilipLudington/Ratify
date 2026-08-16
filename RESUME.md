# RESUME — Ratify Phase 1: The Log

**Last updated:** 2026-08-16 (record/Index types landed)
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

**Phase 0 is finished and deployed.** The next task is Phase 1, "The Log":
make records exist, be addressable, and be visible — a seeded sandbox log
rendering in a log view, before any agent exists.

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

## Next Steps

Phase 1's tasks, in PLAN.md order. The first item is the literal next action.

- [ ] Implement frontmatter + section serialization and its inverse parse
      (house format is MADR-shaped; see DESIGN.md § The Record Format). The
      scrutiny frontmatter's compact forms — `objections: 1-open`, the flow
      style in DESIGN.md's example — are a serializer concern; the types keep
      objections structured as `{open, addressed}`
- [ ] Round-trip property test: `parse(serialize(r))` deep-equals `r`
- [ ] Implement DO storage accessors for every key in the schema — `meta`,
      `index`, `record:{n}`, `record:{n}:v{k}`, `draft`. The version-trail keys
      ship now even though no amendment UI ever does in v0
- [ ] Implement `meta` with the next-number counter (never reused, never
      renumbered, sourced solely from `meta`)
- [ ] Author six starter ADRs for a fictional team: datastore choice, a
      managed-services-first rule, a queue decision, a deploy-target decision,
      a superseded early call, and one record carrying an open objection
- [ ] Wire self-seeding on first wake when storage is empty; named logs seed
      empty
- [ ] Build the log view: index list with status badges, record detail page
- [ ] Render supersession links in both directions in the detail view
- [ ] Add `GET /api/log` and `GET /api/record/:n` through the Worker

## Open Threads / Half-Made Decisions

- **The seed ADRs are the highest-risk item in Phase 1**, and their risk is not
  technical. PLAN.md's risk register flags "seeds produce contrived rather than
  natural conflicts" as high-impact. Author them against the decisions a
  reviewer actually brings — a queue, a datastore, a deploy target — so the
  first decision brought in Phase 4 trips a *real* precedent conflict. Do not
  write six records about the same subsystem.
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

- [ ] A brand-new session shows six seeded records
- [ ] Record format round-trips losslessly, verified by test
- [ ] The seeded log contains at least one supersession chain and one open
      objection
- [ ] Numbering is monotonic and sourced solely from `meta`

The gates to run:

```sh
./run-tests.sh     # must stay green; currently 36 passing
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
