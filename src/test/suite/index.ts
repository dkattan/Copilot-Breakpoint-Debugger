import * as path from "node:path";
import * as process from "node:process";
import { glob } from "glob";
import * as Mocha from "mocha";
import * as vscode from "vscode";
import { config } from "../../config";

// Capture unhandled promise rejections during tests to avoid premature process termination.
// Mocha will surface assertion/timeout failures via its own mechanisms; we only log here.
process.on("unhandledRejection", (reason) => {
  console.error("[test harness] Unhandled rejection (captured):", reason);
});

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
    timeout: 60000, // Increase timeout for integration tests
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((c, e) => {
    glob("**/**.test.js", { cwd: testsRoot })
      .then(async (files: string[]) => {
        // Ensure debug adapter message tracing is enabled in tests.
        // This makes DAP traffic visible in output when investigating timeouts/hangs.
        try {
          await config.$update(
            "enableTraceLogging",
            true,
            vscode.ConfigurationTarget.Workspace,
          );
          await config.$update(
            "consoleLogLevel",
            "trace",
            vscode.ConfigurationTarget.Workspace,
          );

          // Verify effective values.
          console.log(
            `[test harness] copilot-debugger.enableTraceLogging=${String(
              config.enableTraceLogging,
            )} copilot-debugger.consoleLogLevel=${String(config.consoleLogLevel)}`,
          );
        }
        catch (err) {
          console.warn(
            "[test harness] Failed to enable copilot-debugger trace logging:",
            err,
          );
        }

        // Add files to the test suite
        files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
        console.log("[mocha-discovery] Test files matched:", files.length);
        files.forEach(f => console.log("  file:", f));

        try {
          // Load files (register suites/tests) before enumerating
          await mocha.loadFilesAsync();
          const rootSuite = mocha.suite;
          const walk = (suite: Mocha.Suite, depth = 0) => {
            const pad = "  ".repeat(depth);
            if (suite.title) {
              console.log(`${pad}[suite]`, suite.title);
            }
            suite.tests.forEach((t) => {
              console.log(`${pad}  [test]`, t.title);
            });
            suite.suites.forEach(s => walk(s, depth + 1));
          };
          console.log("[mocha-discovery] Enumerating suites/tests...");
          walk(rootSuite);
          mocha.run((failures: number) => {
            if (failures > 0) {
              e(new Error(`${failures} tests failed.`));
            }
            else {
              c();
            }
          });
        }
        catch (err) {
          console.error("[mocha-discovery] Error during load/run", err);
          e(err);
        }
      })
      .catch(e);
  });
}
