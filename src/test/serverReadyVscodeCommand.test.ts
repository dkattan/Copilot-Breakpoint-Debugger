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

// Test serverReady vscodeCommand action variant: executes VS Code command when readiness breakpoint hit, then continues.

describe("serverReady vscodeCommand action", () => {
  // Under full-suite load, debug adapter startup + serverReady hop can occasionally be slow.
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("executes vscodeCommand at serverReady breakpoint then pauses at user breakpoint", async function () {
    // This test exercises real debug adapter startup + serverReady action execution.
    // Under load (CI, cold machine), it can exceed Mocha's 30s default.
    this.timeout(240000);

    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "b");
    const serverPath = path.join(workspaceFolder, "server.js");
    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    // Use a pattern trigger instead of a breakpoint trigger.
    // The serverReady breakpoint line executes only once and can be missed if it runs
    // before VS Code finishes binding breakpoints under load.
    const readyPattern = "Server listening on http://localhost:31337";
    const userBreakpointSnippet = "TICK_FOR_USER_BREAKPOINT";
    const userBreakpointLine
      = serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(userBreakpointSnippet)) + 1;
    assert.ok(
      userBreakpointLine > 0,
      "Did not find user breakpoint snippet line",
    );

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run b/server.js",
      timeoutSeconds: 180,
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            code: userBreakpointSnippet,
            variable: "started",
            onHit: "break",
          },
        ],
      },
      serverReady: {
        trigger: { pattern: readyPattern },
        action: {
          type: "vscodeCommand",
          // Use a non-UI command that resolves quickly and is safe in headless extension tests.
          command: "setContext",
          args: ["copilotBreakpointDebugger.test.serverReady", true],
        },
      },
    });

    assert.strictEqual(
      context.serverReadyInfo.triggerMode,
      "pattern",
      "serverReady trigger mode should be pattern (vscodeCommand)",
    );
    assert.ok(
      context.serverReadyInfo.phases.some(phase => phase.phase === "immediate"),
      "serverReady pattern should execute immediate phase (vscodeCommand)",
    );

    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      "Did not pause at expected user breakpoint line after serverReady continue (vscodeCommand)",
    );
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing (vscodeCommand)");
    assert.strictEqual(
      context.hitBreakpoint?.line,
      userBreakpointLine,
      "hitBreakpoint line mismatch (vscodeCommand)",
    );
  });
});
