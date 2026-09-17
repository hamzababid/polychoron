import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Each e2e file boots a full Nest app (DB + Temporal connections).
    // Running several of those forked processes at once triggers
    // sporadic native worker crashes (observed on Windows) even though
    // every file passes reliably alone — file-level parallelism isn't
    // load-bearing for a suite this size, so it's disabled rather than
    // chased further.
    fileParallelism: false,
  },
});
