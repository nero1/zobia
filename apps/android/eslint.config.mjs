// ESLint flat config (v9+) — same minimal shape as apps/expo/eslint.config.mjs,
// plus react-hooks rules since this is a browser React app (Expo's config is
// TS-only). Added as part of ZB-AND-10: the Android app previously had no
// ESLint configuration at all, so `npm run lint` at the repo root skipped it
// silently.
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'android/**', 'src/routeTree.gen.ts', '**/*.js'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        IntersectionObserver: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLElement: 'readonly',
        TouchEvent: 'readonly',
        React: 'readonly',
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Only the two long-standing hooks-correctness rules — NOT the plugin's
      // "recommended" preset, which (as of v7) also bundles a large set of
      // React Compiler readiness rules (purity, set-state-in-effect, etc.)
      // that would flag many long-standing, valid patterns across this
      // codebase as errors; that's a separate, opt-in migration, not a lint
      // bar this app has ever been held to.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
