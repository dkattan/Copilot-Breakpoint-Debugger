/*
 * Resolve and run the Playwright CLI from the same node_modules tree that
 * `vscode-test-playwright` uses.
 *
 * Why: If the Playwright runner (CLI) and the `test()` function come from
 * different installations of @playwright/test, Playwright errors with:
 *   "Playwright Test did not expect test() to be called here."
 *
 * This script avoids hard-coding any node_modules path and works whether
 * dependencies are hoisted (CI) or nested (local dev).
 */

"use strict";

const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const process = require("node:process");

function fail(message) {
  console.error(message);
  process.exit(1);
}

let vscodeTestPlaywrightPackageJson;
try {
  vscodeTestPlaywrightPackageJson = require.resolve(
    "vscode-test-playwright/package.json",
  );
}
catch {
  fail(
    "Unable to resolve 'vscode-test-playwright/package.json'. Did you run 'npm install'?",
  );
}

const requireFromVscodeTestPlaywright = createRequire(
  vscodeTestPlaywrightPackageJson,
);

let playwrightCli;
try {
  playwrightCli = requireFromVscodeTestPlaywright.resolve("playwright/cli");
}
catch {
  // Some setups may not expose 'playwright/cli' directly; fall back to the
  // CLI entry inside @playwright/test (same module graph as vscode-test-playwright).
  try {
    playwrightCli = requireFromVscodeTestPlaywright.resolve("@playwright/test/cli");
  }
  catch {
    fail(
      "Unable to resolve Playwright CLI from vscode-test-playwright's dependency tree. Ensure Playwright is installed.",
    );
  }
}

const args = process.argv.slice(2);
const res = spawnSync(process.execPath, [playwrightCli, ...args], {
  stdio: "inherit",
});

// Node may report null if the child was terminated by a signal.
process.exit(res.status ?? 1);
