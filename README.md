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

`copilot-debugger.entryTimeoutSeconds` – How long (in seconds) to wait for the initial _entry_ stop after launching (before continuing to user breakpoints). Increase this for large projects with long cold builds or container start times (e.g. 180). If the entry stop is not observed within the window a timeout error is returned.

> **Important:** `start_debugger_with_breakpoints` requires at least one breakpoint **and** a non-empty `variableFilter`. Tight filters keep the response concise so Copilot doesn’t exhaust the LLM context window.

Example settings snippet:

```jsonc
{
  "copilot-debugger.defaultLaunchConfiguration": "Run test.js",
  "copilot-debugger.entryTimeoutSeconds": 120,
}
```

### Launch Configuration Resolution

The Start Debugger tool uses a single `configurationName` field. Resolution order:

1. Provided `configurationName`
2. Workspace setting `copilot-debugger.defaultLaunchConfiguration`
3. Auto-select when the target workspace folder defines **exactly one** launch configuration

If none of the above apply (and multiple configs exist), an error is returned so Copilot can request clarification instead of silently guessing.

Minimal example (auto-selection when sole config exists):

```text
Start the debugger in workspace folder /absolute/path/to/project with a breakpoint at src/index.ts line 15 and variables foo,bar.
```

Explicit configuration example:

```text
Start debug with configurationName "Run test.js" adding a breakpoint at test-workspace/b/test.js line 9 filtering variable i.
```

Capture example:

```text
Start debug with configurationName "Run test.js" and capture action at test-workspace/b/test.js line 9 filtering i and log message "i={i}".
```

> Tip: Variable filters are exact name matches (case-sensitive) and required per breakpoint to keep responses concise for the LLM.

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

Tool responses are now rendered with `@vscode/prompt-tsx`, the same priority-aware prompt builder used in Microsoft’s chat samples. Each tool result includes a structured `LanguageModelPromptTsxPart`, so Copilot (or any prompt-tsx–aware planner) can automatically drop low-priority sections when the context window is tight.

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

`npm test` compiles the extension and runs the full VS Code integration suite via `@vscode/test-cli`. Set `CI=true` to skip PowerShell-specific cases. Tests live under `src/test/` (extension smoke tests, DAP helper flows, and multi-root coverage). You can also run them from VS Code’s Test Explorer using the supplied launch configs—just avoid executing compiled files manually, as the harness wires up the VS Code host and Mocha globals for you. Pre-commit hooks mirror these checks so local commits match CI expectations.

### Local Development Setup

1. **Prerequisites**
   - Node.js 18+ (uses VS Code’s Node runtime features)
   - npm 10+
   - Any edition of VS Code (Stable or Insiders)
2. **Install**: `npm install`
3. **Iterate**
   - Build once: `npm run compile`
   - Watch for changes: `npm run watch`
   - Lint: `npm run lint`
   - Format: `npm run format`
4. **Test**: `npm test`
   - Uses `@vscode/test-cli` to launch a temporary VS Code build inside `.vscode-test/`
   - If a previous run hangs, delete `.vscode-test/` and rerun

You can also run tests/debug from VS Code’s Run and Debug view using the provided launch configurations. No dual-install workflow is required anymore; use whichever VS Code channel you prefer.

---

## 📦 Publishing

- **CI/CD** – `.github/workflows/ci.yml` runs lint/format/test on push & PR, then packages + publishes on GitHub releases.
- **Secrets** – add `VSCE_PAT` (Marketplace PAT with Manage scope); `GITHUB_TOKEN` is provided automatically.
- **Manual publish** – `npm run lint && npm test`, bump `npm version`, then `npx @vscode/vsce package` and `npx @vscode/vsce publish -p <VSCE_PAT>`.
- **Release flow** – tag (`git push --tags`) and create a GitHub release to kick off the publish workflow.

## 🗒️ Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## 🛡️ License

MIT © Contributors

---

> Preview: Functionality may evolve; expect breaking changes prior to 1.0.0.
