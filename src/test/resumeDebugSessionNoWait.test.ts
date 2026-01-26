import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { resumeDebugSessionWithoutWaiting, startDebuggingAndWaitForStop } from "../session";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

describe("resumeDebugSession(waitForStop=false)", function () {
  // These tests launch and inspect live debug sessions; allow extra time under CI or loaded machines.
  this.timeout(240_000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("resumes and returns promptly without waiting for next stop", async () => {
    const extensionRoot = getExtensionRoot();
    const workspaceRelative = "test-workspace/node";
    const scriptRelative = `${workspaceRelative}/test.js`;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      folder => folder.name === "workspace-node",
    )?.uri.fsPath;
    assert.ok(workspaceFolder, "Workspace folder 'workspace-node' not found");

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const loopSnippet = "Loop iteration";
    const doc = await vscode.workspace.openTextDocument(scriptUri);
    const lineInsideLoop
      = doc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(loopSnippet)) + 1;
    assert.ok(lineInsideLoop > 0, "Did not find loop snippet line");

    const stopInfo = await startDebuggingAndWaitForStop({
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      mode: "inspect",
      timeoutSeconds: 180,
      sessionName: "",
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            code: loopSnippet,
            onHit: "break",
            variable: "i",
          },
        ],
      },
    });

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "Expected an active debug session after start");
    assert.strictEqual(
      activeSession.id,
      stopInfo.debuggerState.sessionId,
      "Expected stopInfo session id to match active session",
    );

    const started = Date.now();
    const result = await Promise.race([
      resumeDebugSessionWithoutWaiting({ sessionId: activeSession.id }),
      new Promise<{ sessionId: string, sessionName: string }>((_resolve, reject) => {
        setTimeout(() => reject(new Error("resumeDebugSessionWithoutWaiting timed out")), 5_000);
      }),
    ]);
    const elapsedMs = Date.now() - started;

    assert.ok(
      elapsedMs < 5_000,
      `Expected resume to return quickly, but took ${elapsedMs}ms`,
    );
    assert.strictEqual(result.sessionId, activeSession.id);
    assert.ok(result.sessionName.length > 0);
  });
});
