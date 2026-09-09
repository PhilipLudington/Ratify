# Ratify Bugs

## [ ] Bug 1: A failed session check renders a blank page instead of the gate

**Status:** Open

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

---
