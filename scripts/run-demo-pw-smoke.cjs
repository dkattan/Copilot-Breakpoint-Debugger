/*
 * Cross-platform runner for the Playwright demo smoke test.
 *
 * We intentionally wrap the Playwright invocation with xvfb-run on Linux
 * (CI / act) because Electron typically requires a display server.
 */

const cp = require("node:child_process");
const process = require("node:process");

function run(cmd, args) {
  const result = cp.spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_OPTIONS: "" },
  });

  if (result.error) {
    throw result.error;
  }

  // spawnSync returns null when killed by signal.
  if (typeof result.status !== "number") {
    throw new TypeError(
      `Playwright smoke test terminated unexpectedly (signal=${String(
        result.signal,
      )}).`,
    );
  }

  process.exitCode = result.status;
}

// Ensure the VS Code test harness is compiled, then run the demo spec.
run("npm", ["run", "demo:pw:prep"]);

const pwArgs = [
  "scripts/playwright-cli-from-vscode-test-playwright.cjs",
  "test",
  "--config",
  "playwright.config.ts",
  "playwright/demo.spec.ts",
];

if (process.platform === "linux") {
  // If this fails because xvfb-run is missing, error loudly (no silent fallback).
  run("xvfb-run", ["-a", "node", ...pwArgs]);
}
else {
  run("node", pwArgs);
}
