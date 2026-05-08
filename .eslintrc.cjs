module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  overrides: [
    {
      files: ['**/*.ts'],
      parserOptions: {
        project: false
      }
    }
  ],
  env: {
    node: true,
    es2022: true
  },
  globals: {
    describe: 'readonly',
    it: 'readonly',
    expect: 'readonly',
    beforeEach: 'readonly',
    vi: 'readonly'
  },
  plugins: ['@typescript-eslint', 'vitest'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }]
  },
  overrides: [
    {
      files: ['server/**', 'server/**/*.js'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-var-requires': 'off'
      }
    }
  ]
}