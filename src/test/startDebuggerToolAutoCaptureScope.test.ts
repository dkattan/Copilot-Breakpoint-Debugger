import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { StartDebuggerTool } from "../startDebuggerTool";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("startDebuggerTool auto-capture nearest scope", function () {
  this.timeout(60_000);
  const configurationName = "Run test.js";
  let workspaceFolder: string;
  let scriptPath: string;

  before(async () => {
    const extensionRoot = getExtensionRoot();
    const scriptRelative = "test-workspace/b/test.js";
    scriptPath = path.join(extensionRoot, scriptRelative);
    const targetWorkspace = vscode.workspace.workspaceFolders?.find(
      f => f.name === "workspace-b",
    );
    assert.ok(targetWorkspace, "workspace-b folder missing");
    workspaceFolder = targetWorkspace!.uri.fsPath;
    await openScriptDocument(vscode.Uri.file(scriptPath));
    await activateCopilotDebugger();
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("auto-captures nearest scope variables when variableFilter is omitted", async () => {
    const expectedLine
      = (await vscode.workspace.openTextDocument(scriptPath))
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes("Loop iteration")) + 1;
    assert.ok(expectedLine > 0, "Did not find expected snippet line");

    const tool = new StartDebuggerTool();
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: "Loop iteration",
              onHit: "break" as const,
              // variableFilter required; empty array opts into auto-capture
              variableFilter: [],
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    const { content } = result;
    assert.ok(content.length === 1, "tool should return a single prompt part");
    const promptPart = content[0];
    assert.ok(
      promptPart instanceof vscode.LanguageModelTextPart,
      "expected LanguageModelTextPart for concise output",
    );
    const textValue = promptPart.value as string;
    assert.match(
      textValue,
      new RegExp(`Breakpoint .*:${expectedLine}`),
      "Missing breakpoint header",
    );
    assert.match(textValue, /## Vars/, "Missing Vars header");
    assert.match(
      textValue,
      /\|\s*i\s*\|\s*number\s*\|\s*\d+\s*\|/,
      "Auto-captured variable i missing in table",
    );
  });
});
