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

describe("startDebuggingAndWaitForStop - capture-all (variable='*')", () => {
  const configurationName = "Run test.js";
  let workspaceFolder: string;
  let scriptPath: string;
  let baseParams: { workspaceFolder: string, nameOrConfiguration: string };

  before(async () => {
    const extensionRoot = getExtensionRoot();
    const scriptRelative = "test-workspace/node/test.js";
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    assert.ok(vscode.workspace.workspaceFolders?.length);
    workspaceFolder = vscode.workspace.workspaceFolders.find(
      f => f.name === "workspace-node",
    )!.uri.fsPath;
    scriptPath = scriptUri.fsPath;
    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();
    baseParams = { workspaceFolder, nameOrConfiguration: configurationName };
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("capture action with variable='*' auto-captures variables and interpolates log message", async () => {
    const bpSnippet = "Loop iteration";
    const doc = await vscode.workspace.openTextDocument(scriptPath);
    const expectedLine
      = doc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(bpSnippet)) + 1;
    assert.ok(
      expectedLine > 0,
      "Expected breakpoint snippet to exist in test script",
    );
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: bpSnippet,
              onHit: "captureAndStopDebugging" as const,
              logMessage: "i={i}",
              variable: "*",
            },
          ],
        },
      }),
    );

    assert.ok(
      typeof context.frame.line === "number" && context.frame.line > expectedLine,
      "Expected default step-over to advance past the breakpoint line before capture",
    );
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing");
    assert.strictEqual(context.hitBreakpoint?.onHit, "captureAndStopDebugging");
    assert.strictEqual(context.hitBreakpoint?.variable, "*");
    assert.strictEqual(context.hitBreakpoint?.line, expectedLine);
    assert.ok(
      Array.isArray(context.capturedLogMessages)
      && context.capturedLogMessages.length === 1,
      "Expected one captured log message",
    );
    assert.ok(
      /i=\d+/.test(context.capturedLogMessages![0]),
      `Log message interpolation missing expected variable value: ${
        context.capturedLogMessages![0]
      }`,
    );
  });
});
