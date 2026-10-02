import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      // typescript-eslint's own guidance: tsc already catches genuine
      // undefined-variable errors, more accurately than this JS-level rule
      // can — base no-undef doesn't know about ambient/global types like
      // @types/react's `React` namespace (React.ReactNode, React.FormEvent
      // used without an explicit import), and flat config does no
      // environment auto-detection, so it also misses every browser/Node
      // runtime global (fetch, document, process, alert, ...).
      'no-undef': 'off',
      // Matches the root eslint.config.mjs convention (SIMPLIFICATION_AND_RBAC_AUDIT.md):
      // `_`-prefixed params/vars are deliberately-unused stubs, not an error.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@kitabu/*'],
              message: 'Ukoo code must not import from @kitabu packages (except @kitabu/ui)',
              allowTypeImports: false,
            },
          ],
          paths: [
            {
              name: '@kitabu/core',
              message: 'Use @ukoo/core instead',
            },
            {
              name: '@kitabu/ports',
              message: 'Use @ukoo/ports instead',
            },
          ],
        },
      ],
      // Allow @kitabu/ui for shared components
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^@kitabu\\/(?!ui)/]',
          message: 'Ukoo code must not import from @kitabu services (except @kitabu/ui)',
        },
      ],
    },
  },
];
