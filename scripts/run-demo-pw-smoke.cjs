/*
 * Cross-platform runner for the Playwright demo smoke test.
 *
 * We intentionally wrap the Playwright invocation with xvfb-run on Linux
 * (CI / act) because Electron typically requires a display server.
 */

const cp = require("node:child_process");
const process = require("node:process");

function buildEnv() {
  const env = { ...process.env, NODE_OPTIONS: "" };

  // The harness supports both WS and pipe transports.
  // Pipe is the harness default, but we keep this explicit on Windows so
  // local/CI behavior stays predictable even if defaults change later.
  if (!env.PW_VSCODE_TEST_TRANSPORT && process.platform === "win32") {
    env.PW_VSCODE_TEST_TRANSPORT = "pipe";
  }

  // Starting VS Code + extension host can be slower on CI (cold starts) and Windows.
  // Increase the connection timeout unless the user has explicitly set one.
  if (!env.PW_VSCODE_TEST_WS_CONNECT_TIMEOUT_MS) {
    const isCi = String(env.CI).toLowerCase() === "true";
    if (isCi || process.platform === "win32") {
      // Must be >= playwright.config.ts timeout (CI) to avoid confusing double timeouts.
      env.PW_VSCODE_TEST_WS_CONNECT_TIMEOUT_MS = "240000";
    }
  }

  return env;
}

function run(cmd, args) {
  const result = cp.spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: buildEnv(),
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
