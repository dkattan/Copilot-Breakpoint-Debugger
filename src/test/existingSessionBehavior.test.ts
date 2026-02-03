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

describe("existingSessionBehavior", function () {
  this.timeout(240000);

  afterEach(async () => {
    await stopAllDebugSessions();
    // Reset settings to defaults to avoid cross-test coupling.
    await vscode.workspace
      .getConfiguration("copilot-debugger")
      .update(
        "supportsMultipleDebugSessions",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    await vscode.workspace
      .getConfiguration("copilot-debugger")
      .update(
        "existingSessionBehavior",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
  });

  it("throws when multiple sessions exist and behavior=useExisting and no sessionId provided", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace");
    const testFilePath = path.join(workspaceFolder, "test.js");

    const doc = await vscode.workspace.openTextDocument(testFilePath);
    await openScriptDocument(doc.uri);
    const text = doc.getText();
    const marker = "console.log(\"Running test.js inside test-workspace\");";
    assert.ok(text.includes(marker), "Expected test.js to include marker line");

    // Start two paused sessions (inspect mode) against a non-port-binding script.
    await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      timeoutSeconds: 120,
      mode: "inspect",
      breakpointConfig: {
        breakpoints: [
          {
            path: testFilePath,
            code: marker,
            variable: "*",
            onHit: "break",
          },
        ],
      },
    });
    await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run test.js",
      timeoutSeconds: 120,
      mode: "inspect",
      breakpointConfig: {
        breakpoints: [
          {
            path: testFilePath,
            code: marker,
            variable: "*",
            onHit: "break",
          },
        ],
      },
    });

    const cfg = vscode.workspace.getConfiguration("copilot-debugger");
    await cfg.update(
      "supportsMultipleDebugSessions",
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    await cfg.update(
      "existingSessionBehavior",
      "useExisting",
      vscode.ConfigurationTarget.Workspace,
    );

    await assert.rejects(
      async () => {
        await triggerBreakpointAndWaitForStop({
          workspaceFolder,
          configurationName: "Run test.js",
          // omit sessionId on purpose
          existingSessionBehavior: "useExisting",
          timeoutSeconds: 30,
          mode: "singleShot",
          breakpointConfig: {
            breakpoints: [
              {
                path: testFilePath,
                code: marker,
                variable: "*",
                onHit: "break",
              },
            ],
            breakpointTrigger: {
              type: "vscodeCommand",
              command: "workbench.action.files.newUntitledFile",
            },
          },
        });
      },
      (err: unknown) =>
        err instanceof Error
        && /Multiple active debug sessions found/i.test(err.message),
    );
  });

  it("rejects ignoreAndCreateNew when supportsMultipleDebugSessions=false and sessions exist", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");

    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    // Create an existing session.
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

    const cfg = vscode.workspace.getConfiguration("copilot-debugger");
    await cfg.update(
      "supportsMultipleDebugSessions",
      false,
      vscode.ConfigurationTarget.Workspace,
    );

    await assert.rejects(
      async () => {
        await triggerBreakpointAndWaitForStop({
          workspaceFolder,
          configurationName: "Run node/server.js",
          existingSessionBehavior: "ignoreAndCreateNew",
          timeoutSeconds: 30,
          mode: "singleShot",
          startupBreakpointConfig: {
            breakpoints: [
              {
                path: serverPath,
                code: "LINE_FOR_SERVER_READY",
                variable: "started",
                onHit: "break",
              },
            ],
          },
          breakpointConfig: {
            breakpoints: [
              {
                path: serverPath,
                code: "const queryParamForDebugger = queryParam",
                variable: "queryParamForDebugger",
                onHit: "break",
              },
            ],
            breakpointTrigger: {
              type: "httpRequest",
              url: "http://localhost:1/api/echo?q=hello",
            },
          },
        });
      },
      (err: unknown) =>
        err instanceof Error
        && /supportsMultipleDebugSessions=false/i.test(err.message),
    );
  });
});
