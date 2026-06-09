import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'lib/**', 'lib-esm/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // No let — all bindings must be const (prefer-const handles the trivially-fixable
      // subset; no-restricted-syntax hard-bans all let including reassigned declarations)
      'prefer-const': 'error',
      'no-var': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "VariableDeclaration[kind='let']",
          message:
            "Use const; restructure reassignment with map/reduce/ternary (project rule: no let).",
        },
      ],

      // No any — explicit any is never permitted in non-test source
      '@typescript-eslint/no-explicit-any': 'error',

      // Forbid non-null and as-any casts
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Naming convention: PascalCase for type aliases/interfaces, camelCase for vars/functions/params
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
      ],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // __tests__ override: exempt from type-strictness rules (RQ-01)
  // Structural rules (naming, no-var) still apply; no-any and prefer-const are relaxed.
  {
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
