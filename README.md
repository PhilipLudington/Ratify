# Ratify

**A conversational decision-record engine.** Bring an engineering decision to
the chat. Ratify pressure-tests it, checks it against every decision your team
has already made, and — on your command — ratifies it into a numbered,
permanent, versioned record.

The conversation *is* the documentation work.

> **Status: Phase 0.** The skeleton is deployed and the plumbing is proven; the
> agent, the records, and the precedent check land in Phases 1–4. See
> [PLAN.md](PLAN.md) for where the build actually is.

## Why

Architecture decision records are a good idea that teams abandon, because
writing one is a chore performed *after* the thinking is done, by someone who
already knows the answer and has moved on. Six months later nobody remembers
why the queue is Postgres, and the person who knew has left.

Ratify inverts that. The record is the byproduct of a conversation you were
going to have anyway, and the log is not a folder nobody opens — it is
precedent, read back to you the moment you are about to contradict it.

The design is bound by five ordered principles in
[PHILOSOPHY.md](PHILOSOPHY.md). Two of them shape almost everything else:

- **You can ratify at any moment.** The agent asks a handful of good questions,
  never ten, and the ratify control is never disabled and never gated. Bailing
  out early yields a thin but real record — never nothing.
- **A hallucinated quote cannot reach you.** When the agent claims your decision
  conflicts with ADR-4, it must carry a verbatim line from ADR-4. The Durable
  Object checks that the quote is an exact substring of the stored record before
  it is shown, and rejects the claim back to the model if it is not. This is a
  structural guarantee, not a prompt instruction.

## Documents

The project is built through a document pipeline; each answers a different
question and each is worth reading in order.

| Document | Answers |
|---|---|
| [IDEA.md](IDEA.md) | What is this and what might it be |
| [PHILOSOPHY.md](PHILOSOPHY.md) | What wins when two good options conflict |
| [DESIGN.md](DESIGN.md) | What v0 is, and what it explicitly is not |
| [PLAN.md](PLAN.md) | In what order, and how each step is verified |

## Architecture

Three parts, in Cloudflare's grain:

```
  Pages ─────────────── static client: chat, visible draft, log view
    │
  Pages Function ────── the doorman: passphrase gate, signed session
    │                   cookie, derives the log address. Holds no state
    │                   and makes no decisions.
    ▼
  LogDO ─────────────── one Durable Object per decision log. Owns all
  (ratify-log Worker)   storage, runs the agent loop, executes the
                        precedent check, verifies quotes, assigns
                        numbers, writes records.
```

**The log is the tenant.** A visitor's sandbox is a Durable Object addressed by
their session ID; the owner's real log is the same code addressed by a stable
name. Two visitors cannot observe or affect each other, because they are not in
the same object. Team mode, if it ever comes, is "several sessions resolve to
one named log" — an auth change, not an architecture change.

Ratification is a multi-step write: assign the next number, write the record,
stamp the scrutiny gauge, update the index, clear the draft, and — when
superseding — flip the prior record's status and write links in both
directions. Those steps live in the Durable Object because its single-threading
guarantee is what makes them atomic in effect.

### Two deployments, and why

`ratify-log` is a separate Worker rather than part of the Pages project because
a Pages Function can *bind* to a Durable Object but cannot *define* one. The
class has to live in a Worker, and Pages reaches it through `script_name`.

The practical consequence: **deploy `ratify-log` first.**

```sh
npm run deploy:log     # the Durable Object class
npm run deploy:pages   # the client and the doorman
```

## Development

```sh
npm install
cp .dev.vars.example .dev.vars   # then edit in any local values you like

npm run dev:pages                # terminal 1 — client + doorman on :8788
npx wrangler dev -c wrangler.log.toml --port 8787   # terminal 2 — the LogDO
```

Two processes, because of the two deployments. They find each other through
Wrangler's dev registry — the Pages output should report
`env.LOG (LogDO, defined in ratify-log) … [connected]`. If it says
`[not connected]`, the second terminal is not running.

Then open <http://localhost:8788> and enter the passphrase from your
`.dev.vars`.

### Tests and builds

Always go through the wrapper scripts, which record results for the AirTower
dashboard:

```sh
./run-tests.sh    # vitest in the real workerd runtime, via vitest-pool-workers
./run-build.sh    # generate types, typecheck both halves, build, dry-run the Worker
```

Durable Object tests run against the actual runtime with the actual storage
semantics, not a mock.

To check a *deployed* stack rather than the code, there is a readiness script.
It prompts for the passphrase with hidden input and never echoes it:

```sh
scripts/verify-gate.sh https://ratify-4pp.pages.dev
```

It asserts the gate refuses the unauthenticated, the wrong passphrase and a
forged cookie; that the right passphrase issues a cookie; that a write survives
into a later request; and that two sessions land in different Durable Objects
which cannot read each other.

## Demo access

**<https://ratify-4pp.pages.dev>**

The deployed demo is behind a shared passphrase. This is cost protection, not
secrecy: the gate keeps automated traffic off the language-model endpoint.
Per-session rate limits inside the Durable Object back it up.

**The demo passphrase is available on request.** It travels out of band and has
never been in this repository.

Every visitor gets their own sandbox log, pre-seeded with a small fictional
team's decision history, so the first decision you bring can trip a real
precedent conflict. Sandboxes wipe themselves after 30 days idle.

## Secrets

Nothing secret is ever committed. Local values go in `.dev.vars` (gitignored);
deployed values are set through Wrangler.

| Secret | Set on | Purpose |
|---|---|---|
| `DEMO_PASSPHRASE` | Pages | the shared demo gate |
| `SESSION_SECRET` | Pages | HMAC key for session cookies |
| `ANTHROPIC_API_KEY` | `ratify-log` | the agent, called via Cloudflare AI Gateway |

```sh
wrangler pages secret put DEMO_PASSPHRASE --project-name ratify
wrangler pages secret put SESSION_SECRET --project-name ratify
wrangler secret put ANTHROPIC_API_KEY -c wrangler.log.toml
```

Two things about Pages secrets that will otherwise cost you an afternoon:

- **They bind at deploy time.** Setting a secret does nothing to the running
  site until the next `npm run deploy:pages`.
- **Run them attached to a real terminal.** `wrangler pages secret put` prompts
  for the value, and a prompt with no TTY behind it uploads an *empty string*
  and still reports success — after which `wrangler pages secret list` shows
  the secret as present while every request fails. Pipe the value instead if
  you are not at a terminal: `printf '%s' "$VALUE" | wrangler pages secret put …`

## License

[FSL-1.1-MIT](LICENSE) — the Functional Source License, converting to MIT two
years after each release. Use it for anything except building a competing
product; the reasoning, including the objection recorded against it, is in
[DESIGN.md](DESIGN.md#key-decisions).
