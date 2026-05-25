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
    },
  },
];

export default config;
