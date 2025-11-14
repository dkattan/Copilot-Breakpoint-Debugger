// Migrated to Antfu's flat ESLint config. See: https://github.com/antfu/eslint-config
// We preserve prior custom rules (naming-convention for imports, curly, eqeqeq)
// Prettier plugin integration is intentionally removed because Antfu's stylistic
// setup handles formatting opinions; we still keep the separate prettier script.
import antfu from '@antfu/eslint-config';

// Custom rule to ban "fallback" or "fall-back" in any form
const banFallbackTerms = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the terms "fallback" or "fall-back" because they mask errors',
      recommended: true,
    },
    schema: [],
  },
  create(context) {
    const forbiddenPattern = /fall[-\s]?back/i;
    const sourceCode = context.sourceCode || context.getSourceCode();

    // Check all comments
    const comments = sourceCode.getAllComments();
    for (const comment of comments) {
      if (forbiddenPattern.test(comment.value)) {
        context.report({
          node: comment,
          message: 'Fallbacks are banned because they mask errors',
        });
      }
    }

    return {
      // Check all identifiers (variables, functions, classes, properties, etc.)
      Identifier(node) {
        if (forbiddenPattern.test(node.name)) {
          context.report({
            node,
            message: `Fallbacks are banned because they mask errors: "${node.name}"`,
          });
        }
      },
      // Check string literals
      Literal(node) {
        if (
          typeof node.value === 'string' &&
          forbiddenPattern.test(node.value)
        ) {
          context.report({
            node,
            message: `Fallbacks are banned because they mask errors: "${node.value}"`,
          });
        }
      },
      // Check template literals
      TemplateLiteral(node) {
        const templateText = node.quasis.map(q => q.value.raw).join('');
        if (forbiddenPattern.test(templateText)) {
          context.report({
            node,
            message: 'Fallbacks are banned because they mask errors',
          });
        }
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
  // Register custom local rules globally for all file types
  {
    plugins: {
      local: {
        rules: {
          'ban-fallback': banFallbackTerms,
        },
      },
    },
  },
  // Apply naming convention and ban-fallback only to TS files
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
      'local/ban-fallback': 'error',
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
      // Block type and interface declarations in test files - import from source instead
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeAliasDeclaration',
          message: 'Type declarations are disallowed in test files. Import from source instead.',
        },
        {
          selector: 'TSInterfaceDeclaration',
          message: 'Interface declarations are disallowed in test files. Import from source instead.',
        },
      ],
    },
  }
);
