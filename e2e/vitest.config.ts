import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: __dirname,
    include: ['scenarios/**/*.e2e.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
    globals: false,
  },
});
