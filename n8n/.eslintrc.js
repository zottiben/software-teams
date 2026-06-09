/**
 * ESLint config for @websitelabs/n8n-nodes-software-teams.
 *
 * @n8n/node-cli bundles the community-node lint rules internally
 * (eslint-plugin-n8n-nodes-base / @n8n/eslint-plugin-community-nodes).
 * Running `n8n-node lint` applies those bundled rules without any extra
 * devDependency. This file provides the base parser/plugin wiring so editors
 * and CI can also run `eslint` directly if needed.
 */
/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module',
    ecmaVersion: 2020,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // n8n community-node rules are enforced via `n8n-node lint` (which uses
    // the bundled eslint-plugin-n8n-nodes-base rules). Additional project
    // rules can be added here.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
  ignorePatterns: ['dist/**', 'node_modules/**', '**/__tests__/**'],
};
