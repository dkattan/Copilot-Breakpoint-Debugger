import type { PlaywrightTestConfig } from "@playwright/test";
import type {
  VSCodeTestOptions,
  VSCodeWorkerOptions,
} from "vscode-test-playwright";
import * as path from "node:path";

const repoRoot = __dirname;

const config = {
  testDir: path.join(repoRoot, "playwright"),
  reporter: [["list"]],
  // Keep runs consistent across environments; connection diagnostics should not depend on long timeouts.
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
    // IMPORTANT: VS Code is launched via a custom Electron fixture in `vscode-test-playwright`.
    // Playwright's top-level `video` setting is not automatically applied to that launch.
    // Use the fixture's `vscodeVideo` option instead.
    video: "off",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "vscode-chat-demo",
      use: {
        // The `vscode-test-playwright` fixtures read these options.
        vscodeVersion: "stable",
        vscodeTrace: "off",
        vscodeVideo: {
          mode: "on",
          size: { width: 1280, height: 920 },
          // Keep the VS Code window itself at the same pixel dimensions (best-effort).
          windowSize: { width: 1280, height: 920 },
        },
        // Ensure Copilot Chat is available during the demo run. Our extension is
        // loaded via extensionDevelopmentPath, but Copilot Chat must be installed
        // as a marketplace extension.
        //
        // NOTE: We do NOT use --disable-extensions here because that would
        // prevent Copilot/Copilot Chat from loading.
        extensions: ["github.copilot", "github.copilot-chat"],
        extensionDevelopmentPath: repoRoot,
        baseDir: path.join(
          repoRoot,
          "test-workspace",
          "test-workspace.code-workspace",
        ),
        // Intentionally omit: userDataDir, extensionsDir, extensions.
      },
    },
  ],
} satisfies PlaywrightTestConfig<VSCodeTestOptions, VSCodeWorkerOptions>;

export default config;
