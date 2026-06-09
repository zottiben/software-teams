import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
  ...configWithoutCloudSupport,
  // Exclude test files — they use bun:test which is not resolvable by the
  // import resolver, and they are run by Bun directly (not n8n).
  { ignores: ['**/__tests__/**'] },
  // Utility/infrastructure src/ files: relax rules that apply to the n8n
  // node layer only (typed errors, runtime error classes, strict typing).
  // no-explicit-any is intentionally NOT disabled here — violations in src/
  // should be reported and fixed (RQ-01/RQ-03).
  {
    files: ['src/**/*.ts'],
    rules: {
      '@n8n/community-nodes/require-node-api-error': 'off',
      // Allow _-prefixed unused function arguments (standard TS convention)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
