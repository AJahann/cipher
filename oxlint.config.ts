import { defineConfig } from '@fullstacksjs/oxlint-config';

export default defineConfig({
  modules: {
    nodejs: true,
    react: true,
    nextjs: true,
    vitest: true,
  },
  overrides: [
    {
      files: ['packages/api/src/db/schema/**/*.ts'],
      rules: {
        'import/no-cycle': 'off',
      },
    },
    {
      files: ['apps/web/e2e/fixtures.ts'],
      rules: {
        'no-empty-pattern': 'off',
      },
    },
  ],
});
