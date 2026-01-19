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
    // Record a video for the demo.
    // Note: Historically Electron-backed VS Code video capture has been inconsistent,
    // but we prefer the native Playwright path over custom screenshot+ffmpeg logic.
    video: {
      mode: "on",
      size: { width: 1280, height: 720 },
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "vscode-chat-demo",
      use: {
        // The `vscode-test-playwright` fixtures read these options.
        vscodeVersion: "stable",
        vscodeTrace: "off",
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
