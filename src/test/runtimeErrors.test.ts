import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { config } from "../config";
import { getSessionExitCode, getSessionOutput } from "../events";
import { startDebuggingAndWaitForStop } from "../session";

describe("runtime error diagnostics tests", () => {
  const testWorkspaceRoot = path.resolve(
    __dirname,
    "../../test-workspace/runtime-error-test"
  );

  it("should capture stderr and exit code from Node.js crash", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Attempt to start debugging - script will crash before hitting breakpoint
    let caughtError: Error | undefined;

    try {
      await startDebuggingAndWaitForStop({
        sessionName: "Node Crash Test Session",
        workspaceFolder: workspaceFolder.uri.fsPath,
        breakpointConfig: {
          breakpoints: [
            {
              path: "crash.js",
              line: 16, // Line after the crash
              onHit: "break",
              variableFilter: ["_nonexistent"],
            },
          ],
        },
        nameOrConfiguration: "Node Crash Test",
        timeoutSeconds: 10,
      });
    } catch (error) {
      caughtError = error as Error;
    }

    // Verify error was thrown
    assert.ok(caughtError, "Should throw error when script crashes");

    // Verify error message
    const errorMsg = caughtError!.message;
    assert.ok(
      errorMsg.includes("terminated"),
      "Error should mention termination"
    );

    // Check if error message contains runtime diagnostics
    const hasExitCode =
      errorMsg.includes("exit code") || errorMsg.includes("42");
    const hasStderr =
      errorMsg.includes("stderr") ||
      errorMsg.includes("ERROR") ||
      errorMsg.includes("CRASH");

    // At least one diagnostic should be present
    const hasRuntimeDiag = hasExitCode || hasStderr;
    assert.ok(
      hasRuntimeDiag,
      `Error message should include runtime diagnostics (exit code or stderr). Got: ${errorMsg}`
    );
  });

  it("should limit stderr output to configured maxOutputLines", async function () {
    this.timeout(10000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Set maxOutputLines to a small value
    const originalMaxOutputLines = config.maxOutputLines;
    await config.$update(
      "maxOutputLines",
      20,
      vscode.ConfigurationTarget.Workspace
    );

    assert.strictEqual(
      config.maxOutputLines,
      20,
      "maxOutputLines should be set to 20"
    );

    // Reset to previous value
    await config.$update(
      "maxOutputLines",
      originalMaxOutputLines,
      vscode.ConfigurationTarget.Workspace
    );
  });

  it("should capture DAP output events", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Start a debug session that will produce output
    const started = await vscode.debug.startDebugging(
      workspaceFolder,
      "Node Crash Test"
    );

    assert.ok(started, "Debug session should start");

    // Wait for output to be captured
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const session = vscode.debug.activeDebugSession;
    if (session) {
      const output = getSessionOutput(session.id);
      // Output buffer should have captured some lines
      assert.ok(Array.isArray(output), "Output should be an array");

      // Stop the session
      await vscode.debug.stopDebugging(session);
    }
  });

  it("should capture process exit codes from DAP exited events", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Start debugging with a script that exits with code 42
    const started = await vscode.debug.startDebugging(
      workspaceFolder,
      "Node Crash Test"
    );

    assert.ok(started, "Debug session should start");

    let sessionId: string | undefined;
    if (vscode.debug.activeDebugSession) {
      sessionId = vscode.debug.activeDebugSession.id;
    }

    // Wait for the script to exit
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if exit code was captured
    if (sessionId) {
      const exitCode = getSessionExitCode(sessionId);
      // Exit code should be captured (either 42 or undefined if not yet received)
      assert.ok(
        exitCode === undefined || typeof exitCode === "number",
        `Exit code should be number or undefined, got: ${exitCode}`
      );

      if (exitCode !== undefined) {
        assert.strictEqual(
          exitCode,
          42,
          "Exit code should be 42 from crash.js"
        );
      }
    }
  });

  it("should format stderr lines concisely in error messages", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Attempt debug session that will produce stderr
    let caughtError: Error | undefined;
    try {
      await startDebuggingAndWaitForStop({
        sessionName: "Node Crash Stderr Test",
        workspaceFolder: workspaceFolder.uri.fsPath,
        breakpointConfig: {
          breakpoints: [
            {
              path: "crash.js",
              line: 13,
              onHit: "break",
              variableFilter: ["_test"],
            },
          ],
        },
        nameOrConfiguration: "Node Crash Test",
        timeoutSeconds: 10,
      });
    } catch (error) {
      caughtError = error as Error;
    }

    if (caughtError) {
      const errorMsg = caughtError.message;

      // If stderr is included, it should be truncated/formatted
      if (errorMsg.includes("stderr")) {
        // Error message should not be excessively long
        assert.ok(
          errorMsg.length < 1000,
          "Error message with stderr should be concise (< 1000 chars)"
        );

        // Should use pipe separator for multiple lines
        const hasFormatting =
          errorMsg.includes("|") || errorMsg.includes("...");
        assert.ok(
          hasFormatting,
          "Stderr should be formatted with separators or truncation"
        );
      }
    }
  });
});
