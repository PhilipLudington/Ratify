# Ratify Bugs

## [x] Bug 1: A failed session check renders a blank page instead of the gate

**Status:** Fixed

**Description:** `start()` in `src/client/main.ts:170` awaits `api('/session')` and
parses its body with no error path around either step, and the logout handler at
`:162` awaits `api('/logout')` the same way. Every panel in `index.html` ships
`hidden`, and the first thing to unhide one is `start()` — so when that fetch
rejects (offline, the server down, a 5xx whose body will not parse as JSON), the
rejection lands in nothing, no panel is ever shown, and the visitor gets the
masthead over an empty page with no way forward but a reload that fails the same
way. `route()` already has the shape this needs: it catches, and renders the
message through `renderMessage`.

The defect predates the log view — Phase 0's `start()` had the same unguarded
shape — but it now owns the first paint of the only screen the app has.

**Steps to reproduce:**
1. Open the app in a browser and pass the gate, so a session cookie exists.
2. Stop the local Pages dev server (or go offline).
3. Reload the page.

**Expected:** The gate, or a plain message saying the log could not be reached —
the same treatment `route()` gives a failed `/api/log`.

**Actual:** The masthead over a blank page. Nothing is rendered, no error is
shown, and the browser console holds an unhandled promise rejection.

**Found by:** /qa-review on main, 2026-09-08 — QA Generalist Review (shard B);
verified by reading `src/client/main.ts:162-176` and `src/client/index.html:21-52`.

**Fix:** `route()`'s error path is now `showMessage()` (`src/client/main.ts`), and
both unguarded paths use it. `start()` wraps the whole session check: a response
that is not ok renders the server's own message where it has one — a misconfigured
deploy now says "Server is not configured." instead of offering a passphrase form
that cannot work — and anything thrown renders a plain "Ratify could not be
reached." The logout handler no longer shows the gate unless the server actually
answered: the cookie is the server's to clear, so a logout that failed has ended
nothing, and claiming otherwise is the one thing a session control must not do.
`showMessage` advances the navigation generation like every other path that
decides what is on screen, so a record fetch still in flight cannot paint over it.

**Test:** `tests/client/routing.test.ts` — the `failure paths` describe block, six
tests, all failing on the unfixed tree.

---

## [x] Bug 2: The passphrase form gives no answer when the server is unreachable

**Status:** Fixed

**Description:** The gate's submit handler awaits `api('/auth')` with no error path
around it (`src/client/main.ts:165`). It is the fourth server call in the file with
that shape, and the one Bug 1 did not reach: `start()`, `route()` and the logout
handler now all render a plain message on failure, and this one still lets the
rejection land in nothing. The handler hides `#gate-error` on entry, so a failed
fetch leaves the form exactly as it was — the passphrase still typed, no error, no
spinner, nothing to distinguish "wrong passphrase" from "the server is not there".
A reviewer with a bad connection concludes the passphrase they were given is wrong.

**Steps to reproduce:**
1. Open the app so the gate is showing.
2. Stop the local Pages dev server (or go offline).
3. Type anything into the passphrase field and press Enter.

**Expected:** A plain line in `#gate-error` saying the server could not be reached —
the treatment the other three paths now get.

**Actual:** Nothing happens. The form sits unchanged and the browser console holds an
unhandled promise rejection.

**Found by:** /qa-review on bug-1-blank-page-on-session-failure, 2026-09-09 — QA
Generalist Review (PRE-EXISTING); verified by reading `src/client/main.ts:161-180`.

**Fix:** The submit handler now wraps the `/auth` call and tells the three outcomes
apart — through, refused, or never arrived (`src/client/main.ts`). The last two both
land in `#gate-error` through a small `showGateError()`, and the gate stays where it
is rather than being replaced by a message screen: the form is the way forward from
both, so taking it away would remove the control the reader needs. Only a refusal
selects the passphrase, because only a refusal implicates it; an unreachable server
leaves the value as typed, so pressing the button again is the whole retry. This was
the last of the file's four unguarded server calls — `start()`, `route()` and the
logout handler were closed by Bug 1.

**Test:** `tests/client/routing.test.ts` — three tests hung off `signIn()`, which
until now drove only the success path. "says so in the gate when the passphrase
cannot be sent at all" is the regression test, and fails on the unfixed tree with
`#gate-error` still hidden.

---

## [ ] Bug 3: A dropped connection reaches the reader as raw browser jargon

**Status:** Open

**Description:** `route()`'s catch renders the caught error's own message verbatim —
`showMessage(error instanceof Error ? error.message : String(error))`
(`src/client/main.ts:167`) — so a `fetch` that never reaches the server puts the
browser's internal string on screen as the entire message: "Failed to fetch" in
Chrome, "Load failed" in Safari, "NetworkError when attempting to fetch resource."
in Firefox. It is the same event Bug 1 and Bug 2 both gave a plain sentence to, one
function up: `start()` (`:240`) says "Ratify could not be reached. Check your
connection and reload." and the logout handler (`:220`) says "This session could not
be ended. Check your connection and try again." Only `route()` passes the raw text
through, and `route()` is the path a reader spends the whole session in.

The same catch also surfaces a parse failure the same way. `fetchIndex` awaits
`response.json()` unguarded (`:98`), so a 200 carrying HTML — a proxy interstitial,
a captive portal, a Pages error page — reads as `Unexpected token '<', "<!doctype "…`
on the log screen.

**The two halves arrive as different exceptions, and that is the trap in fixing this.**
A `fetch` that never connects rejects with a `TypeError`; `response.json()` meeting
HTML rejects with a **`SyntaxError`**. A fix that classifies only `TypeError` and lets
everything else keep its own message closes the first half and leaves the second
reading exactly the string quoted above. Both belong in the fix, or the entry does not
close.

Neither half is tested. Every `/api/log` override in the suite resolves, the record
fetch's deferred is always resolved and never rejected, and the `unreachable` helper
is pointed only at `/api/session`, `/api/logout` and `/api/auth`.

**Steps to reproduce** (a dropped connection):
1. Open the app and pass the gate, so the log is on screen and its index is cached.
2. Stop the local Pages dev server (or go offline).
3. Click any record in the log.

**Expected:** A plain line saying the record could not be reached and what to do —
the treatment `start()` and the logout handler already give the identical failure.

**Actual:** The message screen reads "Failed to fetch" (browser-dependent), which
names no product, no cause the reader can act on, and no way back.

**Steps to reproduce** (a 200 that is not JSON):
1. Open the app and pass the gate.
2. Put anything in front of the app that answers `/api/log` with an HTML page and a
   200 — a captive portal, a proxy interstitial, a Pages error page.
3. Reload, or navigate back to the log from a record, so the index is fetched afresh.

**Expected:** The same plain line. A reader cannot act on the difference between a
server that is absent and one that answers with the wrong thing, so the screen should
not spend its one sentence on it.

**Actual:** The log screen reads `Unexpected token '<', "<!doctype "... is not valid
JSON` — a description of the parser's disappointment, addressed to nobody present.

**Found by:** /qa-review on bug-2-gate-form-silent-when-server-unreachable,
2026-09-10 — QA Generalist Review (PRE-EXISTING), test gap corroborated by QA Test
Coverage Review; verified in the main loop by reading `src/client/main.ts:144-168`
and confirming `unreachable` is wired to no route that reaches `route()`'s catch.

---
