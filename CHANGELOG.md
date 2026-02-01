## [0.0.60] - 2026-02-01

## Release Notes - Version 0.0.60

### Summary

This release introduces major improvements to debug session management and autonomous debugger control. The extension can now automatically start debug sessions, intelligently handle multiple concurrent sessions, and provide richer status information about active debugging contexts. These enhancements significantly improve the experience for AI-assisted debugging workflows.

---

### New Features

#### Autonomous Debug Session Management
- **Auto-start capability**: `triggerBreakpoint` can now create and launch debug sessions automatically without requiring manual pre-configuration
- **Smart session selection**: When no session ID is provided, the tool can intelligently select an existing session or create a new one based on workspace settings
- **Launch configuration support**: Specify which launch configuration to use via `configurationName` parameter, with automatic fallback to workspace defaults or sole configuration
- **Workspace folder targeting**: Target specific workspace folders when starting new debug sessions via `workspaceFolder` parameter

#### Multiple Debug Session Support
- **New configuration setting**: `copilot-debugger.supportsMultipleDebugSessions` controls whether workspaces allow concurrent debug sessions (default: `false`)
- **Flexible session policies**: New `copilot-debugger.existingSessionBehavior` setting with three strategies:
  - `"useExisting"` (default): Use existing session if available, error if multiple exist without explicit session ID
  - `"stopExisting"`: Automatically terminate existing sessions before starting a new one
  - `"ignoreAndCreateNew"`: Create new session alongside existing ones (requires `supportsMultipleDebugSessions: true`)
- **Per-call overrides**: Override global session behavior on individual tool calls via `existingSessionBehavior` parameter

#### Enhanced Debug Session Listing
- **Session status tracking**: Debug session list now includes current execution state (`"paused"`, `"running"`, or `"terminated"`)
- **Protocol guidance**: Each session includes `protocol` information showing allowed next actions based on current state
- **Hierarchical session view**: Parent-child session relationships are now tracked and displayed in tree structure
- **Dual output formats**: Returns both hierarchical tree view (`sessions`) and flat array (`flatSessions`) for flexibility

#### Build and Startup Integration
- **Task auto-start**: Launch watcher tasks before debugging via `watcherTaskLabel` parameter (e.g., `"dotnet watch run"`)
- **Startup readiness gates**: Set breakpoints that must be hit before proceeding with main debugging workflow via `startupBreakpointConfig`
- **Server ready triggers**: Enhanced `serverReadyTrigger` support for waiting until applications are fully initialized

---

### Improvements

- **Smarter configuration resolution**: Automatic single launch configuration detection eliminates need for explicit specification
- **Better error messages**: More specific guidance when configurations aren't found or workspace folders aren't open
- **Workspace validation**: Validates that workspace folders are absolute paths and actually open in VS Code
- **Enhanced protocol-driven navigation**: Session listings include context-aware suggestions for next steps based on debugger state
- **Comprehensive test coverage**: Added three new test suites covering session behavior, status listing, and breakpoint triggering

---

### Breaking Changes

#### API Changes (Backward Compatible)

**`triggerBreakpoint` tool signature**:
- `sessionId` parameter changed from required to optional
- Existing code passing `sessionId` continues to work unchanged
- New optional parameters only activate when `sessionId` is omitted

**`listDebugSessionsForTool()` output format**:
- Returns both `sessions` (tree structure) and `flatSessions` (flat array) instead of just `sessions` array
- Consumers expecting flat array should use `flatSessions` field
- Tree structure provides hierarchical parent-child relationships

---

### Configuration

Two new workspace settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `copilot-debugger.supportsMultipleDebugSessions` | Whether this workspace supports running multiple simultaneous debug sessions | `false` |
| `copilot-debugger.existingSessionBehavior` | Behavior when starting a session while others exist: `"useExisting"`, `"stopExisting"`, or `"ignoreAndCreateNew"` | `"useExisting"` |

---

### Technical Details

**Files Changed**:
- `src/session.ts`: +374 lines (core session management)
- `src/triggerBreakpointTool.ts`: +39 lines (tool integration)
- `src/common.ts`: +34 lines (shared types and state)
- `src/events.ts`: +39 lines (session state tracking)
- `src/config.ts`: +8 lines (configuration settings)
- `package.json`: +120 lines (tool schema updates)
- `README.md`: Updated configuration documentation

**New Test Files**:
- `src/test/existingSessionBehavior.test.ts`: Tests for session behavior policies
- `src/test/listDebugSessionsStatus.test.ts`: Tests for enhanced session listing
- `src/test/triggerBreakpoint.test.ts`: Tests for autonomous session startup

---

### Migration Guide

For most users, this release is fully backward compatible. If you have existing integrations:

1. **Tool consumers**: If parsing `listDebugSessions` output, use the new `flatSessions` field for flat array format
2. **Configuration**: Review new session behavior settings to optimize for your workflow
3. **Multi-session workspaces**: Set `supportsMultipleDebugSessions: true` if you regularly debug multiple processes

## [0.0.59] - 2026-01-27

Credit balance is too low

## [0.0.58] - 2026-01-27

Credit balance is too low

## [0.0.57] - 2026-01-27

Credit balance is too low

## [0.0.56] - 2026-01-26

Credit balance is too low

## [0.0.55] - 2026-01-26

Credit balance is too low

## [0.0.54] - 2026-01-24

## Version 0.0.54

### Summary

This release introduces stricter breakpoint requirements and implements automatic step-over behavior for capture actions to improve the reliability of variable inspection during debugging.

### Breaking Changes

**Mandatory `variable` field for all breakpoints**

- All breakpoints now **require** a `variable` field (previously `variableFilter` was optional)
- Use `variable: "variableName"` to focus on a single exact variable name (case-sensitive)
- Use `variable: "*"` to opt into capture-all mode (auto-captures up to `captureMaxVariables` locals)
- This change affects both `startDebugSessionWithBreakpoints` and `resumeDebugSession` tools

**Schema changes:**
- `variableFilter` (array) → `variable` (string)
- Matching is now simple string equality instead of list membership
- No regex evaluation

### New Features

**Automatic step-over for capture actions**

Capture actions (`captureAndContinue` and `captureAndStopDebugging`) now automatically perform a single step-over (F10 / DAP `next`) before capturing variables. This solves the common problem where breakpoints placed on assignment lines would capture pre-assignment values instead of the expected post-assignment values.

- Applied when `autoStepOver` is not explicitly set
- Can be disabled by setting `autoStepOver: false`
- Enhanced with explicit `autoStepOver: true` for before/after variable snapshots

### Improvements

- Updated all documentation, examples, and test fixtures to reflect the new `variable` field requirement
- Improved error messages to guide users toward the correct schema
- Enhanced configuration descriptions to clarify capture-all mode (`variable: "*"`)
- Updated VS Code quick-insert command to prompt for single variable name or `*`

### Documentation Updates

- README.md: Updated breakpoint examples and usage instructions
- agents.md: Revised variable filtering semantics documentation
- package.json: Updated tool descriptions and schema definitions for both Language Model Tools

### Technical Details

Modified files include:
- `src/BreakpointDefinition.ts`: Updated interface with new `variable` field
- `src/session.ts`: Implemented default step-over logic for capture actions
- `src/extension.ts`: Updated VS Code command prompts for new schema
- `src/stopInfoMarkdown.ts`: Updated variable display logic
- `src/resumeDebugSessionTool.ts`: Applied new schema to resume operations
- All test files updated to use new `variable` field instead of `variableFilter`

## [0.0.53] - 2026-01-23

## Version 0.0.53

### Summary

This release focuses on improving test stability and code organization for the Debug Adapter Protocol (DAP) integration tests and demo workflows. The changes refactor DAP helper utilities into a shared module, add comprehensive unit tests for serverReady functionality, and enhance the Playwright-based demo specification with better accessibility-based selectors and error diagnostics.

### Improvements

- **Code Organization**: Refactored DAP type definitions and helper functions into a new `startDebuggerToolTypes.ts` module, improving code reusability and separation of concerns (src/debugUtils.ts:1, src/startDebuggerToolTypes.ts:1)

- **Enhanced DAP Helpers**: Improved the `DAPHelpers` class with better timeout handling and more robust request management across debug sessions (src/debugUtils.ts:49-77)

- **Test Stability**: Enhanced Playwright demo test with accessibility-based element selection, better error diagnostics including visible element dumps, and more reliable UI interaction patterns (playwright/demo.spec.ts:17-87, playwright/demo.spec.ts:167-186)

- **Demo Configuration**: Added `demoRequest.json` configuration file to standardize demo parameters and enable sharing between unit tests and Playwright integration tests (demoRequest.json:1-24)

- **Test Coverage**: Added comprehensive unit tests for serverReady functionality covering breakpoint triggers, pattern matching, HTTP requests, shell commands, and the full demo scenario workflow (src/test/serverReady.test.ts:1-394)

- **Updated Demo Video**: Refreshed the demo video to reflect current functionality and stabilized test behaviors (docs/pw-videos/demo.mp4)

- **Test Infrastructure**: Updated vscode-test-playwright submodule and adjusted Playwright configuration for better test isolation (external/vscode-test-playwright, playwright.config.ts:1)

### Testing

- Added 4 new comprehensive integration tests for serverReady breakpoint scenarios
- Tests now validate breakpoint triggers, pattern matching, HTTP requests, and variable capture
- Improved test timeout handling for CI/CD environments (240 second timeout for complex debug sessions)
- Enhanced test server with marker comments for reliable line-based breakpoint targeting

### Developer Experience

- Better separation of type definitions makes the codebase easier to navigate
- Shared demo configuration enables consistent testing across different test frameworks
- Improved error messages and diagnostics for DAP request timeouts

## [0.0.52] - 2026-01-23

## Summary

This release focuses on improving the development workflow by decoupling the Playwright demo from the standard unit test suite, making the test process more reliable and flexible across different platforms.

## Improvements

### Testing & CI

- **Split Playwright demo from unit tests**: The Playwright demo spec is now executed separately via `npm run demo:pw` instead of being embedded in `npm pretest`. This separation improves reliability on macOS and Windows by avoiding display server requirements during standard unit tests.
- **Removed `run-demo-pw-smoke.cjs` script**: Eliminated the 69-line wrapper script that handled cross-platform xvfb execution. Developers now run `xvfb-run -a npm run demo:pw` directly on Linux when needed.
- **Simplified CI workflow**: Removed `PW_VSCODE_TEST_SKIP_SMOKE` environment variable from GitHub Actions, as the demo is now handled by a dedicated job.

### Documentation

- **Updated README**: Enhanced testing section with clear instructions for running the Playwright demo separately, including Linux virtual display setup with `xvfb-run`.
- **Updated agents.md**: Added documentation for the new `npm run demo:pw` command.

### Configuration

- **Updated .gitignore**: Added `.gh-artifacts/` to ignore downloaded GitHub Actions artifacts in local development.
- **Test workspace configuration**: Increased `copilot-debugger.entryTimeoutSeconds` to 60 seconds in the test workspace.

## Breaking Changes

None.

## [0.0.51] - 2026-01-23

Based on my analysis of the commits and code changes between version 0.0.50 and 0.0.51, here are the release notes:

---

# Release 0.0.51

## Summary

This release focuses on comprehensive CI/CD improvements, enhanced testing infrastructure with Playwright integration, better DAP (Debug Adapter Protocol) tracing, and improved Windows compatibility. The release includes significant refinements to the development workflow with video demonstration capabilities, automated testing, and better diagnostic output for debugging issues.

## New Features

- **Playwright Integration**: Added complete Playwright testing infrastructure with demo video generation capabilities
  - New `playwright.config.ts` and demo test specs for UI-driven testing
  - Automated demo video generation in CI pipeline with artifacts uploaded as MP4
  - PowerShell script (`Test-Playwright.ps1`) for local Playwright testing
  - Git submodules for `playwright-test-videos` and `vscode-test-playwright`

- **Enhanced DAP Tracing**: Significantly improved Debug Adapter Protocol message visibility
  - Quieter, more intelligent trace output that filters noisy internal events
  - Better formatting of DAP messages for debugging timeout issues
  - De-duplication of DAP logs to prevent spam from multiple hook invocations

- **Local Development with Act**: Added support for running GitHub Actions workflows locally using `act`
  - New `.actrc` configuration for GitHub Actions local testing
  - Documentation in `docs/act.md` for local CI workflow execution
  - Act artifact debug workflow for troubleshooting

## Improvements

- **CI/CD Enhancements**:
  - Stabilized Playwright smoke tests across platforms (Linux, macOS, Windows)
  - Run Linux CI jobs in Playwright Docker images for consistency
  - Fixed DBus environment configuration for headless VS Code testing
  - Increased CI timeouts to reduce flakiness
  - Enhanced CI handshake tracing for better debugging
  - Auto Release workflow now includes proper apt dependencies

- **Windows Compatibility**:
  - Fixed Windows-specific issues with NODE_OPTIONS environment variable handling
  - Made npm scripts Windows-safe across the board
  - Improved task output capture for Windows environments

- **Build and Error Handling**:
  - Unified JSON formatters across the codebase
  - Enhanced task command error handling for build failures
  - New test workspace for build error scenarios (stdout and stderr testing)

- **Test Infrastructure**:
  - Stabilized serverReady vscodeCommand tests for deterministic behavior
  - Fixed test issue where capture breakpoints could incorrectly become logpoints
  - Improved task output capture stability
  - Better CI submodule initialization (only required submodules in PRs)

- **Code Quality**:
  - Applied extensive ESLint autofixes and formatting improvements
  - Removed deprecated `inspectJustification` parameter (simplified API)
  - Better code style consistency across TypeScript source files
  - Added pre-commit git hooks for code quality enforcement

- **Documentation**:
  - New `agents.md` file documenting agent workflows
  - Enhanced README with demo video integration
  - Comprehensive act.md documentation for local CI testing

## Bug Fixes

- **CI Fixes**:
  - Fixed Auto Release apt dependencies preventing proper workflow execution
  - Corrected Playwright demo workspace path to be portable across environments
  - Fixed issue where vscode-test-playwright needed to be built before typecheck
  - Resolved npm script compatibility issues on Windows

- **Test Fixes**:
  - Prevented capture breakpoints from incorrectly becoming logpoints during tests
  - Made serverReady vscodeCommand test deterministic to avoid race conditions
  - Stabilized task output capture to prevent test flakiness

## Breaking Changes

None

## Technical Details

**Changed Files**: 85 files modified
- Major CI/CD improvements in `.github/workflows/ci.yml` (+434 lines)
- New Playwright infrastructure (config, tests, scripts)
- Enhanced session management in `src/session.ts` (+2,236 lines modified)
- Improved DAP event handling in `src/events.ts` (+813 lines)
- Better logging in `src/logger.ts` (+135 lines)
- Dependencies updated in `package-lock.json` (3,090 lines modified)

**Platform Support**:
- Linux (fully tested in CI)
- macOS (Playwright smoke tests skipped in CI, manual testing supported)
- Windows (Playwright smoke tests skipped in CI, manual testing supported with fixed NODE_OPTIONS handling)

**Development Workflow**:
- Added support for local GitHub Actions testing with `act`
- Enhanced video generation pipeline for demos
- Improved git submodule management for external dependencies

---

## [0.0.49] - 2026-01-07

# Release 0.0.49

## Summary

This release introduces automatic step-over functionality and enhances debug session management with stable session IDs and improved tool integration. These improvements provide more reliable debugging experiences and better error handling.

## New Features

- **Automatic Step Over (`autoStepOver`)**: Added intelligent step-over functionality that automatically advances through code execution
- **Stable Session IDs**: Debug sessions now maintain consistent, stable identifiers throughout their lifecycle for better tracking and management
- **Enhanced Tool Integration**: Debug sessions now support `toolId` tracking for improved integration with external tools and better session resolution

## Improvements

- **Enhanced Debug Session Management**: Significant improvements to session lifecycle management with better error handling and state tracking
- **Improved Stop Information**: Enhanced markdown formatting and display of breakpoint stop information with more detailed context
- **Test Coverage**: Expanded test suite with new tests for debug session resolution and snippet breakpoints functionality

## Bug Fixes

- Improved error handling in debug session management to prevent edge cases and improve stability

## Technical Details

**Changed Files**: 16 files modified
- Core session management improvements in `src/session.ts` (+147 lines)
- Enhanced stop information display in `src/stopInfoMarkdown.ts` (+81 lines)
- New test coverage for session resolution and breakpoint handling
- Updated configuration and build settings

**Commits**:
- feat: autoStepOver + stable session ids ([4c100cc](https://github.com/darrenkattan/Copilot-Breakpoint-Debugger/commit/4c100cc))
- feat: enhance debug session management with toolId and improved error handling ([5895491](https://github.com/darrenkattan/Copilot-Breakpoint-Debugger/commit/5895491))

## [0.0.48] - 2026-01-07

# Release Notes - v0.0.48

## Summary
This release includes improvements to the CI/CD pipeline, specifically around release note generation and workflow optimization.

## Changes

### Improvements
- **CI Pipeline Enhancement**: Automated release note generation is now integrated directly into the auto-release workflow
- **Workflow Optimization**: Release notes artifact is now reused across workflow jobs to improve efficiency and reduce redundant processing
- **Test Configuration**: Reverted workspace timeout settings to ensure proper test execution

### Bug Fixes
- Fixed test workspace timeout configuration that was causing issues in the test environment

## Breaking Changes
None

---

**Full Changelog**: https://github.com/Copilot-Breakpoint-Debugger/compare/v0.0.47...v0.0.48

## [0.0.47] - 2026-01-07

# Release Notes - v0.0.47

## Summary

This release focuses on improving the continuous integration workflow by automating the release notes generation process directly in GitHub Actions.

## Changes

### Improvements

- **Automated Release Notes Generation**: The release notes generation script has been integrated into the CI/CD pipeline, allowing for automatic generation of release notes during the build process. The script was renamed from `generate-release-notes-local.ts` to `generate-release-notes.ts` to reflect its broader usage beyond local development.

- **Enhanced CI Workflow**: Updated GitHub Actions workflow configuration to include the release notes generation step, streamlining the release process and ensuring consistent documentation with each version release.

### Internal Changes

- Minor version bump in package.json from 0.0.46 to 0.0.47

## Breaking Changes

None

## [0.0.46] - 2026-01-07

# Release Notes - v0.0.46

## Summary

This release introduces a new tool for listing active debug sessions, improves the reliability of stopped-event handling, and refactors the API for stopping debug sessions. The release also includes significant enhancements to the TypeScript-based release notes generation and CI workflows.

## New Features

- **List Debug Sessions Tool**: Added `listDebugSessions` tool to query and display active debug sessions, making it easier to track multiple debugging contexts
- **TypeScript Release Notes Generation**: Migrated release notes generation from JavaScript to TypeScript for better type safety and maintainability

## Bug Fixes

- **Hardened Stopped-Event Handling**: Improved robustness of stopped-event handling to prevent race conditions and ensure reliable breakpoint capture

## Improvements

- **API Refactoring**: Renamed `stopDebugging` to `captureAndStopDebugging` to better reflect its dual purpose
- **Enhanced CI Workflows**: Expanded CI configuration with additional checks and improved test coverage
- **Test Suite Enhancements**: 
  - Increased test timeouts across integration tests to reduce CI flakiness
  - Added comprehensive tests for caught exceptions and runtime error handling
  - Expanded server-ready tests and debug session mapping tests
- **Improved Stop Info Display**: Enhanced markdown formatting for debug session stop information

## Breaking Changes

- **API Change**: The `stopDebugging` method has been renamed to `captureAndStopDebugging`. Code calling the old method name will need to be updated.


## [0.0.45] - 2026-01-05

## 0.0.45 (2023-06-08)

### Bug Fixes

- Increase timeouts for all integration tests to avoid CI flakiness ([9025bb3](https://github.com/anthropic-com/example-repo/commit/9025bb3))
- Replace claude-code-action with custom script to fix push event error in CI ([95a81db](https://github.com/anthropic-com/example-repo/commit/95a81db))
- Increase timeout for startDebuggerPrompt test ([2916380](https://github.com/anthropic-com/example-repo/commit/2916380))

### Features

- Switch to claude-code-action for release notes generation ([da9998e](https://github.com/anthropic-com/example-repo/commit/da9998e))

### Improvements

- Update CI workflow with new steps and configurations ([72 changes](https://github.com/anthropic-com/example-repo/commit/COMMIT_HASH))

### Other Changes

- Update .gitignore ([2 changes](https://github.com/anthropic-com/example-repo/commit/COMMIT_HASH))
- Update package.json with new dependencies and scripts ([7 changes](https://github.com/anthropic-com/example-repo/commit/COMMIT_HASH))
- Minor updates to various test files

# Change Log

All notable changes to the "copilot-debugger" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 2025-12-29

**Changed:** Start Debugger tool sessions now default to **singleShot** behavior: when the debugger is paused at a breakpoint, the tool will terminate the debug session before returning. This is a safe-by-default guardrail to prevent out-of-band actions against a paused debuggee.

- To keep the session alive for follow-up inspection (variables/expressions/resume), set `mode: "inspect"` in the Start Debugger tool input.
- Note: This behavior applies to sessions started via the tool flow; it does not change normal manual VS Code debugging behavior.

## [0.0.21] - 2025-11-21

**Breaking:** Removed legacy `serverReady` shape (`path`, `line`, `command`, `httpRequest`, `pattern`, `immediateOnAttach`). Introduced unified object:

```ts
serverReady: {
 trigger?: { path?: string; line?: number; pattern?: string }; // omit for immediate attach
 action: { shellCommand: string } |
     { httpRequest: { url: string; method?: string; headers?: Record<string,string>; body?: string } } |
     { vscodeCommand: { command: string; args?: unknown[] } };
}
```

**Added:** `vscodeCommand` action variant for execution of VS Code commands upon readiness.

**Changed:** HTTP request action is now dispatched fire‑and‑forget (non-blocking) to prevent slow health endpoints from interfering with transition to user breakpoints.

**Removed:** Obsolete compatibility shim (`LegacyServerReady`) and associated mapping logic in `startDebuggerTool.ts`. All tooling / tests now consume the new structure directly.

**Schema:** Updated `package.json` tool input schema: replaced prior multi-variant + mutual exclusion validation with a single `serverReady` object containing `trigger` and discriminated `action` union. Mandatory `action`; optional `trigger`.

**Docs:** README section rewritten (examples for breakpoint, pattern, immediate attach, and vscodeCommand). Added Azure Functions attach sequence diagram illustrating immediate action execution when `trigger` omitted.

**Tests:** Updated existing serverReady tests to new structure (shellCommand + httpRequest). Added `serverReadyVscodeCommand` test (covers VS Code command action). Deleted deprecated `autoSelectLaunchConfig.test.ts` pending placeholder via direct file removal (runtime auto-select behavior remains documented).

**Internal:** Introduced helper `executeServerReadyAction` in `session.ts` to centralize serverReady action dispatch phases (`entry`, `late`, `immediate`). Simplified advancement logic after serverReady breakpoint hits. Ensured NO FALLBACK principle by eliminating legacy field tolerance and not inferring triggers.

**Upgrade Guidance:** Update any invocations supplying legacy fields to new `trigger`/`action` structure. For prior immediate attach usage (`immediateOnAttach: true`), simply omit `trigger` and keep the action. For breakpoint mode wrap former `path`/`line` in `trigger`. For pattern mode wrap former `pattern` in `trigger.pattern`.

**Impact:** Tool consumers (LLMs / prompts) gain clearer, future-extensible readiness API while reducing ambiguity and validation branching.

- Initial release
- Security: Override transitive `glob` to 10.5.0 (fixes GHSA-5j98-mcp5-4vw2) via root `overrides` after audit flagged vulnerable range (<10.5.0). Lockfile committed for reproducible remediation.
- **Breaking:** Removed `launchConfigurationName` alias from Start Debugger tool input schema. Use `configurationName` exclusively. Resolution order unchanged (direct value → setting → auto-select sole configuration). Prompts referencing the alias must be updated.

## [0.0.19] - 2025-11-21

**Changed:** Refined `serverReady` input schema using `oneOf` to support three variants: breakpoint (`path`+`line`), pattern (`pattern`), or immediate attach (`immediateOnAttach`). Added `allOf` + nested `oneOf` ensuring mutual exclusivity between `command` and `httpRequest` (exactly one action form required per variant).

**Removed:** Legacy wording from descriptions; breakpoint mode remains first-class, not deprecated.

**Internal:** Schema-only enhancement; runtime logic already tolerates absence of `path`/`line` and supports `pattern` and `immediateOnAttach`. No code changes required in this revision.

**Upgrade Impact:** Non-breaking; existing payloads still valid. New validation enforces that both `command` and `httpRequest` cannot appear together and guarantees at least one readiness trigger mode is specified.

**Added:** Expanded `serverReady` automation with optional properties:

- `pattern` – Injects a VS Code `serverReadyAction` (openExternally) pointing to a `vscode://dkattan.copilot-breakpoint-debugger/serverReady` URI so the built-in output detectors (debug console / task terminal) signal readiness without duplicating pattern matching code.
- `httpRequest` – Perform an HTTP request (`fetch`) when readiness is detected (breakpoint, pattern, or immediate attach). Supports `url`, `method`, `headers`, `body`.
- `immediateOnAttach` – For `request: "attach"` configurations, execute the command or HTTP request right after attaching (Azure Functions host scenarios where output has already scrolled past).
- All legacy breakpoint fields (`path`, `line`) are now optional; you can use pure pattern or immediate attach modes.

**Changed:** `serverReady` schema in `package.json` no longer requires `path`, `line`, `command`. Added documentation in README with examples for each mode (legacy breakpoint, pattern-based, immediate attach).

**Internal:** Pattern handling attaches a temporary URI handler resolving a Promise keyed by a random token; actions run asynchronously and do not interfere with breakpoint wait logic.

**Upgrade Impact:** Non-breaking. Existing breakpoint-based usage continues to function. New properties are additive. If a prior workflow relied on required `path`/`line` validation it will now accept an object without them.

**Note:** Pattern detection leverages VS Code's built-in extension behavior via URI indirection for maintainability—no fallback duplicated regex scanning logic introduced (preserves NO FALLBACK principle).

## [0.0.17] - 2025-11-20

**Fixed:** Server-ready breakpoint detection no longer falsely treats the initial stop as a user breakpoint due to path normalization mismatches. Logic now tolerates the first stopped event being either a user breakpoint or the serverReady marker line and will correctly continue past the serverReady line to the intended user breakpoint.

**Behavior:** Explicitly supports user breakpoint hitting first (adapters that emit a breakpoint before an `entry` reason). The first valid stopped event is treated as the entry stop when it coincides with a user breakpoint; no timeout or misclassification occurs.

**Removed (Tests):** `autoSelectLaunchConfig.test.ts` eliminated per product decision to reduce maintenance overhead. Auto-select logic (sole configuration when none specified and no setting) remains unchanged and documented; only the test artifact was removed.

**Internal:** Minor conditional simplification for serverReady detection (line-based match only). No schema or tool interface changes.

**Upgrade Impact:** None. Existing workflows continue to function; improved resilience for early user breakpoint scenarios.

## [0.0.16] - 2025-11-20

**Documentation:** Clarified that `variableFilter` values are exact, case-sensitive variable names (no regex support). Removed prior regex-style examples (`^(user|session)$`, `^order_`) from README and replaced with explicit name lists. Added note that `resumeDebugSession` breakpoints may omit `variableFilter` (optional) while `startDebugSessionWithBreakpoints` requires it per breakpoint to keep responses compact.

**Added:** Expanded README action guidance (difference between `break`, `capture`, `stopDebugging`), release workflow steps, and improved examples for capture interpolation.

**Internal:** Version bump only; no functional code changes. Test suite unchanged. Prepares accurate docs baseline before subsequent feature work.

**Rationale:** Prevent confusion observed in prompts using regex patterns; LLM planners should enumerate exact variable names they want returned.

## [0.0.15] - 2025-11-20

**Purpose:** Patch release to establish an immutable post–force-tag artifact after moving `v0.0.14` to commit `75294db`. Ensures CI publish runs against a stable tag without retroactive modification.

**Changed:** Version bump only (`package.json` 0.0.15). No functional code changes compared to commit `75294db` previously referenced by updated `v0.0.14`.

**Clarification:** `v0.0.14` tag was force-updated; consumers may have pulled the earlier commit. Use `v0.0.15` for guaranteed alignment with current codebase.

**Internal:** Release notes annotate rationale; no source diffs beyond version field.

## [0.0.14] - 2025-11-19

**Changed:** Enforced strict `workspaceFolder` semantics (must be absolute path to an open folder; removed all extension root / parent heuristics). StartDebuggerTool is now a thin wrapper delegating all validation to `startDebuggingAndWaitForStop`.

**Added:** Auto-selection of a sole launch configuration when no `configurationName` is provided and no `copilot-debugger.defaultLaunchConfiguration` is set. New test `autoSelectLaunchConfig.test.ts` verifies this behavior.

**Removed:** Legacy fallback resolution for non-open folders and extension installation directory scanning.

**Internal:** Centralized launch config resolution, breakpoint validation, timeout derivation, and breakpoint action handling inside `session.ts`. Updated `AGENTS.md` to reflect refactor and stricter model. Documentation now consistently refers to `workspaceFolder` as required.

**Note:** Version bump only in CHANGELOG (package.json unchanged) per request to document behavior; functional changes already present in codebase prior to entry.

## [0.0.13] - 2025-11-18

**Documentation:** Renamed `agents.md` to `AGENTS.md` (case normalization for consistency with other capitalized reference files). No functional code changes.

**Internal:** Version bump only; preparing tagged release.

## [0.0.12] - 2025-11-18

**Changed:** Renamed setting `copilot-debugger.startDebuggerTimeoutSeconds` ➜ `copilot-debugger.entryTimeoutSeconds` (clarifies it governs initial entry stop wait). Updated README and AGENTS.md with entry timeout guidance + single test invocation examples.

**Added:** `tasks.json` introducing `sleep-build-delay` preLaunchTask; new timeout test (`src/test/timeout.test.ts`) validating entry stop timeout behavior.

**Internal:** StartDebuggerTool now reads `entryTimeoutSeconds` and emits specific timeout error when entry stop not reached within configured window.

## [0.0.11] - 2025-11-17

**Changed:** Removed public `hitCondition` string property; only support exact numeric `hitCount` in breakpoint schemas. Updated docs and manifest to drop pattern-based conditions.

**Breaking:** Previous `hitCondition` usage must migrate to `hitCount` integer.

**Internal:** Refactored session and start debugger tool interfaces to remove legacy alias logic.

## [0.0.10] - 2025-11-17

**Added:** `capture` breakpoint action; numeric `hitCount` shorthand; conditional availability of resume tool.

**Changed:** Enhanced manifest descriptions for breakpoint actions and interpolation.

**Internal:** ESLint fixes for string concatenation.

## [0.0.9] - 2025-11-17

**Changed:** Improved icon transparency handling.

**Documentation:** Updated AGENTS.md workflow notes.

**Internal:** Asset + docs only.

## [0.0.8] - 2025-11-17

**Changed:** Corrected repository/homepage/bugs URLs.

**Internal:** Metadata-only, no API changes.

## [0.0.7] - 2025-11-17

**Changed:** Updated extension icon for clarity.

**Internal:** Version bump only.

## [0.0.6] - 2025-11-17

**Added:** Per-breakpoint `variableFilter`; `logger.ts`; breakpoint `action`; ESLint improvements; Evaluate Expression refinements.

**Changed:** Manifest schema adjustments; exact name filtering; workspace settings file relocation; kept CommonJS module target.

**Fixed:** Workspace path usage; improved session resilience.

**Internal:** Updated tests; refactors across core files.

**Diff Summary:** Between `v0.0.5` and `v0.0.6`:

```text
.vscode-test.mjs
esbuild.js
eslint.config.mjs
package.json
src/evaluateExpressionTool.ts
src/events.ts
src/inspection.ts
src/logger.ts (added)
src/session.ts
src/startDebuggerTool.ts
src/test/debugUtils.test.ts
src/test/multiRootWorkspace.test.ts
src/test/startDebuggerPrompt.test.ts
src/test/suite/index.ts
src/test/utils/startDebuggerToolTestUtils.ts
src/testTypes.ts
test-workspace.code-workspace -> test-workspace/test-workspace.code-workspace (moved)
tsconfig.json
```
