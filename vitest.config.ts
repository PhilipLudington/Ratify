import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// PLAN.md Phase 0: Durable Object code is tested in the real workerd runtime,
// not against a mock. The plugin reads wrangler.log.toml so tests get the same
// LOG binding, migrations, and storage semantics production does.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.log.toml' } })],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
