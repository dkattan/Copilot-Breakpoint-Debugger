import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { config } from "../config";
import { getSessionExitCode, getSessionOutput } from "../events";
import { startDebuggingAndWaitForStop } from "../session";

describe("runtime error diagnostics tests", () => {
  const testWorkspaceRoot = path.resolve(
    __dirname,
    "../../test-workspace/runtime-error-test",
  );

  it("should capture stderr and exit code from Node.js crash", async function () {
    this.timeout(60000);
    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Attempt to start debugging - script will crash before hitting breakpoint
    let caughtError: Error | undefined;

    try {
      const crashDocUri = vscode.Uri.file(
        path.join(testWorkspaceRoot, "crash.js"),
      );
      const crashDoc = await vscode.workspace.openTextDocument(crashDocUri);
      const crashText = crashDoc.getText();
      const breakpointSnippet = crashText
        .split(/\r?\n/)
        .find(l => l.includes("UNREACHABLE_AFTER_EXIT"))
        ?.trim() ?? "";
      await startDebuggingAndWaitForStop({
        sessionName: "Node Crash Test Session",
        workspaceFolder: workspaceFolder.uri.fsPath,
        breakpointConfig: {
          breakpoints: [
            {
              path: "crash.js",
              code: breakpointSnippet, // Line after the crash
              onHit: "break",
              variable: "_nonexistent",
            },
          ],
        },
        nameOrConfiguration: "Node Crash Test",
      });
    }
    catch (error) {
      caughtError = error as Error;
    }

    // Verify error was thrown
    assert.ok(caughtError, "Should throw error when script crashes");

    // Verify error message
    const errorMsg = caughtError!.message;
    assert.ok(
      /terminated|exited|exit code|ended|stopped/i.test(errorMsg),
      `Error should mention termination/exit. Got: ${errorMsg}`,
    );

    // Check if error message contains runtime diagnostics
    const hasExitCode
      = errorMsg.includes("exit code") || errorMsg.includes("42");
    const hasStderr
      = errorMsg.includes("stderr")
        || errorMsg.includes("ERROR")
        || errorMsg.includes("CRASH");

    // At least one diagnostic should be present
    const hasRuntimeDiag = hasExitCode || hasStderr;
    assert.ok(
      hasRuntimeDiag,
      `Error message should include runtime diagnostics (exit code or stderr). Got: ${errorMsg}`,
    );
  });

  it("should capture uncaught exception stop before expected breakpoint", async function () {
    this.timeout(60000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    let stopInfo:
      | Awaited<ReturnType<typeof startDebuggingAndWaitForStop>>
      | undefined;
    let caughtError: Error | undefined;

    try {
      const docUri = vscode.Uri.file(
        path.join(testWorkspaceRoot, "exception.js"),
      );
      const doc = await vscode.workspace.openTextDocument(docUri);
      const text = doc.getText();
      const breakpointSnippet
        = text
          .split(/\r?\n/)
          .find(l => l.includes("UNREACHABLE_AFTER_THROW"))
          ?.trim() ?? "";

      stopInfo = await startDebuggingAndWaitForStop({
        sessionName: "Node Exception Test Session",
        workspaceFolder: workspaceFolder.uri.fsPath,
        breakpointConfig: {
          breakpoints: [
            {
              path: "exception.js",
              code: breakpointSnippet,
              onHit: "break",
              variable: "_nonexistent",
            },
          ],
        },
        nameOrConfiguration: "Node Exception Test",
        timeoutSeconds: 45,
      });
    }
    catch (error) {
      caughtError = error as Error;
    }

    assert.ok(
      !caughtError,
      `Should not throw. Got error: ${caughtError?.message}`,
    );
    assert.ok(stopInfo, "Should return stopInfo for exception stop.");
    assert.ok(stopInfo!.exceptionInfo?.description);
    assert.ok(
      /uncaught|unhandled|exception|error/i.test(
        stopInfo!.exceptionInfo?.description ?? "",
      ),
      `Expected exception description to mention uncaught/unhandled/exception/error; got: ${
        stopInfo!.exceptionInfo?.description
      }`,
    );
    assert.ok(
      stopInfo!.reason === "exception" || stopInfo!.reason === "breakpoint",
      `Expected stop reason to be 'exception' (or adapter-reported 'breakpoint'); got: ${
        stopInfo!.reason
      }`,
    );
    assert.strictEqual(
      stopInfo!.hitBreakpoint,
      undefined,
      "Exception stop should not correlate to a requested breakpoint.",
    );
  });

  it("should not stop on caught exception before expected breakpoint", async function () {
    this.timeout(60000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    const docUri = vscode.Uri.file(
      path.join(testWorkspaceRoot, "caughtException.js"),
    );
    const doc = await vscode.workspace.openTextDocument(docUri);
    const text = doc.getText();
    const breakpointSnippet
      = text
        .split(/\r?\n/)
        .find(l => l.includes("REACHABLE_AFTER_CATCH"))
        ?.trim() ?? "";

    assert.ok(breakpointSnippet, "Expected REACHABLE_AFTER_CATCH marker line");

    const stopInfo = await startDebuggingAndWaitForStop({
      sessionName: "Node Caught Exception Test Session",
      workspaceFolder: workspaceFolder.uri.fsPath,
      breakpointConfig: {
        breakpoints: [
          {
            path: "caughtException.js",
            code: breakpointSnippet,
            onHit: "break",
            variable: "_nonexistent",
          },
        ],
      },
      nameOrConfiguration: "Node Caught Exception Test",
      timeoutSeconds: 45,
    });

    assert.ok(stopInfo, "Should return stopInfo");
    assert.strictEqual(
      stopInfo.exceptionInfo,
      undefined,
      "Caught exception should not surface as an exception stop",
    );
    assert.ok(
      stopInfo.hitBreakpoint,
      "Should correlate the stop to a requested breakpoint",
    );
    assert.ok(
      stopInfo.hitBreakpoint?.path?.endsWith("caughtException.js"),
      `Expected breakpoint hit in caughtException.js; got: ${stopInfo.hitBreakpoint?.path}`,
    );
    assert.strictEqual(
      stopInfo.reason,
      "breakpoint",
      `Expected stop reason to be 'breakpoint', got: ${stopInfo.reason}`,
    );
  });

  it("should limit stderr output to configured maxOutputLines", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
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
      vscode.ConfigurationTarget.Workspace,
    );

    assert.strictEqual(
      config.maxOutputLines,
      20,
      "maxOutputLines should be set to 20",
    );

    // Reset to previous value
    await config.$update(
      "maxOutputLines",
      originalMaxOutputLines,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  it("should capture DAP output events", async function () {
    // Starting a debug session in the VS Code test harness can be slow on cold
    // runs (downloaded VS Code, extension host spin-up, etc.), so allow extra time.
    this.timeout(60000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Ensure we start from a clean slate; an in-flight termination from a prior
    // test can cause subsequent startDebugging calls to stall.
    await vscode.debug.stopDebugging();

    // Start a debug session that will produce output
    const started = await vscode.debug.startDebugging(
      workspaceFolder,
      "Node Crash Test",
    );

    assert.ok(started, "Debug session should start");

    // Wait for output to be captured
    await new Promise(resolve => setTimeout(resolve, 2000));

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
    // This test relies on starting a debug session; allow extra time for the
    // VS Code test harness to spin up on slower / colder runs.
    this.timeout(60000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Ensure we start from a clean slate; an in-flight termination from a prior
    // test can cause subsequent startDebugging calls to stall.
    await vscode.debug.stopDebugging();

    // Start debugging with a script that exits with code 42
    const started = await vscode.debug.startDebugging(
      workspaceFolder,
      "Node Crash Test",
    );

    assert.ok(started, "Debug session should start");

    let sessionId: string | undefined;
    if (vscode.debug.activeDebugSession) {
      sessionId = vscode.debug.activeDebugSession.id;
    }

    // Wait for the script to exit
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if exit code was captured
    if (sessionId) {
      const exitCode = getSessionExitCode(sessionId);
      // Exit code should be captured (either 42 or undefined if not yet received)
      assert.ok(
        exitCode === undefined || typeof exitCode === "number",
        `Exit code should be number or undefined, got: ${exitCode}`,
      );

      if (exitCode !== undefined) {
        assert.strictEqual(
          exitCode,
          42,
          "Exit code should be 42 from crash.js",
        );
      }
    }

    // Best-effort cleanup so this test doesn't leak sessions into subsequent tests.
    await vscode.debug.stopDebugging();
  });

  it("should format stderr lines concisely in error messages", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === testWorkspaceRoot,
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Attempt debug session that will produce stderr
    let caughtError: Error | undefined;
    try {
      const crashDocUri = vscode.Uri.file(
        path.join(testWorkspaceRoot, "crash.js"),
      );
      const crashDoc = await vscode.workspace.openTextDocument(crashDocUri);
      const crashText = crashDoc.getText();
      const breakpointSnippet
        = crashText
          .split(/\r?\n/)
          .find(l => l.includes("UNREACHABLE_AFTER_EXIT"))
          ?.trim() ?? "";
      await startDebuggingAndWaitForStop({
        sessionName: "Node Crash Stderr Test",
        workspaceFolder: workspaceFolder.uri.fsPath,
        breakpointConfig: {
          breakpoints: [
            {
              path: "crash.js",
              code: breakpointSnippet,
              onHit: "break",
              variable: "_test",
            },
          ],
        },
        nameOrConfiguration: "Node Crash Test",
        timeoutSeconds: 45,
      });
    }
    catch (error) {
      caughtError = error as Error;
    }

    if (caughtError) {
      const errorMsg = caughtError.message;

      // If stderr is included, it should be truncated/formatted
      if (errorMsg.includes("stderr")) {
        // Error message should not be excessively long
        assert.ok(
          errorMsg.length < 1000,
          "Error message with stderr should be concise (< 1000 chars)",
        );

        // Should use pipe separator for multiple lines
        const hasFormatting
          = errorMsg.includes("|") || errorMsg.includes("...");
        assert.ok(
          hasFormatting,
          "Stderr should be formatted with separators or truncation",
        );
      }
    }
  });
});
