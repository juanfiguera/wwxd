import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
    },
  },
  test: {
    globals: false,
    pool: 'forks',
    // Per-file environment: node tests for lib/scripts (file I/O, mocked
    // networks); happy-dom for the React app code so we can render
    // components and exercise DOM APIs without spinning up a real browser.
    projects: [
      {
        extends: true,
        test: {
          name: 'lib',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'happy-dom',
          include: ['app/**/*.test.{ts,tsx}'],
          setupFiles: ['./test-setup/app.ts'],
        },
      },
    ],
  },
});
