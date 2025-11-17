# Change Log

All notable changes to the "copilot-debugger" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release

## [0.0.8] - 2025-11-17

### Changed

- Corrected `package.json` repository, homepage, and bugs URLs to point to `dkattan/Copilot-Breakpoint-Debugger` instead of legacy name.

### Internal

- Metadata-only update; no code or API changes.

## [0.0.7] - 2025-11-17

### Changed

- Updated extension icon (`images/icon.png`) for improved clarity and contrast across light and dark themes.

### Internal

- Version bump only; no functional code changes.

## [0.0.6] - 2025-11-17

### Added

- Per-breakpoint `variableFilter` supporting exact variable name inclusion (replaces previous regex fragment approach).
- New `logger.ts` utility for structured logging within StartDebuggerTool and other tools.
- Support for per-breakpoint `action` (e.g., `stopDebugging`) enabling automated termination after hit.
- Enhanced ESLint configuration to ignore vendor/source trees for performance and signal clarity.
- Evaluate Expression tool refinements in `evaluateExpressionTool.ts`.

### Changed

- Manifest (`package.json`) updated: removed obsolete top-level `variableFilter` parameter; added per-breakpoint schema with required exact name filtering.
- StartDebuggerTool filtering logic now uses exact case-sensitive name matching instead of regex aggregation.
- Moved workspace settings file `test-workspace.code-workspace` into `test-workspace/` directory (path normalization).
- `tsconfig.json` retained CommonJS module to stabilize test harness behavior.

### Fixed

- Corrected workspace path usage in `debugUtils.test.ts`.
- Improved resilience of session handling and test utilities.

### Internal

- Updated tests for new breakpoint action and variable filtering semantics.
- Minor refactors across `session.ts`, `events.ts`, and inspection utilities.

### Diff Summary

Files changed between `v0.0.5` and `v0.0.6`:

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
