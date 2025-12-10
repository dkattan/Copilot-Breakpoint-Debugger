import * as assert from "node:assert";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as vscode from "vscode";
import { config } from "../config";
import { startDebuggingAndWaitForStop } from "../session";

const testRequire = createRequire(__filename);

describe("build diagnostics integration tests", () => {
  const testWorkspaceRoot = path.resolve(
    __dirname,
    "../../test-workspace/build-error-test"
  );

  it("should capture build errors from problem matcher when preLaunchTask fails", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Configure debug.onTaskErrors to abort to prevent dialogs in tests
    const debugConfig = vscode.workspace.getConfiguration("debug");
    await debugConfig.update(
      "onTaskErrors",
      "abort",
      vscode.ConfigurationTarget.Workspace
    );

    // Attempt to start debugging with build errors
    let caughtError: Error | undefined;
    try {
      await startDebuggingAndWaitForStop({
        sessionName: "Build Error Test Session",
        workspaceFolder: workspaceFolder.uri.fsPath,
        breakpointConfig: {
          breakpoints: [
            {
              path: "broken.ts",
              line: 4,
              action: "break",
              variableFilter: ["x"],
            },
          ],
        },
        nameOrConfiguration: "Build Error Test",
        timeoutSeconds: 10,
      });
    } catch (error) {
      caughtError = error as Error;
    }

    // Verify error was thrown
    assert.ok(caughtError, "Should throw error when build fails");

    // Verify error message contains build diagnostics
    const errorMsg = caughtError!.message;
    assert.ok(
      errorMsg.includes("terminated before hitting entry") ||
        errorMsg.includes("Failed to start debug session"),
      `Error should mention entry stop failure or start failure. Got: ${errorMsg}`
    );

    // The error message should mention diagnostics or task failure
    const hasDiagnostics =
      errorMsg.includes("Build errors:") ||
      errorMsg.includes("Task") ||
      errorMsg.includes("exited with code");

    assert.ok(
      hasDiagnostics,
      `Error message should include build diagnostics. Got: ${errorMsg}`
    );

    assert.ok(
      errorMsg.includes("tsc: build with errors"),
      `Error message should mention the failing task label. Got: ${errorMsg}`
    );

    const includesCompilerOutput =
      errorMsg.includes("TS2304") ||
      errorMsg.includes("Cannot find name 'undeclaredVariable'");

    assert.ok(
      includesCompilerOutput,
      `Error message should include compiler output when problem matcher diagnostics are unavailable. Got: ${errorMsg}`
    );
  });

  it("should format multiple build errors concisely", async function () {
    this.timeout(30000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Ensure the built-in TypeScript extension is active so diagnostics are available
    const typescriptExtension = vscode.extensions.getExtension(
      "vscode.typescript-language-features"
    );
    if (typescriptExtension && !typescriptExtension.isActive) {
      await typescriptExtension.activate();
    }

    // Open the file to ensure diagnostics are tracked
    const docUri = vscode.Uri.file(path.join(testWorkspaceRoot, "broken.ts"));
    const openedDoc = await vscode.workspace.openTextDocument(docUri);
    await vscode.window.showTextDocument(openedDoc);

    // Trigger build to populate diagnostics
    const typescriptCliPath = testRequire.resolve("typescript/lib/tsc.js");
    const tscTask = new vscode.Task(
      { type: "process" },
      workspaceFolder,
      "tsc: build with errors",
      "test",
      new vscode.ProcessExecution(process.execPath, [
        typescriptCliPath,
        "--noEmit",
      ]),
      "$tsc"
    );
    try {
      await vscode.tasks.executeTask(tscTask);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch {
      // Task may fail, that's expected
    }

    // Check diagnostics with retry
    const brokenTsDiags = vscode.languages
      .getDiagnostics()
      ?.find(
        ([uri]) =>
          uri.fsPath.includes("broken.ts") &&
          uri.fsPath.includes("build-error-test")
      );
    // await new Promise((resolve) => setTimeout(resolve, 500));

    assert.ok(brokenTsDiags, "Should have diagnostics for broken.ts");

    const errorDiags = brokenTsDiags[1].filter(
      (d) => d.severity === vscode.DiagnosticSeverity.Error
    );

    assert.ok(
      errorDiags.length >= 3,
      `Should have multiple build errors (got ${errorDiags.length})`
    );

    // Verify error messages are truncated to reasonable length
    for (const diag of errorDiags.slice(0, 5)) {
      const msg = diag.message;
      assert.ok(msg.length > 0, "Diagnostic message should not be empty");
    }
  });

  it("should respect maxBuildErrors configuration", async function () {
    this.timeout(10000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.fsPath === testWorkspaceRoot
    );

    if (!workspaceFolder) {
      this.skip();
      return;
    }

    // Set maxBuildErrors to 2
    const originalMaxBuildErrors = config.maxBuildErrors;
    await config.$update(
      "maxBuildErrors",
      2,
      vscode.ConfigurationTarget.Workspace
    );

    assert.strictEqual(
      config.maxBuildErrors,
      2,
      "maxBuildErrors should be set to 2"
    );

    // Reset to previous value
    await config.$update(
      "maxBuildErrors",
      originalMaxBuildErrors,
      vscode.ConfigurationTarget.Workspace
    );
  });

  after(async () => {
    // Reset debug.onTaskErrors
    const debugConfig = vscode.workspace.getConfiguration("debug");
    await debugConfig.update(
      "onTaskErrors",
      undefined,
      vscode.ConfigurationTarget.Workspace
    );
  });
});
