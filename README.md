# Copilot Breakpoint Debugger

Use GitHub Copilot (or any LM-enabled workflow in VS Code) to start, inspect, and resume debug sessions automatically with conditional breakpoints, hit conditions, and logpoints.

## ✨ Features

The extension contributes Language Model Tools that Copilot can invoke:

1. **Start Debugger** (`start_debugger_with_breakpoints`) – Launch a configured debug session and wait for the first breakpoint (you must supply at least one breakpoint with an exact-name `variableFilter` list; also supports logpoints & capture actions).
2. **Resume Debug Session** (`resume_debug_session`) – Continue execution of an existing paused session and optionally wait for the next stop (new breakpoints added during resume may omit `variableFilter` if you only need a pause, but include it for scoped variable output or interpolation).
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

> **Important:** `start_debugger_with_breakpoints` requires at least one breakpoint **and** a non-empty `variableFilter` per breakpoint. Each `variableFilter` is a list of **exact** variable names (case-sensitive). Regex / glob patterns are not supported; enumerate only what you need to minimize output.

Example settings snippet:

### Server Readiness Automation (Unified `trigger` + `action`)

You may supply a `serverReady` object when starting the debugger to run an automated action (shell command, HTTP request, or VS Code command) once the target is "ready".

Structure:

```ts
interface ServerReady {
  trigger?: { path?: string; line?: number; pattern?: string };
  action:
    | { shellCommand: string }
    | {
        httpRequest: {
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        };
      }
    | { vscodeCommand: { command: string; args?: unknown[] } };
}
```

Modes (decided by `trigger`):

1. Breakpoint trigger – provide `trigger.path` + `trigger.line`. When that source breakpoint is hit (whether first or after entry) the action executes, then the session automatically continues to the first user breakpoint.
2. Pattern trigger – provide `trigger.pattern` (regex). A VS Code `serverReadyAction` URI is injected; built-in output detectors (debug console / task terminal) fire it when the pattern appears. Action executes asynchronously (fire‑and‑forget) without blocking normal breakpoint flow.
3. Immediate attach – omit `trigger` entirely for `request: "attach"` configurations (e.g., Azure Functions). The action runs immediately after attach since output may have scrolled before the adapter connected.

Actions:

- `shellCommand` – Runs in a new terminal named `serverReady-<phase>` (phase is `entry`, `late`, or `immediate`).
- `httpRequest` – Issues a fetch; now dispatched fire‑and‑forget so a slow service cannot block debugger continuation.
- `vscodeCommand` – Invokes a VS Code command (e.g. telemetry-free internal toggles or extension commands) with optional `args`.

Examples:

```jsonc
// Pattern-based readiness executing an HTTP health probe
{
  "serverReady": {
    "trigger": { "pattern": "listening on .*:3000" },
    "action": { "httpRequest": { "url": "http://localhost:3000/health" } },
  },
}
```

```jsonc
// Breakpoint-triggered shell command
{
  "serverReady": {
    "trigger": { "path": "src/server.ts", "line": 27 },
    "action": { "shellCommand": "curl http://localhost:3000/health" },
  },
}
```

```jsonc
// Immediate attach (Azure Functions) – no trigger; action fires right after attach
{
  "serverReady": {
    "action": { "httpRequest": { "url": "http://localhost:7071/api/status" } },
  },
}
```

```jsonc
// VS Code command action (e.g., close panel after readiness)
{
  "serverReady": {
    "trigger": { "path": "src/server.ts", "line": 10 },
    "action": { "vscodeCommand": { "command": "workbench.action.closePanel" } },
  },
}
```

Azure Functions Attach Sequence (Immediate Action):

```mermaid
sequenceDiagram
  participant VSCode
  participant DebugAdapter
  participant Extension
  participant FunctionsHost as Functions Host
  VSCode->>DebugAdapter: start attach (stopOnEntry=true)
  DebugAdapter-->>VSCode: (no initial stop; adapter ignores stopOnEntry)
  Extension->>Extension: trigger omitted ⇒ immediate serverReady action
  Extension->>FunctionsHost: HTTP GET /api/status
  FunctionsHost-->>Extension: 200 OK
  Extension->>DebugAdapter: wait for first user breakpoint
  DebugAdapter-->>VSCode: stopped (breakpoint)
  Extension->>VSCode: tool result (variables, call stack)
```

Pattern detection uses an internal `vscode://dkattan.copilot-breakpoint-debugger/serverReady?token=...` URI. No custom regex scanning or fallback logic is implemented (honors the **NO FALLBACK** principle). If omitted, the debugger behaves normally (entry stop then user breakpoints).

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
Start the debugger in workspace folder /absolute/path/to/project with a breakpoint at src/index.ts line 15 filtering variables foo,bar.
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
Start the debugger with a breakpoint at src/app.ts line 42 filtering variables user,session.
```

```text
Resume the last debug session, add a breakpoint at src/server.ts line 42 filtering variables orderId,orderTotal then wait for it to hit.
```

```text
Evaluate the expression user.profile[0].email in the currently paused session.
```

```text
Stop every debug session named "Web API".
```

### Prompt Priorities & Output Size

Tool responses are rendered with `@vscode/prompt-tsx`, the same priority-aware prompt builder used in Microsoft’s chat samples. Each tool result includes structured parts so Copilot (or any prompt-tsx–aware planner) can automatically drop low-priority sections when the context window is tight.

- High priority → breakpoint summary (session/file/line)
- Medium priority → thread + frame metadata
- Low priority → filtered scope snapshots (pruned first)

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
- `npm run lint` – ESLint static analysis (run with `--fix` for autofix)


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
  - (Optional) Lint autofix: `npm run lint -- --fix`
4. **Test**: `npm test`
   - Uses `@vscode/test-cli` to launch a temporary VS Code build inside `.vscode-test/`
   - If a previous run hangs, delete `.vscode-test/` and rerun

You can also run tests/debug from VS Code’s Run and Debug view using the provided launch configurations. No dual-install workflow is required anymore; use whichever VS Code channel you prefer.

---

## 📦 Publishing & Release Workflow

Standard release checklist (copy/paste):

```text
1. Update code / docs
2. npm run lint
3. npm test (all pass)
4. Update CHANGELOG.md (new section [x.y.z] - YYYY-MM-DD)
5. Bump version in package.json
6. git add . && git commit -m "chore(release): x.y.z <summary>"
7. git tag -a vx.y.z -m "Release vx.y.z: <summary>"
8. git push origin main --follow-tags
9. (CI) Publishes: verifies, packages, publishes marketplace
10. (Optional) gh release create vx.y.z --title "vx.y.z" --notes-file RELEASE_NOTES_x.y.z.md
```

CI/CD – `.github/workflows/ci.yml` runs lint/format/test on push & PR, then packages + publishes on GitHub releases.

Secrets – add `VSCE_PAT` (Marketplace PAT with Manage scope); `GITHUB_TOKEN` is provided automatically.

Manual publish – `npm run lint && npm test`, bump version (`npm version patch|minor|major`), then `npx @vscode/vsce package` and `npx @vscode/vsce publish -p <VSCE_PAT>`.

Release flow – push tag & create a GitHub release to trigger publish workflow.

### Automated Release Script

You can automate steps 4–9 with the PowerShell helper `New-Release.ps1` (auto-increments version):

```powershell
./New-Release.ps1 -ReleaseNotes "**Added:** Feature X`n**Fixed:** Issue Y"
```

Parameters:

- `-ReleaseNotes` (string) – Markdown body inserted into CHANGELOG and used for GitHub release notes.
- `-Date` (optional) – Override date; defaults to current UTC.
- `-SkipGitPush` – Create commit + tag locally but do not push.
- `-DryRun` – Show planned changes without applying.

Auto versioning: Script scans existing tags (`git tag --list 'v*'`), parses semantic versions, selects the highest, then increments the patch (Build) component. If no tags exist it starts at `0.0.1`.

Behavior:

1. Prepends a new `## [Version] - Date` section after `## [Unreleased]` in `CHANGELOG.md`.
2. Commits the CHANGELOG update.
3. Creates annotated tag `vX.Y.Z(.R)`.
4. Pushes commit and tag (unless `-SkipGitPush`).
5. Creates GitHub release with the provided notes if `gh` CLI is available & authenticated.

For multi-line notes, use a here-string:

```powershell
$notes = @'
**Added:** Dashboard refresh
**Changed:** Improved variable filtering docs
**Fixed:** Race condition in session start
'@
./New-Release.ps1 -ReleaseNotes $notes
```

## 🗒️ Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## 🛡️ License

MIT © Contributors
