import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Three projects, because the codebase has three runtimes and none of them can
// stand in for another.
//
// - `workers` — PLAN.md Phase 0: Durable Object code is tested in the real
//   workerd runtime, not against a mock. The plugin reads wrangler.log.toml so
//   tests get the same LOG binding, migrations, and storage semantics
//   production does.
// - `client` — `src/client/` renders into a DOM, and workerd has none, so this
//   layer had no coverage at all until it got an environment of its own
//   (added 2026-09-08 after `/qa-review` found the whole of `log-view.ts`
//   unasserted). happy-dom is a dev dependency only: the shipped client stays
//   vanilla TypeScript with no framework and no runtime dependency.
// - `scripts` — `scripts/*.mjs` are plain Node programs run by the wrappers,
//   and neither runtime above can execute one: workerd has no `node:fs` and no
//   subprocesses, and `tests/client/` exists for the DOM. Added 2026-09-11,
//   after a `/qa-review` finding that `airtower-results.mjs` wrote a green
//   badge for a run that exited 1 — the translator guarding the gate was the
//   only part of the gate with no test.
//
// One `npx vitest run` covers all three, so `./run-tests.sh` and the AirTower
// badge keep counting every test in the repo.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.log.toml' } })],
        test: {
          name: 'workers',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/client/**', 'tests/scripts/**'],
        },
      },
      {
        test: {
          name: 'client',
          include: ['tests/client/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'scripts',
          include: ['tests/scripts/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
