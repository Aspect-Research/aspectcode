// @ts-check
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', 'parsers/**', 'scripts/**', '*.vsix'],
  },

  // Base TS config for all source files
  ...tseslint.configs.recommended,

  // Project-specific rules
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.lint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ----- Safety -----
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',

      // ----- Style (non-Prettier) -----
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-throw-literal': 'error',

      // ----- Keep off for now (too noisy for existing code) -----
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Test files — relax some rules
  {
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
    },
  },

  // Prettier compat — MUST be last
  eslintConfigPrettier,
);
