import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  listDebugSessionsForTool,
  resumeDebugSessionWithoutWaiting,
  startDebuggingAndWaitForStop,
} from "../session";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("listDebugSessions status", function () {
  this.timeout(240000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("reports paused vs running status and protocol", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");

    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

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

    const sessionId = startStop.debuggerState.sessionId;
    assert.ok(sessionId, "Expected debuggerState.sessionId in inspect mode");

    const parsedPaused = JSON.parse(listDebugSessionsForTool()) as {
      sessions: unknown[]
      flatSessions?: Array<{ id: string, status: string, protocol?: { allowedNextActions?: string[] } }>
    };

    const pausedEntry = parsedPaused.flatSessions?.find(s => s.id === sessionId);
    assert.ok(pausedEntry, "Expected session to appear in listDebugSessions");
    assert.strictEqual(pausedEntry?.status, "paused", "Expected paused status");
    assert.ok(
      pausedEntry?.protocol?.allowedNextActions?.includes("getVariables"),
      "Expected getVariables to be allowed when paused",
    );

    await resumeDebugSessionWithoutWaiting({ sessionId });

    // Give the adapter a moment to emit 'continued'.
    await new Promise(resolve => setTimeout(resolve, 250));

    const parsedRunning = JSON.parse(listDebugSessionsForTool()) as {
      flatSessions?: Array<{ id: string, status: string, protocol?: { allowedNextActions?: string[] } }>
    };
    const runningEntry = parsedRunning.flatSessions?.find(s => s.id === sessionId);
    assert.ok(runningEntry, "Expected session to still appear after resume");
    assert.strictEqual(runningEntry?.status, "running", "Expected running status");
    assert.ok(
      runningEntry?.protocol?.allowedNextActions?.includes("externalHttpRequest"),
      "Expected externalHttpRequest to be allowed when running",
    );
  });

  it("nests child sessions under parent when available", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");

    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    // Start and pause so the Node debugger has time to spin up both parent + child sessions.
    await startDebuggingAndWaitForStop({
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

    // Give trackers a moment to observe launch args and populate parent mapping.
    await new Promise(resolve => setTimeout(resolve, 250));

    const parsed = JSON.parse(listDebugSessionsForTool()) as {
      sessions: Array<{ id: string, children?: Array<{ id: string, hasParentSession: boolean }> }>
      flatSessions?: Array<{ id: string, hasParentSession: boolean, parentSessionId?: string }>
    };

    const anyChild = parsed.flatSessions?.find(s => s.hasParentSession);
    assert.ok(anyChild, "Expected at least one child session with a parent");
    assert.ok(anyChild?.parentSessionId, "Expected parentSessionId for child session");

    const rootWithChildren = parsed.sessions.find(s => Array.isArray(s.children) && s.children.length > 0);
    assert.ok(rootWithChildren, "Expected at least one root session with children");
    assert.ok(
      rootWithChildren?.children?.some(c => c.hasParentSession),
      "Expected nested child session to report hasParentSession=true",
    );
  });
});
