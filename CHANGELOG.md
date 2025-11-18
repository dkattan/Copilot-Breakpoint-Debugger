# Change Log

All notable changes to the "copilot-debugger" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release

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
