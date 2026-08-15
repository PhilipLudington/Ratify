import { defineConfig } from 'vite';

// The client is a Pages static build: `src/client` in, `dist` out, which is
// what wrangler.toml's `pages_build_output_dir` points at. No framework —
// PLAN.md's client-stack ruling is vanilla TypeScript so the diff stays
// readable.
export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    // `npm run dev` serves the client with hot reload; API calls go to
    // `wrangler pages dev` running alongside it. For the full integrated
    // stack (Functions + Durable Object) use `npm run dev:pages` instead.
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
});
