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
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@kitabu/*'],
              message: 'Ukoo code must not import from @kitabu packages (except @kitabu/ui)',
              allowTypeOnly: false,
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
