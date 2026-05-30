// Flat ESLint config converted to an explicit flat-style configuration.
// This avoids using FlatCompat and lists baseline rules and plugins directly.

const tsPlugin = require('@typescript-eslint/eslint-plugin');
const vitestPlugin = require('eslint-plugin-vitest');

module.exports = [
  {
    files: ['**/*.{ts,js}'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: ['./tsconfig.app.json', './tsconfig.spec.json']
      },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        vi: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      vitest: vitestPlugin
    },
    // Small baseline set of rules mirroring the previous config
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['server/**', 'server/**/*.cjs'],
    languageOptions: {
      parserOptions: {
        project: false
      }
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
];
