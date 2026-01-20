// import { execSync } from 'node:child_process';
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
// import process from 'node:process';
import { fileURLToPath } from "node:url";

import { defineConfig } from "@vscode/test-cli";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Clear user data directory before tests to prevent cached workspace state
const userDataDir = resolve(__dirname, ".vscode-test/user-data");
if (existsSync(userDataDir)) {
  rmSync(userDataDir, { recursive: true, force: true });
}

export default defineConfig({
  files: "src/test/**/*.test.ts",
  version: "stable", // Match the parent VS Code version
  mocha: {
    ui: "bdd",
    timeout: 30000,
    parallel: false,
    require: ["esbuild-register"],
    bail: true,
  },

  // Allow extensions to load; we install required ones below via the 'extensions' field.
  // Run with a temporary profile for isolation between test runs.
  launchArgs: [
    resolve(__dirname, "test-workspace", "test-workspace.code-workspace"),
    // '--profile-temp',
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-extensions",
    "--enable-proposed-api",
    "dkattan.copilot-breakpoint-debugger",
  ],
  // Request automatic installation of required marketplace extensions for tests.
  // @vscode/test-cli will ensure these are present before running.
  // extensions: ['ms-vscode.powershell'],
  coverage: {
    reporter: ["text", "html", "lcov"],
    exclude: ["src/test/**", "**/node_modules/**"],
  },
  timeout: 30000,
});
