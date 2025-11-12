// Migrated to Antfu's flat ESLint config. See: https://github.com/antfu/eslint-config
// We preserve prior custom rules (naming-convention for imports, curly, eqeqeq)
// Prettier plugin integration is intentionally removed because Antfu's stylistic
// setup handles formatting opinions; we still keep the separate prettier script.
import antfu from '@antfu/eslint-config';

// Custom inline ESLint rule: prefer type aliases over interfaces
// Converts any TS interface declaration into an equivalent type alias.
// Note: Disabled by default (set severity below) so that adoption can be gradual.
const interfaceToTypeRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Convert interface to type',
      recommended: false,
    },
    fixable: 'code',
    schema: [],
  },
  create(context) {
    return {
      TSInterfaceDeclaration(node) {
        const interfaceName = node.id.name;
        // const sourceCode = context.getSourceCode();
        // const typeParams = node.typeParameters
        //   ? sourceCode.getText(node.typeParameters)
        //   : '';

        // const bodyStart = node.body.range[0];
        // const bodyEnd = node.body.range[1];

        context.report({
          node,
          message: `Interface declaration disallowed in tests '${interfaceName}'. Import from source instead`,
          fix(fixer) {
            return fixer.replaceText(node, '');
          },
        });
      },
    };
  },
};

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
      'no-inner-declarations': ['error'],
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
    plugins: {
      // Register local rules under the "local" namespace
      local: {
        rules: {
          'block-interfaces': interfaceToTypeRule,
        },
      },
    },
    rules: {
      // Allow console logging inside tests for debugging purposes
      'no-console': 'off',
      // Opt-in: enable as 'warn' (change to 'error' for strict enforcement or 'off' to disable)
      'local/block-interfaces': 'error',
    },
  }
);
