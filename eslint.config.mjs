// Migrated to Antfu's flat ESLint config. See: https://github.com/antfu/eslint-config
// We preserve prior custom rules (naming-convention for imports, curly, eqeqeq)
// Prettier plugin integration is intentionally removed because Antfu's stylistic
// setup handles formatting opinions; we still keep the separate prettier script.
import antfu from '@antfu/eslint-config';

export default antfu(
  {
    // Enable TypeScript rules; disable stylistic so existing Prettier formatting doesn't conflict
    typescript: true,
    stylistic: false,
  },
  // Apply naming convention only to TS files to avoid markdown/plain parser issues
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'ts/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],
      // Disallow explicit any to maintain type safety; suggest using unknown instead
      'ts/no-explicit-any': ['error'],
    },
  },
  // Global lightweight tweaks
  {
    rules: {
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
    },
  },
  // Test directory overrides
  {
    files: ['src/test/**/*.ts', 'test-workspace/**/*.js'],
    rules: {
      // Allow console logging inside tests for debugging purposes
      'no-console': 'off',
    },
  }
);
