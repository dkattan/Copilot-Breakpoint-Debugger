import * as assert from "node:assert";
import * as vscode from "vscode";
import { config } from "../config";
import {
  invokeStartDebuggerTool,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

// Test that a very short configured timeout causes StartDebuggerTool to error
// when the breakpoint line is only executed after a longer delay.
describe("startDebuggerTool timeout behavior", () => {
  let originalTimeout: number | undefined;

  before(async () => {
    originalTimeout = config.entryTimeoutSeconds;
    await config.$update(
      "entryTimeoutSeconds",
      1,
      vscode.ConfigurationTarget.Workspace
    );
  });

  after(async () => {
    await config.$update(
      "entryTimeoutSeconds",
      originalTimeout ?? 60,
      vscode.ConfigurationTarget.Workspace
    );
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("reports timeout when breakpoint not hit within configured seconds", async () => {
    const result = await invokeStartDebuggerTool({
      scriptRelativePath: "test-workspace/b/test.js",
      configurationName: "Run test.js with preLaunchTask",
      variableFilter: ["delayedValue"],
      breakpointLines: [6], // line with delayed assignment inside setTimeout callback
      workspaceFolder: "test-workspace/b",
    });
    const { content } = result;
    assert.ok(content.length === 1, "expected single output part");
    const text = (content[0] as vscode.LanguageModelTextPart).value as string;
    assert.match(
      text,
      /Timed out|timeout/i,
      "Expected timeout indication in tool output"
    );
    assert.match(
      text,
      /Timeout state analysis:/,
      "Expected timeout state analysis block"
    );
    assert.match(
      text,
      /Entry stop observed: NO/i,
      "Timeout report should mention missing entry stop"
    );
    assert.match(
      text,
      /serverReadyAction configured: no/i,
      "Report should include serverReadyAction configuration status"
    );
    assert.match(
      text,
      /Only raise 'copilot-debugger\.entryTimeoutSeconds'/,
      "Report should recommend checking readiness signals before increasing timeout"
    );
  });
});
