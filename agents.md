# AGENTS.md

## Development Commands

- **Build**: `npm run compile` - Compiles TypeScript to JavaScript in `out/` directory
- **Watch mode**: `npm run watch` - Compiles TypeScript in watch mode for development (long-running)
- **Lint**: `npm run lint` - Runs ESLint on TypeScript files in `src/`
- **Test**: `npm run test` - Runs tests using vscode-test
- **Playwright demo test**: `npm run demo:pw` - Runs the Playwright demo spec (records videos/artifacts under `test-results/**`)
- **Prepare for publish**: `npm run vscode:prepublish` - Runs compile before publishing
- **Formatting**: Formatting is handled by ESLint autofix (`npm run lint -- --fix` or just `npm run lint` if configured).

  - If ESLint reports something is "potentially fixable with the `--fix` option", run the autofix command (e.g. `npm run lint -- --fix`) instead of hand-editing.

## CI: Single-file demo video artifact

- The repo includes `external/toolkit` (git submodule) to consume the `dkattan/toolkit` fork of `@actions/artifact`, which supports uploading/downloading a single file without zipping.
- The workflow `playwright-demo` uses `scripts/upload-single-file-artifact.cjs` to upload `docs/pw-videos/demo.mp4` as an unzipped, single-file artifact.

## User-Facing Commands Added

- `copilotBreakpointDebugger.startAndWaitManual` now uses existing workspace breakpoints. It will:

  1. Prompt only for a launch configuration and a comma-separated variable list (no file path / line prompts).
  2. Derive a breakpoint configuration from all existing breakpoints and invoke the core start logic with `useExistingBreakpoints: true`.
  3. Restore original breakpoints after session completes (unchanged core behavior).

- `copilotBreakpointDebugger.setDefaultLaunchConfiguration` lets users set the workspace-scoped `copilot-debugger.defaultLaunchConfiguration` setting via a quick pick of launch configurations found in `.vscode/launch.json`.

## New Language Model Tool

- `triggerBreakpoint` triggers an action against an **existing** debug session and waits for the next stop.

  - Requires `sessionId` (use `listDebugSessions` to discover ids).
  - Supports `action` types: `httpRequest` (fire-and-forget), `shellCommand`, `vscodeCommand`.
  - Optionally supports `breakpointConfig.breakpoints` (same snippet-based contract as start/resume).
  - Default mode is `singleShot` (terminates the session before returning). Use `mode=inspect` to keep the session paused for follow-up tool calls.

### New Internal Parameter

`startDebuggingAndWaitForStop` accepts an optional `useExistingBreakpoints?: boolean` (default `false`). Currently informational—manual command constructs the full `breakpointConfig` from existing breakpoints—but this flag documents intent for future evolution (e.g., auto-harvesting breakpoints internally when config omitted).

## Architecture

This is a VS Code extension that integrates with GitHub Copilot to provide debugging capabilities through language model tools.

### Core Components

- **Extension entry point**: `src/extension.ts` - Main activation logic and tool registration
- **Language Model Tools**: Classes implementing VS Code's `LanguageModelTool` interface
  - `StartDebuggerTool` - Thin wrapper; delegates validation & launch resolution to `startDebuggingAndWaitForStop`
  - `GetVariablesTool` - Retrieves all variables from active debug sessions using DAP
  - `ExpandVariableTool` - Expands specific variables to show detailed contents and immediate children
- **Tool registration**: Registers tools with VS Code's language model system via `vscode.lm.registerTool()`

### Key Architecture Patterns

- The extension uses VS Code's Language Model Tools API to expose debugging functionality to Copilot
- Tool definitions in `package.json` under `languageModelTools` specify the interface for Copilot
- Each tool class implements both `invoke()` and optional `prepareInvocation()` methods
- Line numbers are converted from 1-based (user input) to 0-based (VS Code internal)
- Async operations use `async/await` pattern with proper error handling
- Tools validate workspace state before performing operations. Post-refactor: core validation (workspaceFolder, breakpoint structure, auto-select or resolve launch configuration, timeout derivation) now lives centrally inside `startDebuggingAndWaitForStop` for consistency.

## How to run tests in this repo (preferred)

- Tests are run automatically in a commit hook. To run them manually, use `npm test`.

### File Structure

- `src/extension.ts` - Main extension logic, activation, and tool registration only
- `src/startDebuggerTool.ts` - StartDebuggerTool class and interface
- `src/debugUtils.ts` - Shared DAP interfaces, types, and DAPHelpers utility class
- `src/getVariablesTool.ts` - GetVariablesTool class and interface
- `src/expandVariableTool.ts` - ExpandVariableTool class and interface
- `package.json` - Extension manifest with tool definitions and VS Code configuration
- `out/` - Compiled JavaScript output (generated)
- TypeScript configuration uses Node16 modules targeting ES2022
- Uses camelCase naming convention for TypeScript files

## Extension Configuration

The extension contributes language model tools that allow Copilot to interact with VS Code's debugging system. Tools are automatically available when the extension is active.

### Breakpoint Features

All breakpoint-related tools (`startDebugSessionWithBreakpoints` and `resumeDebugSession`) support advanced breakpoint configurations:

- **Conditional Breakpoints**: Set `condition` to specify an expression that must evaluate to true for the breakpoint to trigger
  - Example: `condition: "$i -ge 3"` (PowerShell) or `condition: "x > 5"` (JavaScript)
  - The breakpoint will only pause execution when the condition is met
- **Hit Count Breakpoints**: Set `hitCount` (integer) to pause exactly on that occurrence (e.g., `hitCount: 3` pauses on the 3rd hit). Useful for issues that appear only after several iterations.
- **Logpoints**: Set `logMessage` to log a message without stopping execution
  - Example: `logMessage: "Loop iteration: {$i}"` (PowerShell) or `logMessage: "Value is {x}"` (JavaScript)
  - Use curly braces for variable interpolation
  - Logpoints don't pause execution, making them useful for tracing without interrupting the program flow

All three properties are optional and can be combined with basic breakpoints that only specify `path` and `line`.

### Workspace Folder Semantics

`startDebugSessionWithBreakpoints` requires a `workspaceFolder` parameter that must be an absolute path exactly matching one of the open workspace folder roots (`workspace.workspaceFolders[].uri.fsPath`).

Simplifications implemented:

- Removed prior fallback to the extension installation directory.
- Removed parent/child heuristic; no automatic promotion of related folders.
- Relative paths are rejected (fail fast) instead of being implicitly resolved.
- If the supplied path does not match an open folder, an error lists all currently open folders for correction.

Rationale: This strict model eliminates ambiguity, ensures deterministic breakpoint file resolution, and prevents accidental debugging of unintended projects. Breakpoints now always resolve relative to the explicitly chosen, open workspace folder only.

If future multi-root heuristics are desired they must be reintroduced explicitly with clear logging; hidden fallbacks are intentionally avoided per **NO FALLBACK CODE** guideline.

#### Launch Configuration Auto-Selection

If neither a `configurationName` parameter nor the `copilot-debugger.defaultLaunchConfiguration` setting is provided, and exactly one launch configuration exists in the target workspace folder's `launch.json`, that configuration is auto-selected. An INFO log entry records the auto-selection. This never triggers when there are zero or multiple configurations; in those cases explicit selection or setting is required.

### Startup / Entry Timeout

Large projects may take significant time (cold build, dependency install, container startup) before the debugger reaches the initial _entry_ stop. Configure `copilot-debugger.entryTimeoutSeconds` to control how long the Start Debugger tool waits for that entry stop before proceeding to user breakpoints. If the entry stop is not observed within the window, a timeout error is surfaced and the session is cleaned up.

Example workspace setting:

```jsonc
{
  "copilot-debugger.entryTimeoutSeconds": 180
}
```

You can simulate startup delay via a `preLaunchTask` (e.g. `sleep-build-delay`) in `launch.json`. The test suite uses this with `Run timeoutTest.js` to validate timeout behavior.

## Implementation Notes

- When adding new tools, define the interface in `package.json` under `languageModelTools`
- Create a separate camelCase `.ts` file for each tool class (e.g., `newToolName.ts`)
- Each tool file should export both the parameters interface and the tool class
- Implement the tool class with `LanguageModelTool<ParametersInterface>` interface
- Import and register the tool in `registerTools()` function using `vscode.lm.registerTool()`
- Use proper TypeScript typing and handle optional parameters carefully
- VS Code's `startDebugging()` requires 2+ arguments - use conditional logic for optional parameters
- Always validate workspace folder exists before debugging operations
- **NO FALLBACK CODE**: Never implement fallback code or fallback logic. Fallback code hides underlying issues and makes debugging harder. If something fails, it should fail explicitly with a clear error message.

### Runtime Diagnostics Capture

- `startDebuggingAndWaitForStop` streams integrated-terminal output by subscribing to `window.onDidStartTerminalShellExecution` / `window.onDidEndTerminalShellExecution` and piping each `TerminalShellExecution.read()` stream into the runtime diagnostics buffer. This keeps crash context available even when adapters bypass the Debug Console (e.g., configs with `console: "integratedTerminal"`).
- Runtime error messages automatically append exit codes, DAP stderr, and/or terminal lines (capped by `copilot-debugger.maxOutputLines`), keeping messaging concise while surfacing crash context for Copilot tools.

### DAP Trace Logging Output Policy

- DAP trace logging is designed to be **human-readable** even when enabled by default in tests.
- High-volume messages are summarized (e.g., `variables`, `stackTrace`, `initialize`) and very noisy events like `<node_internals>` `loadedSource` are rate-limited with periodic “suppressed N events” summaries.
- Direction/kind tags are preserved (e.g., `[DAP][REQ] editor → adapter`, `[DAP][RESP] adapter → editor`).

## External Dependencies

### debug-tracker-vscode Integration

- **Dual dependency requirement**: Requires both NPM package and VS Code extension
- **NPM package**: `debug-tracker-vscode` - Provides TypeScript types and API client
- **VS Code extension**: `mcu-debug.debug-tracker-vscode` - Provides the actual debug tracking service
- **API access**: Use `DebugTracker.getTrackerExtension('extension-name')` to get tracker instance
- **Event handlers**: Must be async functions returning `Promise<void>`
- **Resource cleanup**: Always unsubscribe from debug events to prevent memory leaks
- **State handling**: Check current debug status immediately with `getSessionStatus()` before waiting
- **Subscription pattern**: Use `wantCurrentStatus: true` to get immediate status when subscribing

### Debug Adapter Protocol Monitoring

- **Status monitoring**: Track `DebugSessionStatus` changes (Running → Stopped = breakpoint hit)
- **Event filtering**: Can monitor specific debug adapters or use `'*'` for all
- **Session validation**: Always verify active debug session exists before monitoring
- **Timeout handling**: Implement timeout mechanisms to prevent infinite waiting
- **Error scenarios**: Handle debug session termination, extension unavailability, and API errors

### Debug Adapter Protocol Variable Access

- **Four-step DAP flow**: threads → stackTrace → scopes → variables requests
- **Request chain**: Each step provides context for the next (threadId → frameId → variablesReference)
- **Single-level expansion**: Variables with `variablesReference > 0` can be expanded one level to avoid circular references
- **Scope searching**: Must search all scopes (local, closure, global) to find variables
- **Session state**: Debug session must be stopped/paused to access variable values
- **Error handling**: Each DAP request can fail independently and requires proper error handling

### Shared DAP Architecture

- **Centralized utilities**: `src/debugUtils.ts` contains all shared DAP interfaces and helper functions
- **DAPHelpers utility class**: Centralized DAP operations shared between GetVariablesTool and ExpandVariableTool
- **Common interfaces**: Shared TypeScript interfaces (Thread, StackFrame, Scope, Variable, VariableInfo, etc.) exported from debugUtils
- **Code reuse**: Both variable tools import and use the same methods for session validation, context retrieval, and variable resolution
- **Consistent data structures**: All tools return structured JSON using the same VariableInfo format from debugUtils
- **Single responsibility**: Each helper method handles one specific DAP operation for better maintainability
- **Clean separation**: Tool-specific logic stays in tool files, shared logic centralized in debugUtils

## Code Organization

- Keep `src/extension.ts` minimal - only activation, deactivation, and registration logic
- Separate each tool class into its own file for better maintainability
- Use flat file structure in `src/` directory (no subdirectories for tools)
- Export both interface and class from each tool file
- Follow consistent patterns across all tool implementations

## Advanced Patterns

### Promise-based Tool Implementation

- For tools that wait for events, return a Promise from `invoke()`
- Use proper Promise constructor with resolve/reject for event-driven operations
- Implement cleanup logic in both success and error paths
- Handle race conditions between timeouts and actual events

### Event-driven Debug Monitoring

- Always check current state before subscribing to avoid missing already-occurred events
- Use subscription IDs for proper cleanup to prevent memory leaks
- Handle multiple possible outcomes (success, timeout, session termination)
- Provide meaningful feedback messages for all scenarios

### Error Handling Best Practices

- Gracefully handle external dependency unavailability (debug tracker extension)
- Provide clear installation instructions in error messages
- Use try-catch blocks around async operations with proper cleanup
- Distinguish between recoverable and non-recoverable errors

### IMPORTANT: NO FALLBACK LOGIC (GLOBAL PRINCIPLE)

Fallback logic (silent retries, alternate code paths, regex backups, hidden defaults) MUST NOT be introduced. If an operation cannot proceed (e.g., missing workspace folder, malformed markdown, absent launch configuration), fail fast with a precise, actionable error.

Reasons:

- Transparency – Hidden fallbacks mask real configuration or data issues and degrade model guidance quality.
- Determinism – Explicit failures maintain predictable tool behavior for language model planners.
- Debuggability – Surfacing the first cause preserves stack/context for rapid triage.
- Scope Control – Prevents accidental expansion of supported inputs (e.g., silently accepting partial paths or malformed headings).

Avoid:

- Swallowing exceptions and returning partial success.
- Auto-inferring missing fields (e.g., guessing a launch config from file names).
- Regex heuristics when structural parse fails (instruct user to fix source instead).
- Silent conversion of relative to absolute paths.

Allowed recovery only when the user explicitly requests a transformation; otherwise throw with a clear remediation hint.

If behavior changes, update tests + docs and keep error messaging crisp: one sentence problem statement + specific remediation steps.

### DAP Variable Access Implementation

- **Request chaining**: Use `session.customRequest()` for all DAP communication
- **Context building**: Each request builds context for the next (threads → frames → scopes → variables)
- **Default selection**: Use first available thread and topmost stack frame for simplicity
- **Recursive search**: Implement recursive traversal for nested object properties
- **Scope iteration**: Search all available scopes until variable is found
- **Type safety**: Define TypeScript interfaces for all DAP response structures

## Workflow Guidance

- **Always update AGENTS.md when you complete a feature**

### Removing Deprecated or Legacy Files

The automated patch mechanism used by tooling in this repo does not reliably delete files. When you need to remove a file (e.g. retiring a legacy test harness), do it explicitly with the shell and then commit the change.

Recommended steps:

1. Remove the file: `rm path/to/file.ts`
2. Stage the deletion: `git add -u` (or `git add path/to/file.ts`)
3. Commit: `git commit -m "chore: remove legacy <file>"`
4. Re-run `npm test` to ensure no references remain.

Never leave half-deleted stubs unless intentionally deprecating; prefer full removal once confirmed unused. Document the removal rationale briefly in the commit message.

### Dual VS Code Setup (Stable for Tests, Insiders for Dev)

Running extension tests via the CLI requires that no other instance of VS Code (Stable) is running. To avoid conflicts and keep a fast edit/debug loop:

| Task                                  | Edition                   |
| ------------------------------------- | ------------------------- |
| Author & debug extension code         | VS Code Insiders          |
| Execute `npm test` (electron harness) | VS Code Stable (headless) |

The test CLI (`@vscode/test-cli` via `npm test`) downloads a Stable build into `.vscode-test/`. If only Insiders is open, Stable can launch cleanly. If you see the error about "Running extension tests from the command line is currently only supported if no other instance of Code is running.", close all Stable windows.

#### Steps

1. Install VS Code Stable and VS Code Insiders.
1. Open the repo in **Insiders**.
1. Run tests from a terminal: `npm test`.

### Running Individual / Filtered Tests

Use the VS Code test harness so the extension host and activation events run correctly. You can filter tests via `--grep` passthrough or an environment variable.

Run only tests whose names match a pattern (passthrough after `--`):

```bash
npm test -- --grep "timeout behavior"
```

## Release & Versioning (LLM-Focused)

This project is primarily consumed by language models, so release metadata emphasizes machine-readable consistency over human upgrade narratives.

### Standard Release Flow

1. Bump version in `package.json`.
2. Adjust manifest schemas as needed
3. Update `CHANGELOG.md` with a new section `[x.y.z] - YYYY-MM-DD`.
4. Ensure markdown lint passes: blank lines around headings/lists; fenced code blocks include a language (e.g., `text`).
5. Run: `npm run format && npm test` (tests must all pass).
6. Commit: `git commit -m "chore(release): x.y.z <summary>"`.
7. Tag: `git tag -a vx.y.z -m "Release vx.y.z: <summary>"`.
8. Push: `git push origin main --follow-tags`.
9. Publish release: `gh release create vx.y.z --title "vx.y.z" --notes-file RELEASE_NOTES_x.y.z.md`.

### v0.0.6 Changes (Historical Reference)

- Introduced exact per-breakpoint variable selection (top-level filtering removed).
- Added optional per-breakpoint `action` (e.g., `captureAndStopDebugging`).
- Added `logger.ts` for structured tool logging.
- Cleaned CHANGELOG formatting (headings/lists/code fences compliance).
- Release notes tailored for LLM consumption (no end-user upgrade guidance).

### Variable Filtering Semantics

- Previous behavior: top-level variable filtering aggregated regex fragments.
- Current behavior: each breakpoint declares a required `variable` string (case-sensitive exact name).
- Capture-all mode: set `variable` to `"*"` to auto-capture (up to `copilot-debugger.captureMaxVariables`).
- Matching is simple equality; no regex evaluation.
- Schema is defined in `package.json`; implementation lives under `src/` (notably `src/session.ts`, `src/BreakpointDefinition.ts`).

### Git Hooks & Quality Gates

- Pre-commit hook runs formatting, linting, compilation, and test suite; commits abort on failure.
- Keep changes small to maintain rapid iteration; documentation updates do not skip tests.

### Guidance for Future Automated Updates

- Prefer additive schema changes; avoid breaking tool contract unless strictly necessary.
- When changing tool parameters: update manifest schema, implementation, tests, and reflect in CHANGELOG.
- Remove human-centric prose not needed for model reasoning to keep prompt context lean.

### Release Notes Files

- Temporary `RELEASE_NOTES_x.y.z.md` may be created for `gh release create`; not required to commit unless historically valuable.

### Checklist (Copy/Paste)

```text
1. Update version & schemas
2. Update CHANGELOG
3. Format & test (must pass)
4. Commit & tag
5. gh release create
6. Verify release (gh release view)
```
