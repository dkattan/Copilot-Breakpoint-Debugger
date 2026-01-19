# Copilot Breakpoint Debugger

Use GitHub Copilot (or any LM-enabled workflow in VS Code) to start, inspect, and resume debug sessions automatically with conditional breakpoints, hit conditions, and logpoints.

## ✨ Features

The extension contributes Language Model Tools that Copilot can invoke:

1. **Start Debugger** (`startDebugSessionWithBreakpoints`) – Launch a configured debug session and wait for the first breakpoint. You must supply at least one breakpoint, but `variableFilter` is optional: include it to narrow captured variables, omit it for a pure pause (`break` / `stopDebugging`) or automatic capture-all (`capture` action).
2. **Resume Debug Session** (`resumeDebugSession`) – Continue execution of an existing paused session and optionally wait for the next stop (new breakpoints added during resume may omit `variableFilter` if you only need a pause, but include it for scoped variable output or interpolation).
3. **Get Variables** (`getVariables`) – Retrieve all variables in the current top stack frame scopes.
4. **Expand Variable** (`expandVariable`) – Drill into a single variable to inspect its immediate children.
5. **Evaluate Expression** (`evaluateExpression`) – Run an arbitrary expression (like the Debug Console) in the paused stack frame.
6. **Stop Debug Session** (`stopDebugSession`) – Terminate matching debug sessions when you’re done.

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
  "copilot-debugger.defaultLaunchConfiguration": "Launch Program"
}
```

1. Start interacting with Copilot Chat. It can reference the tools by name.

## 🎥 Demo Video

<!-- pw-videos:start -->
<video src="docs/pw-videos/demo.mp4" controls muted playsinline style="max-width: 100%;"></video>
<!-- pw-videos:end -->

### Demo vs tests

The Playwright demo (`npm run demo:pw`) drives the **Copilot Chat UI** and is designed to run the same way in CI and locally (there is no separate “non-CI” mode).

The regular test suite (`npm test`) is CI-friendly: it exercises the extension’s contributed Language Model Tools directly via `vscode.lm.invokeTool` 

## Commands

<!-- commands -->

| Command                                                      | Title                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `copilotBreakpointDebugger.startAndWaitManual`               | Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Manual Start &amp; Wait          |
| `copilotBreakpointDebugger.setDefaultLaunchConfiguration`    | Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Set Default Launch Configuration |
| `copilotBreakpointDebugger.insertSampleStartDebuggerPayload` | Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Insert Sample Start Payload      |

<!-- commands -->

#### Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Manual Start &amp; Wait

Command                                                     : `copilotBreakpointDebugger.startAndWaitManual`

#### Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Insert Sample Start Payload

Command                                                     : `copilotBreakpointDebugger.insertSampleStartDebuggerPayload`

<!-- commands-list -->

#### Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Manual Start &amp; Wait
Command                                                     : `copilotBreakpointDebugger.startAndWaitManual`  

#### Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Set Default Launch Configuration
Command                                                     : `copilotBreakpointDebugger.setDefaultLaunchConfiguration`  

#### Copilot Breakpoint Debugger: Copilot Breakpoint Debugger: Insert Sample Start Payload
Command                                                     : `copilotBreakpointDebugger.insertSampleStartDebuggerPayload`  

<!-- commands-list -->

### Settings

<!-- configs-list -->

#### `copilot-debugger.defaultLaunchConfiguration`
Description                                                                                                                                                                                        : Name of the default launch configuration to use when starting the debugger  
Type     : `string`  
Default        : `""`  

#### `copilot-debugger.entryTimeoutSeconds`
Description                                                                                                                                                                                        : Timeout in seconds waiting for initial entry stop after launching (before first user breakpoint). Supports long startup/build times; must be &gt; 0.  
Type     : `integer`  
Default        : `60`  

#### `copilot-debugger.captureMaxVariables`
Description                                                                                                                                                                                        : Maximum number of variables auto-captured when a breakpoint onHit=captureAndContinue omits variableFilter (capture-all mode).  
Type     : `integer`  
Default        : `40`  

#### `copilot-debugger.serverReadyEnabled`
Description                                                                                                                                                                                        : Enable serverReady automation (trigger + action). When disabled, provided serverReady payloads are ignored.  
Type     : `boolean`  
Default        : `true`  

#### `copilot-debugger.serverReadyDefaultActionType`
Description                                                                                                                                                                                        : Preferred serverReady action type surfaced in samples and quick insert command.  
Type     : `string`  
Default        : `"httpRequest"`  

#### `copilot-debugger.maxBuildErrors`
Description                                                                                                                                                                                        : Maximum number of build diagnostics (from problem matchers) to include in error messages when debug session fails to start.  
Type     : `integer`  
Default        : `5`  

#### `copilot-debugger.maxOutputLines`
Description                                                                                                                                                                                        : Maximum number of output lines (stderr/stdout) to buffer per debug session for runtime error reporting.  
Type     : `integer`  
Default        : `50`  

#### `copilot-debugger.maxOutputChars`
Description                                                                                                                                                                                        : Maximum number of characters returned by Copilot debugger tools (tool output is truncated with a suffix when exceeded).  
Type     : `integer`  
Default        : `8192`  

#### `copilot-debugger.consoleLogLevel`
Description                                                                                                                                                                                        : Controls how verbosely logs are mirrored to the developer console (Output panel always receives every log; this only gates console.* mirroring). Changes take effect immediately without reloading.  
Type     : `string`  
Default        : `"info"`  

#### `copilot-debugger.enableTraceLogging`
Description                                                                                                                                                                                        : Emit verbose Debug Adapter Protocol trace logs to the output channel for troubleshooting.  
Type     : `boolean`  
Default        : `false`  

<!-- configs-list -->

<!-- configs -->

| Key                                             | Description                                                                                                                                                                                         | Type      | Default         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------- |
| `copilot-debugger.defaultLaunchConfiguration`   | Name of the default launch configuration to use when starting the debugger                                                                                                                          | `string`  | `""`            |
| `copilot-debugger.entryTimeoutSeconds`          | Timeout in seconds waiting for initial entry stop after launching (before first user breakpoint). Supports long startup/build times; must be &gt; 0.                                                | `integer` | `60`            |
| `copilot-debugger.captureMaxVariables`          | Maximum number of variables auto-captured when a breakpoint onHit=captureAndContinue omits variableFilter (capture-all mode).                                                                       | `integer` | `40`            |
| `copilot-debugger.serverReadyEnabled`           | Enable serverReady automation (trigger + action). When disabled, provided serverReady payloads are ignored.                                                                                         | `boolean` | `true`          |
| `copilot-debugger.serverReadyDefaultActionType` | Preferred serverReady action type surfaced in samples and quick insert command.                                                                                                                     | `string`  | `"httpRequest"` |
| `copilot-debugger.maxBuildErrors`               | Maximum number of build diagnostics (from problem matchers) to include in error messages when debug session fails to start.                                                                         | `integer` | `5`             |
| `copilot-debugger.maxOutputLines`               | Maximum number of output lines (stderr/stdout) to buffer per debug session for runtime error reporting.                                                                                             | `integer` | `50`            |
| `copilot-debugger.maxOutputChars`               | Maximum number of characters returned by Copilot debugger tools (tool output is truncated with a suffix when exceeded).                                                                             | `integer` | `8192`          |
| `copilot-debugger.consoleLogLevel`              | Controls how verbosely logs are mirrored to the developer console (Output panel always receives every log; this only gates console.* mirroring). Changes take effect immediately without reloading. | `string`  | `"info"`        |
| `copilot-debugger.enableTraceLogging`           | Emit verbose Debug Adapter Protocol trace logs to the output channel for troubleshooting.                                                                                                           | `boolean` | `false`         |

<!-- configs -->

#### `copilot-debugger.defaultLaunchConfiguration`

Description                                                                                                                                                                                        : Name of the default launch configuration to use when starting the debugger
Type     : `string`
Default        : `""`

#### `copilot-debugger.entryTimeoutSeconds`

Description                                                                                                                                                                                        : Timeout in seconds waiting for initial entry stop after launching (before first user breakpoint). Supports long startup/build times; must be &gt; 0.
Type     : `integer`
Default        : `60`

#### `copilot-debugger.captureMaxVariables`

Description                                                                                                                                                                                        : Maximum number of variables auto-captured when a breakpoint onHit=captureAndContinue omits variableFilter (capture-all mode).
Type     : `integer`
Default        : `40`

#### `copilot-debugger.serverReadyEnabled`

Description                                                                                                                                                                                        : Enable serverReady automation (trigger + action). When disabled, provided serverReady payloads are ignored.
Type     : `boolean`
Default        : `true`

#### `copilot-debugger.serverReadyDefaultActionType`

Description                                                                                                                                                                                        : Preferred serverReady action type surfaced in samples and quick insert command.
Type     : `string`
Default        : `"httpRequest"`

#### `copilot-debugger.maxBuildErrors`

Description                                                                                                                                                                                        : Maximum number of build diagnostics (from problem matchers) to include in error messages when debug session fails to start.
Type     : `integer`
Default        : `5`

#### `copilot-debugger.maxOutputLines`

Description                                                                                                                                                                                        : Maximum number of output lines (stderr/stdout) to buffer per debug session for runtime error reporting.
Type     : `integer`
Default        : `50`

#### `copilot-debugger.maxOutputChars`

Description                                                                                                                                                                                        : Maximum number of characters returned by Copilot debugger tools (tool output is truncated with a suffix when exceeded).
Type     : `integer`
Default        : `8192`

#### `copilot-debugger.consoleLogLevel`

Description                                                                                                                                                                                        : Controls how verbosely logs are mirrored to the developer console (Output panel always receives every log; this only gates console.* mirroring). Changes take effect immediately without reloading.
Type     : `string`
Default        : `"info"`

#### `copilot-debugger.enableTraceLogging`

Description                                                                                                                                                                                        : Emit verbose Debug Adapter Protocol trace logs to the output channel for troubleshooting.
Type     : `boolean`
Default        : `false`

<!-- configs-list -->

#### Keeping the tables fresh automatically

The repo already ships with a workspace-level Run on Save configuration (see `.vscode/settings.json`) that fires `npm run update` any time `package.json` is saved. Just install the [Run on Save](https://marketplace.visualstudio.com/items?itemName=emeraldwalk.RunOnSave) extension when VS Code recommends it and the tables will stay in sync automatically.

> **Important (updated):** `startDebugSessionWithBreakpoints` requires at least one breakpoint. `variableFilter` is **only required** when you want a _subset_ of variables for a `capture` action. If you set `action: "capture"` and omit `variableFilter`, the tool auto-captures the first `captureMaxVariables` locals (case‑sensitive exact names) to reduce friction. For `break` or `stopDebugging` actions, omit `variableFilter` for a pure pause without variable output.

### Entry Timeout Diagnostics

When the debugger fails to pause before `copilot-debugger.entryTimeoutSeconds` elapses, the tool:

- Lists every new debug session (name, id, request) and whether it was forcibly stopped after diagnostics were captured
- Produces a state-machine style analysis covering `serverReadyAction` (pattern hits, capture groups, resolved `uriFormat`, and the action that should launch your browser), Copilot `serverReady` triggers, and the missing entry stop
- Appends truncated Debug Console + terminal output so you can confirm whether the expected "listening on..." line actually appeared
- Reminds you to verify those readiness signals before simply bumping the timeout

In other words, the timeout is actionable guidance rather than a suggestion to "try again with a larger number".

Example settings snippet:

### Server Readiness Automation (Unified `trigger` + `action`)

You may supply a `serverReady` object when starting the debugger to run an automated action (shell command, HTTP request, or VS Code command) once the target is "ready".

> **Important (don’t use `curl` with breakpoints):** If any breakpoint `onHit` is `break`, **do not** use `serverReady.action.type = "shellCommand"` with `curl`/`wget`/etc to call an endpoint that can hit that breakpoint. The request will often **hang** because the debuggee is paused and cannot finish responding.
>
> Prefer `serverReady.action.type = "httpRequest"` when you intend to **trigger a breakpoint** and capture state.

Structure (legacy union still accepted; new flat shape preferred):

```ts
// New flat schema (with discriminator) recommended – mirrors package.json tool schema
interface ServerReadyFlat {
  trigger?: { path?: string, line?: number, pattern?: string }
  action:
    | { type: "shellCommand", shellCommand: string }
    | {
      type: "httpRequest"
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }
    | { type: "vscodeCommand", command: string, args?: unknown[] }
}
// Legacy (still supported for backward compatibility)
interface ServerReadyLegacy {
  trigger?: { path?: string, line?: number, pattern?: string }
  action:
    | { shellCommand: string }
    | {
      httpRequest: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
      }
    }
    | { vscodeCommand: { command: string, args?: unknown[] } }
}
```

````

Modes (decided by `trigger`):

1. Breakpoint trigger – provide `trigger.path` + `trigger.line`. When that source breakpoint is hit (whether first or after entry) the action executes, then the session automatically continues to the first user breakpoint.
2. Pattern trigger – provide `trigger.pattern` (regex). A VS Code `serverReadyAction` URI is injected; built-in output detectors (debug console / task terminal) fire it when the pattern appears. Action executes asynchronously (fire‑and‑forget) without blocking normal breakpoint flow.
3. Immediate attach – omit `trigger` entirely for `request: "attach"` configurations (e.g., Azure Functions). The action runs immediately after attach since output may have scrolled before the adapter connected.

Actions:

- `shellCommand` – Runs in a new terminal named `serverReady-<phase>` (phase is `entry`, `late`, or `immediate`).
- `httpRequest` – Issues a fetch; dispatched fire‑and‑forget so a slow service cannot block debugger continuation.
- `vscodeCommand` – Invokes a VS Code command (e.g. telemetry-free internal toggles or extension commands) with optional `args`.

**Blocking behavior:**

- `shellCommand` runs in a terminal and can block forever if it launches an HTTP client (like `curl`) while your debug target is paused at a `break` breakpoint.
- `httpRequest` is executed by the tool (with timeout handling) and is the recommended way to trigger a request that is expected to hit a breakpoint.

**Recommended patterns:**

- **To hit a breakpoint (and capture state):** use `serverReady.action.type = "httpRequest"`.
- **To run a smoke command after you’ve resumed:** use `shellCommand` **after** you resume (e.g., via a separate task/command), not as `serverReady`.

**Common failure mode:** configuring `serverReady` with `curl http://localhost/...` while also setting a `break` breakpoint on the request handler causes the `curl` command to hang and the debug session to appear stuck.

Examples:

```jsonc
// Pattern-based readiness executing an HTTP health probe
{
  "serverReady": {
    "trigger": { "pattern": "listening on .*:3000" },
    "action": { "type": "httpRequest", "url": "http://localhost:3000/health" }
  },
}
````

```jsonc
// Breakpoint-triggered shell command (use for non-HTTP actions)
{
  "serverReady": {
    "trigger": { "path": "src/server.ts", "line": 27 },
    "action": {
      "type": "shellCommand",
      "shellCommand": "echo serverReady action executed"
    }
  }
}
```

```jsonc
// Immediate attach (Azure Functions) – no trigger; action fires right after attach
{
  "serverReady": {
    "action": {
      "type": "httpRequest",
      "url": "http://localhost:7071/api/status"
    }
  }
}
```

```jsonc
// VS Code command action (e.g., close panel after readiness)
{
  "serverReady": {
    "trigger": { "path": "src/server.ts", "line": 10 },
    "action": {
      "type": "vscodeCommand",
      "command": "workbench.action.closePanel"
    }
  }
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
  "copilot-debugger.entryTimeoutSeconds": 120
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

````text
Start debug with configurationName "Run test.js" and capture action at test-workspace/b/test.js line 9 filtering i and log message "i={i}".

Auto-capture example (omit variableFilter – first N locals collected):

```text
Start debug with configurationName "Run test.js" and capture action at test-workspace/b/test.js line 9 with log message "i={i}" (omit variableFilter for automatic capture).
````

### Quick Start: Auto Warm Swagger + Capture (Port Token Replacement)

```jsonc
{
  "workspaceFolder": "/abs/path/project",
  "configurationName": "Run test.js",
  "breakpointConfig": {
    "breakpoints": [
      {
        "path": "src/server.ts",
        "line": 27,
        "action": "capture",
        "logMessage": "port={PORT}",
        "variableFilter": ["PORT"]
      }
    ]
  },
  "serverReady": {
    "trigger": { "pattern": "listening on .*:(\\d+)" },
    "action": {
      "type": "httpRequest",
      "url": "http://localhost:%PORT%/swagger"
    }
  }
}
```

The `%PORT%` token is substituted from the captured log message interpolation / variable value (pattern group extraction occurs in the debug adapter output before the action executes). If the token cannot be resolved the raw string is used. This encourages discovery of port token replacement without extra explanation.

````

> Tip: Variable filters are exact name matches (case-sensitive). Provide them only when you want a narrowed subset; omit for capture-all (bounded by `captureMaxVariables`) or for simple pause actions.

## 🧪 Example Copilot Prompts

```text
Start the debugger with a breakpoint at src/app.ts line 42 filtering variables user,session.
````

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

Because variable filters are mandatory and the prompt is minified before returning, typical tool output is only a few thousand characters instead of tens of thousands.

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

1. **Test**: `npm test`
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
