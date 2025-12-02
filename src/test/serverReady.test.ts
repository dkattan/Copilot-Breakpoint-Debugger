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

// Test serverReady optional breakpoint: when hit, run a command and auto-continue to user breakpoint.
// We use a simple HTTP server (server.js) that sets a flag on listen callback.
// The serverReady breakpoint targets the assignment line. Command does a curl-like request using node: https module via PowerShell Invoke-WebRequest availability uncertain in test harness.

describe("serverReady breakpoint", () => {
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("runs command at serverReady breakpoint then pauses at user breakpoint", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "b");
    const serverPath = path.join(workspaceFolder, "server.js");
    const userScriptPath = serverPath; // set user breakpoint after serverReady

    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    // Find serverReady line (contains marker comment)
    const readyLine =
      serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes("LINE_FOR_SERVER_READY")) + 1; // convert to 1-based
    assert.ok(readyLine > 0, "Did not find serverReady marker line");

    const userBreakpointLine = readyLine + 1; // next line (console.log)

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run b/server.js",
      breakpointConfig: {
        breakpoints: [
          {
            path: userScriptPath,
            line: userBreakpointLine,
            variableFilter: ["started"],
            action: "break",
          },
        ],
      },
      serverReady: {
        trigger: { path: serverPath, line: readyLine },
        action: {
          type: "shellCommand",
          shellCommand:
            "node -e \"require('node:http').get('http://localhost:31337/health', r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log('health='+d));});\"",
        },
      },
    });

    // Assert we stopped at the user breakpoint (not serverReady line)
    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      "Did not pause at expected user breakpoint line after serverReady continue"
    );
    // Ensure variable present in scopes
    // Collect variables via DAPHelpers for each scope
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");
    const variablesByScope = await Promise.all(
      context.scopes.map(async (s) => {
        const vars = await activeSession.customRequest("variables", {
          variablesReference: s.variablesReference,
        });
        return (vars.variables || []).map(
          (v: { name?: string; evaluateName?: string }) =>
            v.name || v.evaluateName
        );
      })
    );
    const flatNames = new Set(variablesByScope.flat());
    const foundStarted = flatNames.has("started");
    assert.ok(foundStarted, "started variable not found in scopes");
    // Ensure serverReady breakpoint info processed (hitBreakpoint path/line match user breakpoint, not serverReady)
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing");
    assert.strictEqual(
      context.hitBreakpoint?.line,
      userBreakpointLine,
      "hitBreakpoint line mismatch"
    );
  });

  it("runs httpRequest at serverReady breakpoint then pauses at user breakpoint", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "b");
    const serverPath = path.join(workspaceFolder, "server.js");
    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);
    const readyLine =
      serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes("LINE_FOR_SERVER_READY")) + 1;
    assert.ok(readyLine > 0, "Did not find serverReady marker line");
    const userBreakpointLine = readyLine + 1;
    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run b/server.js",
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            line: userBreakpointLine,
            variableFilter: ["started"],
            action: "break",
          },
        ],
      },
      serverReady: {
        trigger: { path: serverPath, line: readyLine },
        action: { type: "httpRequest", url: "http://localhost:31337/health" },
      },
    });
    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      "Did not pause at expected user breakpoint line after serverReady continue (httpRequest)"
    );
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing (httpRequest)");
    assert.strictEqual(
      context.hitBreakpoint?.line,
      userBreakpointLine,
      "hitBreakpoint line mismatch (httpRequest)"
    );
  });
});
