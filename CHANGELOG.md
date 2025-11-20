# Change Log

All notable changes to the "copilot-debugger" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- Security: Override transitive `glob` to 10.5.0 (fixes GHSA-5j98-mcp5-4vw2) via root `overrides` after audit flagged vulnerable range (<10.5.0). Lockfile committed for reproducible remediation.
- **Breaking:** Removed `launchConfigurationName` alias from Start Debugger tool input schema. Use `configurationName` exclusively. Resolution order unchanged (direct value → setting → auto-select sole configuration). Prompts referencing the alias must be updated.

## [0.0.17] - 2025-11-20

**Fixed:** Server-ready breakpoint detection no longer falsely treats the initial stop as a user breakpoint due to path normalization mismatches. Logic now tolerates the first stopped event being either a user breakpoint or the serverReady marker line and will correctly continue past the serverReady line to the intended user breakpoint.

**Behavior:** Explicitly supports user breakpoint hitting first (adapters that emit a breakpoint before an `entry` reason). The first valid stopped event is treated as the entry stop when it coincides with a user breakpoint; no timeout or misclassification occurs.

**Removed (Tests):** `autoSelectLaunchConfig.test.ts` eliminated per product decision to reduce maintenance overhead. Auto-select logic (sole configuration when none specified and no setting) remains unchanged and documented; only the test artifact was removed.

**Internal:** Minor conditional simplification for serverReady detection (line-based match only). No schema or tool interface changes.

**Upgrade Impact:** None. Existing workflows continue to function; improved resilience for early user breakpoint scenarios.

## [0.0.16] - 2025-11-20

**Documentation:** Clarified that `variableFilter` values are exact, case-sensitive variable names (no regex support). Removed prior regex-style examples (`^(user|session)$`, `^order_`) from README and replaced with explicit name lists. Added note that `resume_debug_session` breakpoints may omit `variableFilter` (optional) while `start_debugger_with_breakpoints` requires it per breakpoint to keep responses compact.

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
