// Migrated to Antfu's flat ESLint config. See: https://github.com/antfu/eslint-config
// We preserve prior custom rules (naming-convention for imports, curly, eqeqeq)
import antfu from "@antfu/eslint-config";

// Custom rule to ban "fallback" or "fall-back" in any form
const banFallbackTerms = {
  meta: {
    type: "problem",
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
          message: "Fallbacks are banned because they mask errors",
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
          typeof node.value === "string" &&
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
        const templateText = node.quasis.map((q) => q.value.raw).join("");
        if (forbiddenPattern.test(templateText)) {
          context.report({
            node,
            message: "Fallbacks are banned because they mask errors",
          });
        }
      },
    };
  },
};

const plainTextParser = {
  meta: {
    name: "plain-text-parser",
    version: "1.0.0",
  },
  parseForESLint(text) {
    const lines = text.split(/\r?\n/);
    return {
      ast: {
        type: "Program",
        body: [],
        range: [0, text.length],
        loc: {
          start: { line: 1, column: 0 },
          end: {
            line: lines.length,
            column: lines[lines.length - 1]?.length ?? 0,
          },
        },
        sourceType: "script",
        comments: [],
        tokens: [],
      },
      services: {
        getText: () => text,
      },
    };
  },
};

const forbidNowInReadme = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow the word 'now' in README.md",
      recommended: true,
    },
    schema: [],
    messages: {
      forbidden:
        "The usage of the word 'now' in README.md is not allowed as it should not be used as a historical record. Please move the offending content to CHANGELOG.md",
    },
  },
  create(context) {
    const getSourceCode = () => context.sourceCode || context.getSourceCode();
    const computeLoc = (text, index) => {
      let line = 1;
      let column = 0;
      for (let i = 0; i < index; i += 1) {
        if (text[i] === "\n") {
          line += 1;
          column = 0;
        } else if (text[i] !== "\r") {
          column += 1;
        }
      }
      return { line, column };
    };
    return {
      Program(node) {
        const sourceCode = getSourceCode();
        const text = sourceCode.getText();
        const regex = /\snow\b/gi;
        for (const match of text.matchAll(regex)) {
          const startIndex = match.index + 1; // skip leading space to highlight word
          const startLoc =
            sourceCode.getLocFromIndex?.(startIndex) ??
            computeLoc(text, startIndex);
          const endColumn = startLoc.column + 3; // length of "now"
          context.report({
            node,
            loc: {
              start: startLoc,
              end: { line: startLoc.line, column: endColumn },
            },
            messageId: "forbidden",
          });
        }
      },
    };
  },
};

export default antfu(
  {
    // Enable TypeScript rules; stylistic remains disabled for minimal diffs and faster linting.
    typescript: true,
    stylistic: false,
  },
  // Register custom local rules globally for all file types
  {
    plugins: {
      local: {
        rules: {
          "ban-fallback": banFallbackTerms,
          "no-readme-now": forbidNowInReadme,
        },
      },
    },
  },
  // Apply naming convention and ban-fallback only to TS files
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "ts/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      // Disallow explicit any to maintain type safety; suggest using unknown instead
      "ts/no-explicit-any": ["error"],
      "no-inner-declarations": ["error"],
      "local/ban-fallback": "error",
      quotes: "off",
    },
  },
  // Global lightweight tweaks
  {
    rules: {
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
    },
  },
  // Test directory overrides
  {
    files: ["src/test/**/*.ts", "test-workspace/**/*.js"],
    rules: {
      // Allow console logging inside tests for debugging purposes
      "no-console": "off",
      // Block type and interface declarations in test files - import from source instead
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSTypeAliasDeclaration",
          message:
            "Type declarations are disallowed in test files. Import from source instead.",
        },
        {
          selector: "TSInterfaceDeclaration",
          message:
            "Interface declarations are disallowed in test files. Import from source instead.",
        },
      ],
    },
  },
  // README guardrails
  {
    files: ["README.md"],
    languageOptions: {
      parser: plainTextParser,
    },
    rules: {
      "local/no-readme-now": "error",
    },
  },
  // Ignore large external vendor/source trees not meant for linting in this extension
  {
    ignores: [
      "external/**",
      "coverage/**",
      "out/**",
      "**/*.yml",
      "test-workspace/**",
      "src/generated-meta.ts",
    ],
  }
);
