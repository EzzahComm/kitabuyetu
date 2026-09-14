import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

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
  ...nextTypescript,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // OPTIMIZATION_CLEANUP_AUDIT.md Medium #31 — catches the split
      // value/type-import-from-same-module pattern that had crept into
      // several files (merge with `import { x, type Y } from '...'`).
      'import/no-duplicates': 'error',
      // OPTIMIZATION_CLEANUP_AUDIT.md's no-explicit-any ratchet — every
      // pre-existing usage was fixed (reusing real service/DB types) before
      // this was turned on, so it's a hard error from day one, not a
      // baseline/allowlist. See project memory for the fix commits.
      '@typescript-eslint/no-explicit-any': 'error',
      // SIMPLIFICATION_AND_RBAC_AUDIT.md — codifies a convention already in
      // use across the codebase (`_unused`, `_secret`, `_invert`, etc. for
      // deliberately-unused destructured values) rather than fighting it.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // next.config.js is loaded via Node's CJS require() (no "type": "module"
    // in package.json) — require() here isn't legacy style, it's the only
    // form Next's config loader accepts.
    files: ['next.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // daraja-callback-token.test.ts and template-aliases.test.ts both
    // re-require a module fresh after jest.resetModules() per case, to
    // re-run module-scope env-dependent logic (platformPaybill() reads
    // process.env at import time) — a static top-level import can't be
    // re-evaluated mid-test. Inline eslint-disable-next-line comments were
    // tried first for template-aliases.test.ts but proved fragile under
    // automated reformatting (the disable can desync from the require()
    // line it guards); a file-level override is immune to that.
    files: [
      '__tests__/unit/services/daraja-callback-token.test.ts',
      '__tests__/unit/sms/template-aliases.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default config;


