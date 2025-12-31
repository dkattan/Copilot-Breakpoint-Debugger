import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { startDebuggingAndWaitForStop } from "../session";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("snippet-based breakpoints", function () {
  this.timeout(60_000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("resolves a snippet that matches multiple lines (sets breakpoints on all)", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");
    const scriptUri = vscode.Uri.file(scriptPath);
    const doc = await vscode.workspace.openTextDocument(scriptUri);
    await openScriptDocument(scriptUri);

    const snippet = "console.log"; // matches multiple lines
    const expectedFirstLine =
      doc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes(snippet)) + 1;
    assert.ok(expectedFirstLine > 0, "Expected snippet to exist in test.js");

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            code: snippet,
            onHit: "break",
            variableFilter: [],
          },
        ],
      },
    });

    assert.strictEqual(
      context.frame.line,
      expectedFirstLine,
      "Did not pause on the first matching snippet breakpoint"
    );
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing");
    assert.strictEqual(context.hitBreakpoint.code, snippet);
    assert.strictEqual(context.hitBreakpoint.line, expectedFirstLine);
  });

  it("throws a clear error when snippet is not found", async () => {
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const scriptPath = path.join(workspaceFolder, "test.js");
    const scriptUri = vscode.Uri.file(scriptPath);
    await openScriptDocument(scriptUri);

    const missing = "THIS_SNIPPET_DOES_NOT_EXIST_123";

    await assert.rejects(
      () =>
        startDebuggingAndWaitForStop({
          sessionName: "",
          workspaceFolder,
          nameOrConfiguration: "Run test.js",
          breakpointConfig: {
            breakpoints: [
              {
                path: scriptPath,
                code: missing,
                onHit: "break",
                variableFilter: [],
              },
            ],
          },
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return /not found/i.test(msg) && msg.includes(missing);
      }
    );
  });
});
