## [0.0.50] - 2026-01-08

## Summary

This release contains documentation improvements to the release notes generation process.

## Improvements

- Enhanced the release notes generation workflow instructions to provide clearer guidance on analyzing code changes and managing context window limitations

---

*No breaking changes in this release.*

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

- **API Refactoring**: Renamed `stopDebugging` to `captureAndStopDebugging` to better reflect its dual purpose, and added `inspectJustification` requirement for inspect mode to clarify debugging intent
- **Enhanced CI Workflows**: Expanded CI configuration with additional checks and improved test coverage
- **Test Suite Enhancements**: 
  - Increased test timeouts across integration tests to reduce CI flakiness
  - Added comprehensive tests for caught exceptions and runtime error handling
  - Expanded server-ready tests and debug session mapping tests
- **Improved Stop Info Display**: Enhanced markdown formatting for debug session stop information

## Breaking Changes

- **API Change**: The `stopDebugging` method has been renamed to `captureAndStopDebugging`. Code calling the old method name will need to be updated.
- **Inspect Mode Requirement**: Inspect mode now requires an `inspectJustification` parameter to be provided.

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
