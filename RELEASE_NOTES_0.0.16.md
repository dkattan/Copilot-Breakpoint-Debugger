# Release v0.0.16

## Summary
Documentation-only release clarifying `variableFilter` semantics as **exact, case-sensitive names** (no regex/glob). Updated README examples, expanded publishing checklist, and added resilience to auto-select launch configuration test (skips gracefully if multi-root folder cannot be injected).

## Changes
- Bumped version: 0.0.15 -> 0.0.16
- CHANGELOG: Added 0.0.16 entry (docs clarification, rationale)
- README: Removed regex examples (`^(user|session)$`, `^order_`) in favor of explicit names; added detailed release workflow; clarified required vs optional `variableFilter` (start vs resume tool)
- Test: `autoSelectLaunchConfig.test.ts` now attempts to inject `workspace-b` folder and falls back to skip to avoid false negatives in single-root harness environments
- Lint: Removed stray expression in `session.ts` causing ESLint failure

## Integrity
No runtime / API changes. All existing tests pass (1 skipped: auto-select sole config when multi-root not available). Suitable for marketplace publish.

## Recommended Prompt Adjustments
Update any Copilot prompts using regex-style variable filters to enumerate explicit names instead:
- OLD: "filter ^(user|session)$" -> NEW: "filter variables user,session"

## Next Steps
If acceptable, publish via existing CI by creating a GitHub Release on tag `v0.0.16`. Marketplace package will reflect updated docs.
