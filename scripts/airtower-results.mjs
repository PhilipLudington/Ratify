// Translate tool output into the shapes AirTower reads.
//
// Usage:
//   node scripts/airtower-results.mjs tests <vitest-json> <out> [exitCode]
//   node scripts/airtower-results.mjs build <log-file>    <out> <exitCode>
//
// Both modes always write a result file, including when the underlying tool
// crashed before producing output — a missing file reads as "stale" in the
// badge, which is a worse lie than "failed".

import { readFileSync, writeFileSync } from 'node:fs';

const [mode, input, output, exitCodeArg] = process.argv.slice(2);
const exitCode = Number(exitCodeArg ?? 0);

const write = (payload) => writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

if (mode === 'tests') {
  const raw = read(input);
  let report = null;
  try {
    report = raw ? JSON.parse(raw) : null;
  } catch {
    report = null;
  }

  if (!report) {
    write({
      passed: 0,
      failed: 0,
      total: 0,
      failures: ['Vitest produced no report — the run failed before any test executed.'],
    });
    process.exit(0);
  }

  const cases = (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({
      name: [...(test.ancestorTitles ?? []), test.title].filter(Boolean).join(' › '),
      status: test.status,
    })),
  );

  const failures = cases.filter((test) => test.status === 'failed').map((test) => test.name);
  const passed = cases.filter((test) => test.status === 'passed').length;

  // A hook that throws — `beforeAll`, `afterAll`, `beforeEach` — fails its
  // whole file without failing any test inside it, so it never appears in
  // `assertionResults` and the counts above cannot see it. Vitest records it
  // on the file entry instead. Counting only assertions is how a run that
  // exited 1 still wrote a green badge, which is the one lie this file exists
  // to prevent.
  const fileFailures = (report.testResults ?? [])
    .filter(
      (file) =>
        file.status === 'failed' &&
        !(file.assertionResults ?? []).some((test) => test.status === 'failed'),
    )
    .map((file) => `${file.name ?? 'unknown file'}: ${file.message || 'failed outside any test'}`);

  // Last resort. The run is red for a reason this report does not itemise —
  // a collection error, a crashed worker — and a vague failure is still
  // better than a green badge.
  const unexplained =
    failures.length === 0 && fileFailures.length === 0 && (exitCode !== 0 || report.success === false)
      ? ['The run failed but no individual test did — see the test output.']
      : [];

  const all = [...failures, ...fileFailures, ...unexplained];

  write({ passed, failed: all.length, total: cases.length + fileFailures.length + unexplained.length, failures: all });
  process.exit(0);
}

if (mode === 'build') {
  const log = read(input) ?? '';
  const lines = log.split('\n');

  const messages = lines
    .filter((line) => /\b(error|warning)\b/i.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);

  const warnings = messages.filter((line) => /\bwarning\b/i.test(line)).length;
  const errors = messages.length - warnings;

  write({
    success: exitCode === 0,
    errors: exitCode === 0 ? errors : Math.max(errors, 1),
    warnings,
    messages,
  });
  process.exit(0);
}

console.error(`airtower-results: unknown mode ${JSON.stringify(mode)}`);
process.exit(1);
