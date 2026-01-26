import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  startDebuggingAndWaitForStop,
  triggerBreakpointAndWaitForStop,
} from "../session";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("triggerBreakpoint", function () {
  this.timeout(240000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("resumes a paused Node session, fires httpRequest, and stops at request handler breakpoint", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");

    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    const lines = serverDoc.getText().split(/\r?\n/);
    const readyLine = lines.findIndex(l => l.includes("LINE_FOR_SERVER_READY")) + 1;
    assert.ok(readyLine > 0, "Did not find serverReady marker line");

    const echoSnippet = "const queryParamForDebugger = queryParam";
    const echoLine = lines.findIndex(l => l.includes(echoSnippet)) + 1;
    assert.ok(echoLine > 0, "Did not find /api/echo breakpoint target line");

    const startStop = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run node/server.js",
      timeoutSeconds: 120,
      mode: "inspect",
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            code: "LINE_FOR_SERVER_READY",
            variable: "started",
            onHit: "break",
          },
        ],
      },
    });

    assert.strictEqual(
      startStop.frame.line,
      readyLine,
      "Did not pause at expected serverReady line",
    );

    const sessionId = startStop.debuggerState.sessionId;
    assert.ok(sessionId, "Expected debuggerState.sessionId in inspect mode");

    const triggerStop = await triggerBreakpointAndWaitForStop({
      sessionId,
      timeoutSeconds: 60,
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            code: echoSnippet,
            variable: "queryParamForDebugger",
            onHit: "break",
          },
        ],
      },
      action: {
        type: "httpRequest",
        url: "http://localhost:31337/api/echo?q=hello",
      },
    });

    assert.strictEqual(
      triggerStop.frame.line,
      echoLine,
      "Did not pause at expected /api/echo handler line after trigger",
    );
    assert.ok(triggerStop.hitBreakpoint, "hitBreakpoint missing for trigger stop");
    assert.strictEqual(
      triggerStop.hitBreakpoint?.line,
      echoLine,
      "hitBreakpoint line mismatch for trigger stop",
    );
  });
});
