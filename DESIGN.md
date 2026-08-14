# Ratify — Design

## Overview

Ratify is a conversational decision-record engine: a chat agent that
pressure-tests an engineering decision, checks it against the existing
decision log, and — on the human's command — ratifies it into a numbered,
permanent, versioned record. The conversation *is* the documentation work.
See [IDEA.md](IDEA.md) for the founding idea and
[PHILOSOPHY.md](PHILOSOPHY.md) for the ordered principles this design is
bound by.

This document covers v0: the Cloudflare DevTools assignment build (AI app on
Workers / Durable Objects / Pages) and the durable portfolio piece. The
assignment shapes the stack, not the idea. All nine open questions from
IDEA.md were resolved in the design conversation of 2026-08-13/14; the
rulings and their rationale are recorded under Key Decisions.

## Goals

- [ ] A visitor can bring a decision to the chat, get pressure-tested, and
      ratify it into a numbered permanent record — with ratify available at
      every moment of the conversation.
- [ ] The precedent check reads the whole log on every decision and surfaces
      conflicts with verbatim quotes that are substring-verified in code
      before display. A hallucinated quote cannot reach the user.
- [ ] Supersession works end-to-end: a new record can supersede an old one,
      links are written in both directions, and the chain is visible in the
      log view.
- [ ] The draft record is visible during the conversation and fills in as
      the argument deepens; the scrutiny gauge reflects its coverage and is
      stamped into the record at ratification.
- [ ] Every visitor gets an isolated, pre-seeded sandbox log (one Durable
      Object per log); two simultaneous visitors cannot observe or affect
      each other.
- [ ] Any record, and the whole log, can be exported as plain Markdown at
      any moment.
- [ ] Deployed on Cloudflare Pages + Workers + Durable Objects behind a
      passphrase gate, demoable end-to-end in ninety seconds.

## Non-Goals / Out of Scope

The fence. v0 explicitly does **not** include:

- **Amendment or redaction UI.** The mechanisms are designed (see Version
  Trail) and the schema carries them from day one, but no editing interface
  ships. Supersession is the only change verb exposed in v0.
- **Case-law queries** ("what have we decided about queues?") — the log
  answers only through the precedent check, not free-form questioning.
- **A separate lightweight-capture mode.** Ratify-anytime already provides
  the short end of the depth dial (see Key Decisions).
- **MCP server interface.** The best v1.1, per IDEA.md's parking lot.
- **Team features, per-user auth, orgs, quorum.** The session cookie is the
  only identity. The log-is-the-tenant architecture leaves the door open;
  nothing walks through it in v0.
- **GitHub PR export / repo integration.** Export is raw Markdown download
  only.
- **Voice input, embedding-based retrieval, billing, SaaS anything.**
- **Multi-log management UI.** One log per session; named logs are
  configuration, not interface.

## Design

### System Topology

Three parts, in Cloudflare's grain:

- **Pages (client):** the chat UI, the visible draft record with scrutiny
  gauge, and the log view. Static assets; all state lives server-side.
- **Worker (doorman):** stateless request handler. Checks the passphrase
  gate, issues/validates the session cookie, derives the Durable Object
  address from the session, and forwards requests. Holds no state and makes
  no decisions.
- **Log Durable Object (the product):** one DO instance per decision log.
  Owns all storage, runs the agent loop (calls the Anthropic API), executes
  the precedent check, verifies quotes, assigns numbers, writes records.
  Single-threaded by platform guarantee: ratification's multi-step writes
  can never interleave.

The log is the tenant. A visitor's sandbox is a DO addressed by session ID;
the owner's real log is the same code addressed by a stable name
(`log:phil-main`). Team mode, if it ever comes, is "several sessions resolve
to one named log" — an auth change, not an architecture change.

### The Log (Durable Object)

**Storage schema** (DO key-value):

| Key | Value |
|---|---|
| `meta` | next-number counter, created date, log kind (sandbox/named) |
| `index` | one compact line per record: number, title, status, one-sentence decision |
| `record:{n}` | current full Markdown of ADR-n |
| `record:{n}:v{k}` | full snapshot of ADR-n as of version k (pre-amendment) |
| `draft` | the in-progress draft record + conversation history |

**Seeding:** on first wake with empty storage, a sandbox log seeds itself
with the starter set — a small fictional team's history (~6 ADRs, content
authored in PLAN phase) — so the very first visitor decision can trip a
precedent conflict. Named logs seed empty.

**Lifecycle:** sandbox DOs set a storage alarm on each interaction; after 30
days idle they wipe their own storage. Named logs never expire.

### The Record Format

A house format, deliberately MADR-shaped: the canon sections engineers
recognize on sight, plus the two sections that are Ratify's signature. One
plain `.md` file per record; YAML frontmatter carries the machine-readable
fields, prose sections carry the human content.

```markdown
---
number: 7
status: ratified        # ratified | superseded | redacted
date: 2026-08-13
supersedes: [4]
superseded_by: null
scrutiny: {context: full, alternatives: 2, precedent: conflict-resolved,
           consequences: partial, objections: 1-open}
---

# ADR-7: Use Postgres for the job queue

## Context
## Decision
## Alternatives Considered
## Consequences
## Objections

## History
- 2026-08-13 — ratified (v1)
```

- `## Objections` records unresolved pushback verbatim — the argument that
  lost, preserved. No standard ADR format has this; it is the visible trace
  of the conversational origin.
- `## History` is the changelog: one line per version, date + who + what
  changed, human-readable with no tooling.
- Deliberate omission: no "Pros and Cons of the Options" (MADR's heaviest
  section). The pressure-test conversation is where options get weighed; the
  record keeps the alternatives and the verdict, not the tournament bracket.
- The unit is called an **ADR** — read as *Any* Decision Record, per MADR's
  own broadening — cited as `ADR-N`. The noun is familiar for interop; the
  verbs (ratify, supersede, precedent) carry the brand.

### The Agent

One fixed calibration, three pinned behaviors:

1. **The precedent check always runs.** It is the service, not pushback.
2. **Draft early.** The record skeleton starts filling from the first
   exchange and is visible throughout. Bailing out early yields a thin but
   real record, never nothing.
3. **Pushback is offered, never imposed.** A handful of high-value
   questions — missing alternatives, skipped tradeoffs, precedent conflicts
   — with ratify one command away at all times. Unresolved objections are
   written into `## Objections`, so deep engagement earns a cleaner record
   and early exit is not punished.

Calibration target, written down so tuning has an anchor: *a staff engineer
who respects your time* — roughly three good questions, not ten, and never
a lecture when precedent is overturned.

Agent tools: `read_record(n)` (tier-2 fetch), `raise_conflict(n, quote)`
(passes through quote verification), `update_draft(sections)`.

### The Precedent Check

Two-tier index-and-fetch:

- **Tier 1 — the index, always in context.** Every record's compact line, on
  every turn. No retrieval misses; old precedent is never invisible, because
  old precedent is exactly what nobody in the room remembers.
- **Tier 2 — full text on demand.** When the index makes the agent suspect a
  conflict, it fetches the full record before saying anything about it.

**Quote verification (mechanical Principle 5):** a conflict claim must carry
the record number and a verbatim quoted line. The DO checks the quote is an
exact substring of the stored record before the conflict is shown. On
failure, the claim is rejected back to the model for retry — a hallucinated
quote structurally cannot reach the user.

Scaling story: when the index itself outgrows context, tier 1's population
rule gets selective (that's the parked embeddings work). The two-tier
structure survives unchanged.

### Ratification, Supersession, and the Version Trail

**Ratify** (single-threaded, so atomic in effect): assign next number,
write `record:{n}`, stamp the scrutiny gauge into frontmatter, update the
index, clear the draft. Numbers are never reused or renumbered.

**Supersede:** ratifying with `supersedes: [k]` also writes
`superseded_by: n` into ADR-k and flips its status. Both directions of the
chain are always on disk.

**Version trail** (schema in v0, UI later): every amendment stores a full
snapshot of the prior version — the whole file, not a diff. Any historical
version is a plain read; diffs are computed on demand from snapshots, never
the reverse. The `## History` section lists one line per version. Redaction
(whole-record tombstone or in-part) removes content, never the fact that
content was removed.

**Enforcement of the amend-vs-supersede line:** the trail is the
enforcement; classification is advice. The agent, as counsel, objects to
amendments that touch decision substance and routes them to supersession —
the one place Principle 2 outranks Principle 3, so the agent may refuse the
amend verb; the escape valve is always supersede, one command, no stigma.
Whatever slips through is visible, attributed, and diffable:
mis-classification degrades tidiness, not truth.

### The Scrutiny Gauge

A segmented coverage display on the visible draft — never a score:

`Context ● Alternatives ◐ Precedent ● Consequences ○ Objections: 1 open`

- Derived mechanically from draft state (sections populated, alternatives
  count, precedent status, objections open/addressed). No model judgment.
- **Descriptive, never prescriptive:** no target state, no nagging, no
  praise for filling it. It reports; the human weighs.
- Stamped into frontmatter at ratification, so the log remembers how
  examined each decision was.
- Explicitly forbidden: any "rightness" or correctness score. A rightness
  number is the agent holding an opinion the human can outsource the
  decision to — it violates Principles 3 and 5 at once.

### Access & Sessions

- **Passphrase gate:** one shared secret checked server-side against an
  environment variable; session cookie afterward. The passphrase travels in
  the assignment submission notes — never in the public repo. The README
  says "demo passphrase available on request."
- Threat model is cost protection, not secrecy: the gate exists to keep
  automated traffic off the LLM endpoint. Per-session rate limiting inside
  the DO backs it up.
- The session cookie's random ID is the sandbox DO address. No accounts, no
  registry of logs: addressing a DO is what creates it.

### Export

Export is a right (Principle 1), so v0 ships the minimal honest version:
raw Markdown download — any single record, or the whole log as a zip
(current records plus `ADR-{n}.v{k}.md` files where history exists). The
exported log is never less complete or less readable than the in-app log.
No integrations, no formats other than the records as they are.

## Key Decisions

- **Decision:** v0 scope is chat + pressure-test + precedent check + ratify
  + supersede + log view (+ raw export), nothing else.
  **Alternatives considered:** narrower (no supersession, no log view);
  wider (amendment UI, case-law queries, capture mode).
  **Rationale:** the log view is required to demo "the memory is the
  product"; supersession is the precedent check's payoff and Principle 2's
  change mechanism. Everything cut is either principle-satisfiable later
  (amendment UI — schema ships now) or a mode the design gets free
  (lightweight capture = ratifying early).

- **Decision:** precedent check is two-tier index-and-fetch with in-code
  quote verification.
  **Alternatives considered:** LLM-over-recent-records; keyword retrieval.
  **Rationale:** recency is the wrong filter for law — old precedent is the
  product's reason to exist. Keyword retrieval imports vocabulary-mismatch
  failures to solve a scale problem v0 doesn't have. Verification turns
  Principle 5 from prompt hope into structural guarantee.

- **Decision:** house record format, deliberately MADR-shaped, with YAML
  frontmatter, `## Objections`, and `## History`.
  **Alternatives considered:** MADR verbatim; fully custom format.
  **Rationale:** MADR-verbatim is an unstable promise — the principles
  immediately require fields MADR lacks (objections, version trail,
  first-class supersession links), and the first addition breaks verbatim
  anyway. Staying MADR-shaped keeps zero learning curve and clean export
  into existing `docs/adr/` conventions.

- **Decision:** the unit is an **ADR** (A = Any, per MADR's own rename),
  cited ADR-N.
  **Alternatives considered:** "ruling" (completes the legal metaphor);
  "record" (generic).
  **Rationale:** the log outlives the app and exports into a world whose
  convention is ADRs; models already know the term, which the MCP lane will
  need. "Ruling" charges an education tax on every export forever;
  "record" is unciteable. The metaphor lives in the verbs instead.

- **Decision:** passphrase gate + per-visitor seeded sandbox logs.
  **Alternatives considered:** fully open (cost-abuse magnet); per-user
  auth (parked, least interesting build); one shared demo log (visitors see
  each other's leftovers, and the demo starts empty).
  **Rationale:** the gate is cost protection with zero reviewer friction.
  Seeded per-session DOs mean the first decision a reviewer brings can trip
  a precedent conflict — the demo opens on the product's best move — and
  per-session isolation is the strongest possible answer to the
  assignment's Durable Objects requirement.

- **Decision:** license is **FSL-1.1-MIT**.
  **Alternatives considered:** MIT.
  **Rationale (the human's, ratifying):** a license is a one-way door — FSL
  can relax to MIT later; shipped MIT is permissive forever. Ratify feels
  like a potential product; the possibility is worth protecting at the cost
  of a slightly less familiar license header. The MIT flavor is chosen so
  the eventual conversion lands on maximum legibility.
  **Recorded objection (the agent's, per Principle 3):** MIT is maximally
  legible for a portfolio piece and competitive risk at demo scale is ~zero;
  overruled on irreversibility grounds.
  **Note:** this does not breach the "no design decision justified by a
  nonexistent business model" non-value — a license shapes no code and adds
  no scope; it is an option purchase, not plumbing.

- **Decision:** the repo is public from day one, history in the open.
  **Alternatives considered:** private until submission.
  **Rationale:** the commit history is itself the portfolio artifact — the
  pipeline visibly working with real timestamps. The only secret is the
  passphrase, which never enters the repo.

- **Decision:** one Durable Object per log; chains (supersession, versions)
  are data structures inside it.
  **Alternatives considered:** a chain of DOs (per record or per version).
  **Rationale:** a DO is a single-threaded authority, not a data blob. One
  DO per log makes ratification atomic, numbering singular, and precedent
  reads local. Records don't act — they need no actor. The many-DOs card is
  spent where independence is real: one log per visitor.

- **Decision:** version trail = full snapshots + human-readable changelog;
  the trail is the enforcement, classification is advice.
  **Alternatives considered:** stored diffs (reconstruction is the risky
  direction); changelog-only (the past becomes unprovable).
  **Rationale:** records are kilobytes; snapshots make every historical
  version a plain read with nothing to get wrong. Because every amendment
  is visible, attributed, and diffable, a mis-classified amendment degrades
  tidiness, not truth — so the amend-vs-supersede line needs counsel, not a
  wall.

- **Decision:** one fixed challenge calibration; ratify-anytime is the depth
  control; a segmented scrutiny gauge (coverage, never correctness) is its
  instrument panel.
  **Alternatives considered:** user-selectable modes; adaptive depth; a
  rightness/confidence score.
  **Rationale:** Principles 3 + 4 already give the user continuous depth
  control through engagement; a mode switch is a clumsier second
  implementation of that dial. The gauge makes position-on-the-dial visible
  from mechanically observable draft state. A rightness score is forbidden
  outright: numbers launder judgment into fact and let the human outsource
  the decision to the tool.

## Tradeoffs & Risks

- **Index growth.** Tier 1 assumes the index fits in context — true to a
  few hundred records. Past that, population gets selective (parked
  embeddings work). Accepted for v0; the structure survives.
- **Quote verification vs. model behavior.** Exact-substring matching is
  strict; models like to paraphrase. Mitigation: the `raise_conflict` tool
  demands a copied line and rejection retries are cheap. Residual risk:
  occasional extra round-trips, accepted.
- **Fixed calibration needs playtesting.** "Did the agent nag?" is
  empirical. The written target (staff engineer who respects your time,
  ~three good questions) anchors tuning against drift.
- **Gauge gamification.** A meter invites filling the meter. Guard:
  descriptive-only display, no targets, no agent commentary on gauge state.
- **Snapshot storage is unbounded in principle.** Amendments are rare by
  design (admin fixes); a heavily-amended record is ~tens of KB. Accepted.
- **FSL chills casual contribution.** Some developers skip non-OSI
  licenses. Accepted knowingly; recorded above.
- **Sandbox abuse within the passphrase.** A leaked passphrase allows token
  burn. Mitigations: per-session rate limits in the DO, spend caps on the
  API key, rotate-on-suspicion (one env var).
- **Single-DO logs serialize writes.** Fine for v0 (one human per log) and
  correct for team mode (ratifications *should* queue). A pathological
  future with hundreds of writers per log would need rethinking; explicitly
  not designed for.

## Open Questions

Deferred to PLAN.md — these must be decided, not assumed:

- [ ] Model + API path: which Claude model, and Anthropic API direct vs.
      through Cloudflare AI Gateway (caching, rate limiting, observability
      — the more Cloudflare-native story for the assignment).
- [ ] Starter ADR seed content: author the fictional team's ~6 records so
      demo conflicts are natural, not contrived.
- [ ] Client stack for Pages: vanilla/HTMX-grade vs. a small framework;
      streaming UX for agent responses.
- [ ] Rate-limit numbers: requests/tokens per session per hour.
- [ ] Demo hostname and where the submission's prompt-history requirement
      gets assembled.
