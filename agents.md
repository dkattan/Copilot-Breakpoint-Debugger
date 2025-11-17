# AGENTS.md

## Development Commands

- **Build**: `npm run compile` - Compiles TypeScript to JavaScript in `out/` directory
- **Watch mode**: `npm run watch` - Compiles TypeScript in watch mode for development
- **Lint**: `npm run lint` - Runs ESLint on TypeScript files in `src/`
- **Format**: `npm run format` - Formats all files with Prettier
- **Format check**: `npm run format:check` - Checks if files are properly formatted
- **Test**: `npm run test` - Runs tests using vscode-test
- **Prepare for publish**: `npm run vscode:prepublish` - Runs compile before publishing
- **Important**: Always run `npm run format` before `npm run lint` to avoid formatting conflicts

## Architecture

This is a VS Code extension that integrates with GitHub Copilot to provide debugging capabilities through language model tools.

### Core Components

- **Extension entry point**: `src/extension.ts` - Main activation logic and tool registration
- **Language Model Tools**: Classes implementing VS Code's `LanguageModelTool` interface
  - `StartDebuggerTool` - Starts debugging sessions with optional configuration
  - `WaitForBreakpointTool` - Waits for breakpoint hits using Debug Adapter Protocol monitoring
  - `GetVariablesTool` - Retrieves all variables from active debug sessions using DAP
  - `ExpandVariableTool` - Expands specific variables to show detailed contents and immediate children
- **Tool registration**: Registers tools with VS Code's language model system via `vscode.lm.registerTool()`

### Key Architecture Patterns

- The extension uses VS Code's Language Model Tools API to expose debugging functionality to Copilot
- Tool definitions in `package.json` under `languageModelTools` specify the interface for Copilot
- Each tool class implements both `invoke()` and optional `prepareInvocation()` methods
- Line numbers are converted from 1-based (user input) to 0-based (VS Code internal)
- Async operations use `async/await` pattern with proper error handling
- Tools validate workspace state before performing operations

### File Structure

- `src/extension.ts` - Main extension logic, activation, and tool registration only
- `src/startDebuggerTool.ts` - StartDebuggerTool class and interface
- `src/waitForBreakpointTool.ts` - WaitForBreakpointTool class and interface (requires debug-tracker-vscode)
- `src/debugUtils.ts` - Shared DAP interfaces, types, and DAPHelpers utility class
- `src/getVariablesTool.ts` - GetVariablesTool class and interface
- `src/expandVariableTool.ts` - ExpandVariableTool class and interface
- `package.json` - Extension manifest with tool definitions and VS Code configuration
- `out/` - Compiled JavaScript output (generated)
- TypeScript configuration uses Node16 modules targeting ES2022
- Uses camelCase naming convention for TypeScript files

## Extension Configuration

The extension contributes language model tools that allow Copilot to interact with VS Code's debugging system:

- **`set_breakpoint`** - Sets breakpoints by specifying file path and line number
- **`start_debugger`** - Starts debugging sessions with optional configuration name
- **`wait_for_breakpoint`** - Waits for the debugger to hit a breakpoint or stop execution
- **`get_variables`** - Retrieves all variables from the current debug session when stopped
- **`expand_variable`** - Expands a specific variable to show its detailed contents and immediate child properties

Tools are automatically available to Copilot when the extension is active.

### Breakpoint Features

All breakpoint-related tools (`start_debugger` and `resume_debug_session`) support advanced breakpoint configurations:

- **Conditional Breakpoints**: Set `condition` to specify an expression that must evaluate to true for the breakpoint to trigger
  - Example: `condition: "$i -ge 3"` (PowerShell) or `condition: "x > 5"` (JavaScript)
  - The breakpoint will only pause execution when the condition is met
- **Hit Count Breakpoints**: Set `hitCount` (integer) to pause exactly on that occurrence (e.g., `hitCount: 3` pauses on the 3rd hit). Useful for issues that appear only after several iterations.
- **Logpoints**: Set `logMessage` to log a message without stopping execution
  - Example: `logMessage: "Loop iteration: {$i}"` (PowerShell) or `logMessage: "Value is {x}"` (JavaScript)
  - Use curly braces for variable interpolation
  - Logpoints don't pause execution, making them useful for tracing without interrupting the program flow

All three properties are optional and can be combined with basic breakpoints that only specify `path` and `line`.

## Prerequisites

This extension requires the **debug-tracker-vscode** extension to be installed for the `wait_for_breakpoint` tool to function:

1. **Automatic Installation**: The extension will attempt to auto-install if not present
2. **Manual Installation**: Install from VS Code marketplace: `mcu-debug.debug-tracker-vscode`
3. **Command**: Use Quick Open (`Ctrl+P`) and search for "debug-tracker-vscode"

The debug tracker extension provides API services for monitoring debug sessions and is required for breakpoint waiting functionality.

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

- For tools that wait for events (like `wait_for_breakpoint`), return a Promise from `invoke()`
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

### DAP Variable Access Implementation

- **Request chaining**: Use `session.customRequest()` for all DAP communication
- **Context building**: Each request builds context for the next (threads → frames → scopes → variables)
- **Default selection**: Use first available thread and topmost stack frame for simplicity
- **Recursive search**: Implement recursive traversal for nested object properties
- **Scope iteration**: Search all available scopes until variable is found
- **Type safety**: Define TypeScript interfaces for all DAP response structures

## Workflow Guidance

- **Always update CLAUDE.md when you complete a feature**

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

## Release & Versioning (LLM-Focused)

This project is primarily consumed by language models, so release metadata emphasizes machine-readable consistency over human upgrade narratives.

### Standard Release Flow

1. Bump version in `package.json`.
2. Adjust manifest schemas as needed (e.g., per-breakpoint `variableFilter`).
3. Update `CHANGELOG.md` with a new section `[x.y.z] - YYYY-MM-DD`.
4. Ensure markdown lint passes: blank lines around headings/lists; fenced code blocks include a language (e.g., `text`).
5. Run: `npm run format && npm test` (tests must all pass).
6. Commit: `git commit -m "chore(release): x.y.z <summary>"`.
7. Tag: `git tag -a vx.y.z -m "Release vx.y.z: <summary>"`.
8. Push: `git push origin main --follow-tags`.
9. Publish release: `gh release create vx.y.z --title "vx.y.z" --notes-file RELEASE_NOTES_x.y.z.md`.

### v0.0.6 Changes (Historical Reference)

- Introduced exact per-breakpoint `variableFilter` (top-level filter removed).
- Added optional per-breakpoint `action` (e.g., `stopDebugging`).
- Added `logger.ts` for structured tool logging.
- Cleaned CHANGELOG formatting (headings/lists/code fences compliance).
- Release notes tailored for LLM consumption (no end-user upgrade guidance).

### Variable Filtering Semantics

- Previous behavior: top-level `variableFilter` aggregated regex fragments.
- Current behavior: each breakpoint declares a required `variableFilter` array of exact (case-sensitive) names.
- Matching is simple set membership; no regex evaluation.
- Schema updated in `package.json` and tool logic updated in `src/startDebuggerTool.ts`.

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
