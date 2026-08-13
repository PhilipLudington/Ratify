# Ratify — Idea

## Problem

Engineering teams make their most expensive decisions in Slack threads and meetings, and six months later nobody can reconstruct why Postgres beat DynamoDB, so the argument gets re-litigated by whoever wasn't in the room. The industry's answer is the Architecture Decision Record, and almost nobody writes them, because an ADR is homework assigned after the decision is already made. The record loses to the backlog every time.

Coding agents make this worse, not better: more code ships per week, decided by fewer written-down reasons. The intent behind a decision is exactly the thing an agent cannot reconstruct later — which is why Philip's own pipeline (IDEA → DESIGN → PLAN) exists. But that pipeline is manual discipline. Most people won't do it, and even Philip only does it for projects, not for the dozens of mid-sized decisions inside one.

## Core Idea

A chat agent that pressure-tests an engineering decision, checks it against your prior decision log, and — when you say so — ratifies it into a numbered, permanent, versioned decision record. You argue with it like you'd argue with a good staff engineer: it asks what alternatives you considered, surfaces tradeoffs you skipped, and flags conflicts with your own precedent ("this contradicts ADR-4, managed-services-first — is that rule dead?"). When the argument is over, the record writes itself. The conversation *was* the documentation work.

The decision log is the memory, and the memory is the product.

## Possibilities

- **Precedent checking** as the killer feature: every new decision is read against the existing log, and conflicts are surfaced before ratification, not discovered in an incident review.
- Supersession as a first-class verb: ADR-11 can supersede ADR-4, keeping the historical chain intact (the same rule as BUG.md's never-renumber).
- Pushback personas: a skeptic, an operator, a security reviewer — each interrogating the decision from a different seat before it's ratified.
- Export lanes: raw Markdown per record (MADR-shaped), a whole-log dump, or a PR into the team's repo so the records live in version control.
- **An MCP server interface**, so coding agents can ask "has this been decided?" mid-task and cite ADRs in their output. Decision records become agent-legible context — the most on-thesis extension possible.
- Team mode: a decision needs sign-off from named people before it ratifies. (The name almost demands a quorum feature.)
- "Case law" summaries: ask the log itself questions ("what have we decided about queues?") and get a synthesized answer with citations.
- Voice-input sessions for decision debriefs after a meeting, while it's still fresh.
- Lightweight capture mode: one sentence in, provisional record out, upgrade to full pressure-test later.

## Edge Cases & Unknowns

- Hallucinated conflicts: the agent claiming ADR-7 forbids something it doesn't. Precedent checks must quote the record, not paraphrase it.
- Log growth: past a few dozen records the whole log stops fitting in context, and retrieval has to get selective (recency + keyword first; anything fancier is a later problem).
- What is one decision? Atomicity is fuzzy — "use Postgres" vs "use Postgres for the job queue" — and the tool has to help draw that line.
- Reversals under pressure: teams need to overturn precedent quickly during incidents without the tool moralizing at them.
- Decisions are sensitive by default (they name rejected vendors, costs, people). Private-by-default matters.
- A pushy pressure-test could make people stop bringing decisions to it at all. Calibrating challenge depth is a product decision, not a prompt detail.

## Open Questions

- [ ] v0 scope for the Cloudflare assignment: single user, single project log, chat + ratify + precedent check — is that the whole demo?
- [ ] Precedent-check mechanism for v0: LLM-over-recent-records, or keyword retrieval feeding the model? (No embeddings in v0.)
- [ ] Record format: adopt MADR verbatim, or a house format with status / context / decision / consequences / supersedes?
- [ ] What's the memory unit called in-product — ADR, record, ruling?
- [ ] Auth for the deployed demo: open with a passphrase gate, or per-user?
- [ ] License: FSL-1.1 (the Assay precedent) or MIT for maximum portfolio legibility?
- [ ] When does the repo flip public — at assignment submission, or immediately?

## Not Now (Parking Lot)

- MCP server interface (the best v1.1, not the assignment v0).
- Team quorum / sign-off flows, per-user auth, orgs.
- GitHub PR export and repo integration.
- Voice input via Realtime.
- Embedding-based retrieval over large logs.
- Any SaaS/billing shape. Portfolio piece first; product questions only if it earns them.

---

*Context, 2026-08-13: chosen as the Cloudflare DevTools optional-assignment project (AI app on Workers/Durable Objects/Pages, chat input, memory/state, prompt history submitted) and as a durable portfolio piece for PhilipLudington.com. The assignment shapes v0's stack, not the idea.*
