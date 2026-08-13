# Ratify — Philosophy

## What This Project Values

Ratify exists so that a decision, once made, can never be un-explained. The
log is the product: keep it portable, keep it honest, keep the human in
command of it, keep capture cheap — in that order.

## Principles

Ordered by priority. When two principles conflict, the earlier one wins.

### 1. The Log Outlives the App

**Prefer:** plain, portable records.
**Over:** app-native richness.
**Because:** nobody entrusts decisions to a log they could lose. Permanence is
the precondition of trust — an honest chain locked inside an app that can die
is only honest until the app is. Plain text is also what keeps records legible
to both humans and agents.
**In practice:** records are plain Markdown, exportable in full at any moment.
No feature may make the exported log less complete or less readable than the
in-app log. If the chain's machinery (trails, tombstones, supersession links)
ever wants a representation that can't survive export, the machinery
simplifies — not the export.

### 2. The Chain Doesn't Lie

**Prefer:** an honest chain.
**Over:** a tidy log.
**Because:** precedent over a rewritable log is worthless. The memory is the
product, and a memory that can be silently rewritten isn't memory.
**In practice:** drafts are free — nothing gets a number until ratified. After
ratification a record can be superseded, amended (version-trailed admin
fixes), or redacted — in whole (a tombstone) or in part (a name, a
credential) — never silently edited, deleted, or renumbered. Redaction
removes content, never the fact that content was removed: the mark stays
visible in place, with who, when, and why. This is the one principle that
overrules the human — a request to delete history gets redaction instead.

### 3. The Human Ratifies

**Prefer:** the human's verdict.
**Over:** the agent's conviction.
**Because:** the agent is counsel, not judge. A tool that blocks gets
abandoned — fastest during incidents, exactly when decisions matter most.
**In practice:** ratify is always one command away. An unresolved objection is
written into the record, not enforced. Overturning precedent gets no lecture.
Capture pressure never becomes the agent's excuse to grab the wheel — no
forced extra questions, no auto-saving sessions the human abandoned on
purpose.

### 4. A Record Beats an Absence

**Prefer:** a mediocre record, captured.
**Over:** a rigorous record that never happens.
**Because:** the ADR failure mode isn't bad records — it's no records. A thin
record can be pressure-tested later; an absent one is gone.
**In practice:** ratify is never gated on the agent's satisfaction. When
tuning the pressure-test, trim conversation length, never access to ratify.

### 5. Show the Record

**Prefer:** cited claims.
**Over:** confident prose.
**Because:** one hallucinated precedent costs more trust than a hundred good
syntheses earn.
**In practice:** no claim about the log without a record number; no conflict
without a verbatim quote. Synthesis is welcome — case-law answers, summaries,
paraphrase — but always with its citations attached. This principle
disciplines how the agent speaks; it serves the four above it, never taxes
them.

## Explicit Non-Values

- Not maximizing records per week — the log is memory, not an activity metric.
- Not a project tracker, wiki, or knowledge base — it records decisions, not
  work.
- Not virality or public shareability — the audience is the team that owns the
  log, and its agents. Inside that boundary, open; outside it, closed.
- Not a SaaS: no billing, accounts, or pricing until outside users are asking
  for support, features, or enterprise plumbing — and no design decision
  justified by a business model that doesn't exist yet.
