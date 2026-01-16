import type { PlaywrightTestConfig } from "@playwright/test";
import type {
	VSCodeTestOptions,
	VSCodeWorkerOptions,
} from "vscode-test-playwright";
import * as path from "node:path";

// Local Playwright demo config.
//
// Sign-in note:
// - For CI/automated tests we intentionally run a clean, downloaded VS Code.
// - For recording demos (Copilot/GitHub already signed in), set
//   PW_VSCODE_EXECUTABLE_PATH to your *system-installed* VS Code so the test
//   inherits your normal profile and auth state.
//
// macOS examples:
//   PW_VSCODE_EXECUTABLE_PATH=/Applications/Visual\ Studio\ Code.app
//   PW_VSCODE_EXECUTABLE_PATH=/Applications/Visual\ Studio\ Code\ Insiders.app
//
// If your Copilot/GitHub auth is stored in a non-default VS Code Profile
// (Profiles feature), also set:
//
//   PW_VSCODE_PROFILE="<Your Profile Name>"
//
// If you already have VS Code running, launching another instance with the same
// profile can “handoff” to the existing process and exit immediately (Playwright
// then sees the Electron app close).
// To avoid that while still retaining auth, you can clone your existing profile:
//
//   PW_VSCODE_CLONE_USER_DATA_FROM="$HOME/Library/Application Support/Code"
//   # or: "$HOME/Library/Application Support/Code - Insiders"
//
// Or (cross-platform) let the harness resolve the default location:
//
//   PW_VSCODE_CLONE_USER_DATA_FROM=default
//
// If you use cloning, VS Code will be launched with --user-data-dir pointing at
// the clone. If you *don't* use cloning, VS Code will use its default user data
// directory (so it can inherit your normal sign-in state).
//
// CRITICAL: Do NOT specify userDataDir here. We rely on VS Code's default user
// data directory so the spawned instance can inherit the machine's sign-in state.

const repoRoot = __dirname;

const config = {
	testDir: path.join(repoRoot, "playwright"),
	globalSetup: path.join(repoRoot, "playwright", "globalSetup"),
	reporter: [["list"]],
	timeout: 90_000,
	expect: {
		timeout: 15_000,
	},
	// Keep this single-worker so the demo is deterministic and doesn't contend for UI.
	workers: 1,
	fullyParallel: false,
	use: {
		// Electron/VS Code can be slow to show first window on cold start.
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		// Record a demo video (saved as .webm in test-results) that we later convert
		// to `docs/pw-videos/demo.mp4` via the `playwright-test-videos` submodule.
		video: "on",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "vscode-chat-demo",
			use: {
				// The `vscode-test-playwright` fixtures read these options.
				vscodeVersion: "stable",
				vscodeTrace: "off",
				extensionDevelopmentPath: repoRoot,
				baseDir: path.join(
					repoRoot,
					"test-workspace",
					"test-workspace.code-workspace"
				),
				// Intentionally omit: userDataDir, extensionsDir, extensions.
			},
		},
	],
} satisfies PlaywrightTestConfig<VSCodeTestOptions, VSCodeWorkerOptions>;

export default config;
