# Copilot Breakpoint Debugger (Preview)

Use GitHub Copilot (or any LM-enabled workflow in VS Code) to start, inspect, and resume debug sessions automatically with conditional breakpoints, hit conditions, and logpoints.

## ✨ Features

The extension contributes Language Model Tools that Copilot can invoke:

1. **Start Debugger** (`start_debugger_with_breakpoints`) – Launch a configured debug session and wait for the first breakpoint (optionally set breakpoints/logpoints or filter variables).
2. **Resume Debug Session** (`resume_debug_session`) – Continue execution of an existing paused session and optionally wait for the next stop.
3. **Get Variables** (`get_variables`) – Retrieve all variables in the current top stack frame scopes.
4. **Expand Variable** (`expand_variable`) – Drill into a single variable to inspect its immediate children.
5. **Evaluate Expression** (`evaluate_expression`) – Run an arbitrary expression (like the Debug Console) in the paused stack frame.
6. **Stop Debug Session** (`stop_debug_session`) – Terminate matching debug sessions when you’re done.

All tools return structured data that Copilot can reason over (JSON-like text parts containing call stacks, variables, and metadata).

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace: `ext install dkattan.copilot-breakpoint-debugger` (or `code --install-extension dkattan.copilot-breakpoint-debugger`).

   Prefer to hack on it locally? Clone the repo and run:

```bash
git clone https://github.com/dkattan/vscode-copilot-debugger.git
cd vscode-copilot-debugger
npm install
npm run compile
```

1. Open the folder in VS Code (Insiders recommended for dev).

1. Set a default launch configuration name or inline JSON in your settings:

```jsonc
// settings.json
{
  "copilot-debugger.defaultLaunchConfiguration": "Launch Program",
}
```

1. Start interacting with Copilot Chat. It can now reference the tools by name.

## 🔧 Configuration

`copilot-debugger.defaultLaunchConfiguration` – The name of a `launch.json` configuration OR an inline JSON object (e.g. `{"type":"node","request":"launch","program":"${workspaceFolder}/index.js"}`).

> **Important:** `start_debugger_with_breakpoints` requires at least one breakpoint **and** a non-empty `variableFilter`. Tight filters keep the response concise so Copilot doesn’t exhaust the LLM context window.

## 🧪 Example Copilot Prompts

```text
Start the debugger with a breakpoint at src/app.ts line 42; only show variables matching ^(user|session)$.
```

```text
Resume the last debug session, add a breakpoint at src/server.ts line 42 and filter ^order_, then wait for it to hit.
```

```text
Evaluate the expression user.profile[0].email in the currently paused session.
```

```text
Stop every debug session named "Web API".
```

### Prompt Priorities & Output Size

Tool responses are now rendered with `@vscode/prompt-tsx`, the same priority-aware prompt builder used in Microsoft’s chat samples. Each tool result includes a structured `LanguageModelPromptTsxPart`, so Copilot (or any prompt-tsx–aware planner) can automatically drop low-priority sections when the context window is tight. The payload also contains a short text summary as a convenient fallback for clients that don’t yet understand prompt-tsx content.

- High priority → breakpoint summary (session/file/line).
- Medium priority → thread + frame metadata.
- Low priority → filtered scope snapshots (potentially large, so they’re pruned first).

Because variable filters are mandatory and the prompt is minified before returning, typical tool output is now only a few thousand characters instead of tens of thousands.

## 🐞 Debug Info Returned

Responses include:

- Breakpoint hit metadata (file, line, reason)
- Call stack (threads, frames, source info)
- Scoped variables (filtered if requested)
- Variable expansion (children)

## 🔐 Privacy / Telemetry

This extension does **not** collect or transmit telemetry. All processing occurs locally via the VS Code Debug Adapter Protocol (DAP). If telemetry is added in the future, this section will document exactly what is sent and how to opt out.

## ♿ Accessibility

All commands are exposed as LM tools and can be invoked via keyboard using Copilot Chat. Output is provided as text parts suitable for screen readers. Please open issues for any accessibility improvements.

## 🤝 Contributing

Contributions are welcome!

1. Fork the repo
2. Create a feature branch
3. Run `npm run lint && npm test`
4. Submit a PR

### Development Scripts

- `npm run watch` – Incremental TypeScript compilation
- `npm test` – Compiles then runs test suite
- `npm run lint` – ESLint static analysis
- `npm run format` – Auto-format code with Prettier
- `npm run format:check` – Check formatting without changes

### Testing

#### Automated Local Testing

When you open this workspace in VS Code, a task automatically configures git hooks that run all checks before each commit:

1. **Format Check** - Ensures code follows Prettier rules
2. **Linter** - Runs ESLint
3. **TypeScript Compilation** - Verifies code compiles
4. **Tests** - Runs the full test suite

This ensures quality code is committed without relying on CI for feedback.

#### Test Organization

- **Smoke Test**: `src/test/extension.test.ts` validates the harness is wired up.
- **DAP Helpers**: `src/test/debugUtils.test.ts` exercises breakpoint handling, variable inspection, and logpoints with Node.
- **Multi-root Integration**: `src/test/multiRootWorkspace.test.ts` runs full start/resume flows across multiple workspace folders.

#### Running Tests

```bash
# Run all tests
npm test

# Run tests in CI mode (skips PowerShell-only tests)
CI=true npm test
```

#### Test Execution Notes

Do not run individual compiled test files (e.g. `node out/test/evaluateExpressionTool.test.js`) directly — Mocha's globals (`describe`, `it`) won't be initialized and you'll see `ReferenceError: describe is not defined`. Always use the harness (`npm test`) so the VS Code extension host and programmatic Mocha runner set up the environment.

Each test file explicitly imports Mocha functions (`import { describe, it } from 'mocha';`) to make intent clear and guard against accidental direct execution when using tooling that doesn't inject globals.

You can optionally install the "Extension Test Runner" (`ms-vscode.extension-test-runner`) extension to view and run tests from the VS Code Test Explorer UI. This provides granular pass/fail indicators and single-test debug without replacing the existing CLI harness. Keep `npm test` as the source of truth for CI parity.

#### CI Testing Strategy

Integration tests that start actual debug sessions are **skipped in CI** because headless VS Code processes aren’t reliable on hosted runners. Instead, git hooks run the full suite locally before every commit. The Node.js-based integration tests provide cross-platform coverage without depending on PowerShell.

### Using VS Code Insiders for Development (Recommended Dual Setup)

Due to a current VS Code limitation, running extension integration tests **from the command line** only works when no other instance of VS Code (Stable) is already running. To keep a smooth inner loop (edit + debug) while still validating tests via CLI, use a dual-install setup:

**Pattern:**

| Activity                                                     | VS Code Edition |
| ------------------------------------------------------------ | --------------- |
| Day-to-day development (editing, live debugging, Chat)       | Insiders        |
| Running `npm test` (CLI harness via `@vscode/test-electron`) | Stable          |

**Why this works:** The test runner (see `src/test/runTest.ts`) downloads a fresh Stable build into `.vscode-test/` and launches it headlessly. If you only have Insiders open, the Stable process can start cleanly without colliding with an existing instance.

#### Setup Steps

1. Install both VS Code Stable and VS Code Insiders.
1. Use Insiders for development: open this repo in **VS Code Insiders** normally.
1. Run tests from a terminal (outside any currently running Stable window):

```bash
npm test
```

1. If you need to debug tests interactively, use the built-in debug configuration (Run and Debug view) instead of the pure CLI.

#### Common Pitfalls & Fixes

| Symptom                                                                                                              | Cause                                                             | Fix                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Running extension tests from the command line is currently only supported if no other instance of Code is running.` | A Stable window is open while CLI tries to start Stable for tests | Close all VS Code Stable windows; keep only Insiders open              |
| Tests hang at startup                                                                                                | Conflicting user-data or extensions dir locked                    | Clear `.vscode-test/` directory or ensure previous test process exited |

#### Optional Convenience Aliases (macOS / zsh)

Add to your `~/.zshrc`:

```bash
alias vscodes='open -a "Visual Studio Code"'
alias codei='open -a "Visual Studio Code - Insiders"'
```

Then:

```bash
codei .   # develop
npm test  # run tests (Stable headless)
```

#### Running Tests Inside the Editor

If you prefer not to manage dual installs, you can run and debug tests from the **Insiders** editor (Run and Debug view) using a launch configuration that points to `out/test/runTest.js`. This avoids the CLI constraint but ties up the Insiders window until tests finish.

---

## 📦 Publishing (Maintainer Notes)

### Automated CI/CD

This repository includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that automatically:

1. **On push/PR to main**: Builds, lints, formats, and tests the extension on Ubuntu, Windows, and macOS
2. **On release**: Packages the extension and publishes to VS Code Marketplace

### Required GitHub Secrets

To enable automated publishing, configure the following secrets in your GitHub repository settings:

1. **`VSCE_PAT`** (required for marketplace publishing):
   - Create a Personal Access Token at <https://dev.azure.com/>
   - Organization: Create or use an existing Azure DevOps organization
   - Scope: `Marketplace` → `Manage` permission
   - Add this token as a repository secret named `VSCE_PAT`
   - See: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token>

2. **`GITHUB_TOKEN`** (automatically provided):
   - GitHub automatically provides this for uploading VSIX to releases
   - No manual configuration needed

### Manual Publishing

Prerequisites:

- Install `vsce` (`npm install -g @vscode/vsce`) or use `npx @vscode/vsce`
- Set your publisher in `package.json` (currently: `dkattan`)

Steps:

```bash
npm run lint
npm test
npm version patch   # or minor / major
npx @vscode/vsce package
npx @vscode/vsce publish -p YOUR_VSCE_PAT
```

### Creating a Release

To trigger automated publishing:

```bash
# Update version
npm version patch  # or minor/major

# Push changes and tag
git push && git push --tags

# Create GitHub release (triggers publish workflow)
gh release create v0.0.2 --title "Release v0.0.2" --notes "Release notes here"
```

## 🗒️ Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## 🛡️ License

MIT © Contributors

---

> Preview: Functionality may evolve; expect breaking changes prior to 1.0.0.
