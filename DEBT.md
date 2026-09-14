# Ratify Debt

## [x] Debt 1: The no-report branch's exit-code independence has no test

**Status:** Paid
**Kind:** test-gap
**Where:** `scripts/airtower-results.mjs:40`, `tests/scripts/airtower-results.test.ts:205`
**Due when:** touching `scripts/airtower-results.mjs` · touching `tests/scripts/airtower-results.test.ts`

**Description:** The Bug 4 fix writes `failed: 1, total: 1` from the no-report branch
without reading the exit code, and BUG.md's Fix paragraph says so in as many words — a
missing report is a failed run whether or not vitest managed to say so. Both Bug 4
tests hand the translator exit code 1, so nothing pins the exit-0 half of that sentence:
an edit that made the branch conditional (`failed: exitCode === 0 ? 0 : 1`, the shape
`build` mode uses one screen down) would leave the suite green and restore the
green-badge-over-a-dead-run lie for the case where vitest exits 0 and writes nothing.
Not paid on the Bug 4 branch because the review found it after the fix commits landed
and nothing fails today.

**Payment:** One test beside the two Bug 4 cases in
`tests/scripts/airtower-results.test.ts`: `run('tests', null, 0)`, asserting `failed`
at least 1 and `passed` 0. It passes on this tree and fails against the conditional.
The next Next Up item (the unknown-mode path's missing test) opens the same file.

**Found by:** /qa-review on bug-4-green-badge-on-missing-report, 2026-09-14 — QA Test
Coverage Review; verified in the main loop by reading the two Bug 4 tests, both of which
pass exit code 1.

**Paid:** `tests/scripts/airtower-results.test.ts:233` — one test beside the two Bug 4
cases, `run('tests', null, 0)`, asserting `failed` at least 1 and `passed` 0. Landed as
its own commit on `unknown-mode-path-has-no-test`, 2026-09-14, the branch the entry
named as the one that would open the file.
