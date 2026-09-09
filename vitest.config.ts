import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Two projects, because the codebase has two runtimes and neither one can
// stand in for the other.
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
//
// One `npx vitest run` covers both, so `./run-tests.sh` and the AirTower badge
// keep counting every test in the repo.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.log.toml' } })],
        test: {
          name: 'workers',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/client/**'],
        },
      },
      {
        test: {
          name: 'client',
          include: ['tests/client/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
