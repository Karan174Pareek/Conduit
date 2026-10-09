import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.{test,spec}.ts', 'apps/**/src/**/*.{test,spec}.ts'],
  },
});
