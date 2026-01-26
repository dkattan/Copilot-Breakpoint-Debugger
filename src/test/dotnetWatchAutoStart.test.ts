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

describe("dotnet watch auto-start", function () {
  this.timeout(240000);

  let dotnetWatchPid: number | undefined;

  afterEach(async () => {
    await stopAllDebugSessions();

    if (typeof dotnetWatchPid === "number") {
      try {
        process.kill(dotnetWatchPid, "SIGTERM");
      }
      catch {
        // Best-effort cleanup; the process may already be gone.
      }
      dotnetWatchPid = undefined;
    }
  });

  it("auto-starts the dotnet watch task and can still trigger a breakpoint", async () => {
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

    const watcherTaskLabel = "dotnet watch (workspace dotnet)";

    // Capture the spawned watcher process id so we can terminate it after the test.
    const pidPromise = new Promise<number>((resolve) => {
      const disposable = vscode.tasks.onDidStartTaskProcess((event) => {
        if (event.execution.task.name !== watcherTaskLabel) {
          return;
        }
        if (typeof event.processId !== "number") {
          return;
        }
        disposable.dispose();
        resolve(event.processId);
      });
    });

    // Sanity check: the task should not already be running at test start.
    assert.ok(
      !vscode.tasks.taskExecutions.some(exec => exec.task.name === watcherTaskLabel),
      `Expected watcher task not to be running yet: ${watcherTaskLabel}`,
    );

    const startStop = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run node/server.js",
      timeoutSeconds: 120,
      mode: "inspect",
      watcherTaskLabel,
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

    dotnetWatchPid = await pidPromise;

    assert.strictEqual(
      startStop.frame.line,
      readyLine,
      "Did not pause at expected serverReady line",
    );

    assert.ok(
      vscode.tasks.taskExecutions.some(exec => exec.task.name === watcherTaskLabel),
      `Expected watcher task to be running after auto-start: ${watcherTaskLabel}`,
    );

    const sessionId = startStop.debuggerState.sessionId;
    assert.ok(sessionId, "Expected debuggerState.sessionId in inspect mode");

    const triggerStop = await triggerBreakpointAndWaitForStop({
      sessionId,
      timeoutSeconds: 60,
      mode: "inspect",
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
