import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'scripts/**',
      'supabase/**',
      'tmp-*',
      'coverage/**',
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // OPTIMIZATION_CLEANUP_AUDIT.md Medium #31 — catches the split
      // value/type-import-from-same-module pattern that had crept into
      // several files (merge with `import { x, type Y } from '...'`).
      'import/no-duplicates': 'error',
    },
  },
];

export default config;
