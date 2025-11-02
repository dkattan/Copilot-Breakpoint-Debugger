# Copilot Breakpoint Debugger (Preview)

Use GitHub Copilot (or any LM-enabled workflow in VS Code) to start, inspect, and resume debug sessions automatically with conditional breakpoints, hit conditions, and logpoints.

## ✨ Features

The extension contributes Language Model Tools that Copilot can invoke:

1. **Start Debugger** (`start_debugger_with_breakpoints`) – Launch a configured debug session and wait for the first breakpoint (optionally set new breakpoints or filter variables).
2. **Resume Debug Session** (`resume_debug_session`) – Continue execution of an existing paused session and optionally wait for the next stop.
3. **Get Variables** (`get_variables`) – Retrieve all variables in the current top stack frame scopes.
4. **Expand Variable** (`expand_variable`) – Drill into a single variable to inspect its immediate children.

All tools return structured data that Copilot can reason over (JSON-like text parts containing call stacks, variables, and metadata).

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace (coming soon). For now, clone the repo and run:

```bash
git clone https://github.com/dkattan/vscode-copilot-debugger.git
cd vscode-copilot-debugger
npm install
npm run compile
```

1. Open the folder in VS Code.

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

## 🧪 Example Copilot Prompts

```text
Start the debugger and stop at the first breakpoint; only show variables matching ^PWD$.
```

```text
Resume the last debug session, add a breakpoint at src/server.ts line 42, and wait for it to hit.
```

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

- **Unit Tests**: `src/test/extension.test.ts`, `src/test/getStackFrameVariables.test.ts`
- **Integration Tests (Node.js)**: `src/test/*.node.test.ts` - Test debug functionality with Node.js
- **Integration Tests (PowerShell)**: `src/test/*.test.ts` (non-.node) - Test with PowerShell (local only)

#### Running Tests

```bash
# Run all tests
npm test

# Run tests in CI mode (skips PowerShell-only tests)
CI=true npm test
```

#### CI Testing Strategy

Integration tests that start actual debug sessions are **skipped in CI** because:

- VS Code debug sessions don't reliably initialize in headless CI environments
- Even Microsoft's official extension samples skip complex debugging tests in CI
- Tests run automatically via git hooks before local commits

PowerShell-based tests are skipped in CI since they require PowerShell runtime. The Node.js test equivalents provide the same coverage using JavaScript.

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
