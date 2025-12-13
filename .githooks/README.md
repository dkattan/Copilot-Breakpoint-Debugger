# Git Hooks

This directory contains git hooks that ensure code quality before commits.

## Automatic Setup

When you open this workspace in VS Code, the `setup-git-hooks` task will automatically:

1. Make the hooks executable
2. Configure git to use hooks from this directory
3. Display a confirmation message

## Manual Setup

If you need to set up the hooks manually, run:

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

## Pre-Commit Hook

The pre-commit hook runs the following checks before each commit:

1. **Format Check** - Ensures code follows formatting rules
2. **Linter** - Runs ESLint to catch potential issues
3. **TypeScript Compilation** - Verifies code compiles without errors
4. **Tests** - Runs the full test suite

If any check fails, the commit will be aborted. This ensures that only quality code is committed to the repository.

## Bypassing Hooks (Emergency Only)

In rare cases where you need to bypass the hooks (e.g., work in progress commit), use:

```bash
git commit --no-verify -m "WIP: your message"
```

**Note**: Use this sparingly as it bypasses all quality checks!

## Troubleshooting

### Tests Hang or Timeout

If tests hang during the pre-commit hook:

1. Close any VS Code windows that are testing the extension
2. Kill any hanging test processes: `pkill -f "npm test"`
3. Try committing again

### Hook Not Running

Verify the git hooks path is configured:

```bash
git config core.hooksPath
```

Should output: `.githooks`

If not, run the manual setup commands above.
