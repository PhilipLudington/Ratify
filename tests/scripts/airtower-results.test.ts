// `scripts/airtower-results.mjs` is the last step of `./run-tests.sh`, and the
// only thing that decides what the AirTower badge says. It had no test until a
// `/qa-review` on 2026-09-11 found it writing `failed: 0` for a run that had
// exited 1 — a green badge over a red run, which is the one lie the file
// exists to prevent.
//
// It is a plain Node program, so it is exercised the way `run-tests.sh`
// exercises it: spawned, handed a report file and an exit code, and read back
// off disk. That is also why this file is in `tests/scripts/` and not
// `tests/` — the workers pool has no `node:fs` and no subprocesses.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/airtower-results.mjs', import.meta.url));

interface Results {
  passed: number;
  failed: number;
  total: number;
  failures: string[];
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ratify-airtower-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run the translator the way `run-tests.sh` does, and read back what it wrote. */
const translate = (report: unknown, exitCode: number): Results => {
  const input = join(dir, 'report.json');
  const output = join(dir, 'results.json');
  writeFileSync(input, JSON.stringify(report));

  const run = spawnSync(process.execPath, [script, 'tests', input, output, String(exitCode)], {
    encoding: 'utf8',
  });
  expect(run.status, run.stderr).toBe(0);

  return JSON.parse(readFileSync(output, 'utf8')) as Results;
};

/** One passing assertion, in the shape vitest's JSON reporter emits. */
const passing = (title: string) => ({ title, ancestorTitles: ['a suite'], status: 'passed' });

describe('the tests translator', () => {
  it('counts a green run and claims no failures', () => {
    const results = translate(
      {
        success: true,
        testResults: [
          {
            name: '/repo/tests/one.test.ts',
            status: 'passed',
            assertionResults: [passing('first'), passing('second')],
          },
        ],
      },
      0,
    );

    expect(results).toEqual({ passed: 2, failed: 0, total: 2, failures: [] });
  });

  it('names a failing test once, not twice', () => {
    // The file is `failed` too, because the test inside it failed. The
    // file-level count must not add a second entry for the same event.
    const results = translate(
      {
        success: false,
        testResults: [
          {
            name: '/repo/tests/one.test.ts',
            status: 'failed',
            assertionResults: [
              passing('first'),
              { title: 'second', ancestorTitles: ['a suite'], status: 'failed' },
            ],
          },
        ],
      },
      1,
    );

    expect(results.failed).toBe(1);
    expect(results.failures).toEqual(['a suite › second']);
    expect(results.passed).toBe(1);
    expect(results.total).toBe(2);
  });

  it('counts a file that failed outside any test, and says which file', () => {
    // The regression this test exists for: a `beforeAll`/`afterAll` that
    // throws fails the whole file without failing any assertion inside it, so
    // counting only `assertionResults` reported a clean sweep of a red run.
    const results = translate(
      {
        success: false,
        testResults: [
          {
            name: '/repo/tests/client/routing.test.ts',
            status: 'failed',
            message: 'Error: stray fetch outside a stub window',
            assertionResults: [passing('first'), passing('second')],
          },
        ],
      },
      1,
    );

    expect(results.failed).toBe(1);
    expect(results.failures).toHaveLength(1);
    expect(results.failures[0]).toContain('routing.test.ts');
    expect(results.failures[0]).toContain('stray fetch outside a stub window');

    // `total` is the other half of what the badge prints, and the file failure
    // has to be one of the units counted in it — otherwise the badge reads
    // "2/2", which is the all-passing shape this whole test is against.
    expect(results.passed).toBe(2);
    expect(results.total).toBe(3);
  });

  // The fallback fires on `exitCode !== 0 || report.success === false`. A single
  // fixture satisfying both would keep passing if either arm were deleted, so
  // each arm gets a case that is the only thing holding it up. The report in
  // both is a clean sweep — the failure has to come from the arm alone.

  it('falls back on a non-zero exit code alone', () => {
    // The arm `run-tests.sh:18` actually supplies, and the only one that works
    // when the reporter omits `success` or reports it true over a dead worker.
    const results = translate(
      {
        testResults: [
          {
            name: '/repo/tests/one.test.ts',
            status: 'passed',
            assertionResults: [passing('first')],
          },
        ],
      },
      1,
    );

    expect(results.failed).toBe(1);
    expect(results.failures).toHaveLength(1);
    expect(results.passed).toBe(1);
    expect(results.total).toBe(2);
  });

  it('falls back on `success: false` alone', () => {
    const results = translate(
      {
        success: false,
        testResults: [
          {
            name: '/repo/tests/one.test.ts',
            status: 'passed',
            assertionResults: [passing('first')],
          },
        ],
      },
      0,
    );

    expect(results.failed).toBe(1);
    expect(results.failures).toHaveLength(1);
    expect(results.passed).toBe(1);
    expect(results.total).toBe(2);
  });
});
