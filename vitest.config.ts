import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    // Server helpers get plain .spec.cjs files (matching the rest of
    // server/ being CommonJS) so pure logic like pantry.cjs's normalization
    // and cost-precedence rules stays covered without a bundler step.
    include: ['src/**/*.spec.ts', 'server/**/*.spec.cjs'],
    deps: {
      inline: [
        '@angular/core',
        '@angular/common',
        '@angular/platform-browser',
        '@angular/platform-browser-dynamic',
        '@angular/router'
      ]
    }
  }
});
