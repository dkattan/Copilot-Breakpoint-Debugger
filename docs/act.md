## Running CI locally with `act`

This repo’s CI is defined in `.github/workflows/ci.yml`. You can emulate most of it locally using [`act`](https://github.com/nektos/act).

### Install

- macOS (Homebrew): `brew install act`

### Recommended: reproduce the Playwright demo job

This is the job that launches VS Code (Electron) under Xvfb and tends to be the most finicky.

- Run only the Playwright demo job (fastest):
  - `act -W .github/workflows/ci.yml -j playwright-demo --no-deps`

Notes:
- This repo includes a `.actrc` that selects a close-to-`ubuntu-latest` image and forces `linux/amd64` for CI parity.
- By default, `act` sets `github.actor` to `nektos/act`. The workflow uses that to:
  - allow `playwright-demo` to run locally even though it normally only runs on pushes to `main`
  - skip release/publish jobs that require secrets

### What is skipped under act (no secrets required)

When running under `act`, these jobs are intentionally skipped:
- `release-notes` (requires `ANTHROPIC_API_KEY`)
- `auto-release` (writes tags/releases and uses `ANTHROPIC_API_KEY`)
- `publish` (requires `VSCE_PAT`)

This keeps local runs secret-free and focused on reproducing failures.

### If you want to run other jobs

- Package only:
  - `act -W .github/workflows/ci.yml -j package`

- Build/test (Linux only under act):
  - `act -W .github/workflows/ci.yml -j build-and-test`

(Windows/macOS matrix entries won’t run under Docker-based `act`.)

### Troubleshooting tips

- If a job can’t pull the runner image, run again with network access enabled, or manually `docker pull ghcr.io/catthehacker/ubuntu:full-24.04`.
- If you changed `act`’s actor via flags and the Playwright job doesn’t run, ensure the actor is `nektos/act`:
  - `act ... -a nektos/act`
