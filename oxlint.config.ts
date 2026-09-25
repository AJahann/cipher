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
      // These two contexts must be created and closed sequentially.
      files: ['apps/web/e2e/auth.setup.ts'],
      rules: {
        'no-await-in-loop': 'off',
      },
    },
    {
      // These integration tests intentionally model retries and nested async
      // request lifecycles; flattening them would reduce test fidelity.
      files: ['apps/web/src/lib/data-layer/chats/use-chat.test.tsx'],
      rules: {
        'max-lines-per-function': 'off',
        'max-nested-callbacks': 'off',
        'vitest/no-conditional-in-test': 'off',
      },
    },
    {
      // Drizzle relation declarations are intentionally cyclic.
      files: ['packages/api/src/db/schema/**/*.ts'],
      rules: {
        'import/no-cycle': 'off',
      },
    },
    {
      // These classes are stable static namespaces used by the public crypto API.
      files: ['packages/shared/src/crypto/keys.ts', 'packages/shared/src/crypto/e2e.ts'],
      rules: {
        'import/no-named-as-default-member': 'off',
        'typescript/no-extraneous-class': 'off',
      },
    },
    {
      // Socket registration is a single cohesive boundary; splitting it would
      // make the event wiring harder to audit.
      files: ['packages/api/src/modules/chat/chat.socket.ts'],
      rules: {
        'max-lines-per-function': 'off',
        'typescript/no-empty-object-type': 'off',
      },
    },
    {
      // Fastify's hook type accepts this async handler shape.
      files: ['packages/api/src/modules/auth/auth.middleware.ts'],
      rules: {
        'require-await': 'off',
      },
    },
    {
      // The mock must be hoisted before this intentionally late import.
      files: ['apps/web/src/lib/data-layer/chats/use-chat-socket.test.tsx'],
      rules: {
        'import/first': 'off',
      },
    },
  ],
});
