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

## [ ] Bug 2: The passphrase form gives no answer when the server is unreachable

**Status:** Open

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

---
