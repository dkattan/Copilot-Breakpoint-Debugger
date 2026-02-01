import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { startDebuggingAndWaitForStop } from "../session";
import {
  activateCopilotDebugger,
  createNodeServerDebugConfig,
  getExtensionRoot,
  getFreePort,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

// Test serverReady optional breakpoint: when hit, run a command and auto-continue to user breakpoint.
// We use a simple HTTP server (server.js) that sets a flag on listen callback.
// The serverReady breakpoint targets the assignment line. Command does a curl-like request using node: https module via PowerShell Invoke-WebRequest availability uncertain in test harness.

describe("serverReady breakpoint", function () {
  // These tests launch a Node debug session + run serverReady actions; under full-suite load
  // the adapter startup and initial stop can be significantly slower than in isolation.
  this.timeout(240000);
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it("runs command at serverReady breakpoint then pauses at user breakpoint", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");
    const userScriptPath = serverPath; // set user breakpoint after serverReady
    const port = await getFreePort();
    const serverConfig = createNodeServerDebugConfig({ workspaceFolder, port });

    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    // Find serverReady line (contains marker comment)
    const readyLine
      = serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes("LINE_FOR_SERVER_READY")) + 1; // convert to 1-based
    assert.ok(readyLine > 0, "Did not find serverReady marker line");

    const userBreakpointSnippet = "TICK_FOR_USER_BREAKPOINT";
    const userBreakpointLine
      = serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(userBreakpointSnippet)) + 1;
    assert.ok(
      userBreakpointLine > 0,
      "Did not find expected user breakpoint snippet line",
    );

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: serverConfig,
      timeoutSeconds: 180,
      breakpointConfig: {
        breakpoints: [
          {
            path: userScriptPath,
            code: userBreakpointSnippet,
            variable: "started",
            onHit: "break",
          },
        ],
      },
      serverReady: {
        trigger: { path: serverPath, line: readyLine },
        action: {
          type: "shellCommand",
          shellCommand:
            `node -e "require('node:http').get('http://localhost:${port}/health', r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log('health='+d));});"`,
        },
      },
    });
    assert.strictEqual(
      context.serverReadyInfo.configured,
      true,
      "serverReady should be reported as configured",
    );
    assert.strictEqual(
      context.serverReadyInfo.triggerMode,
      "breakpoint",
      "serverReady trigger mode should be breakpoint",
    );
    assert.ok(
      context.serverReadyInfo.phases.some(
        p => p.phase === "entry" || p.phase === "late",
      ),
      `Expected serverReady action to execute for breakpoint trigger, but phases were: ${JSON.stringify(
        context.serverReadyInfo.phases,
      )}`,
    );
    assert.ok(
      context.serverReadyInfo.triggerSummary?.includes("Breakpoint"),
      `Expected serverReady trigger summary to mention Breakpoint, but was: ${context.serverReadyInfo.triggerSummary}`,
    );

    // Assert we stopped at the user breakpoint (not serverReady line)
    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      "Did not pause at expected user breakpoint line after serverReady continue",
    );
    // Ensure variable present in pre-collected scope variables.
    // `startDebuggingAndWaitForStop` may terminate the session before returning in
    // safe-by-default singleShot mode, so avoid relying on `activeDebugSession`.
    const collectedNames = new Set(
      (context.scopeVariables ?? [])
        .flatMap(s => s.variables)
        .map(v => v.name),
    );
    assert.ok(
      collectedNames.has("started"),
      "started variable not found in pre-collected scopeVariables",
    );
    // Ensure serverReady breakpoint info processed (hitBreakpoint path/line match user breakpoint, not serverReady)
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing");
    assert.strictEqual(
      context.hitBreakpoint?.line,
      userBreakpointLine,
      "hitBreakpoint line mismatch",
    );
  });

  it("runs httpRequest at serverReady breakpoint then pauses at user breakpoint", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");
    const port = await getFreePort();
    const serverConfig = createNodeServerDebugConfig({ workspaceFolder, port });
    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);
    const readyLine
      = serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes("LINE_FOR_SERVER_READY")) + 1;
    assert.ok(readyLine > 0, "Did not find serverReady marker line");
    const userBreakpointSnippet = "TICK_FOR_USER_BREAKPOINT";
    const userBreakpointLine
      = serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(userBreakpointSnippet)) + 1;
    assert.ok(
      userBreakpointLine > 0,
      "Did not find expected user breakpoint snippet line",
    );
    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: serverConfig,
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
        trigger: { path: serverPath, line: readyLine },
        action: { type: "httpRequest", url: `http://localhost:${port}/health` },
      },
    });

    assert.strictEqual(
      context.serverReadyInfo.configured,
      true,
      "serverReady should be reported as configured (httpRequest)",
    );
    assert.strictEqual(
      context.serverReadyInfo.triggerMode,
      "breakpoint",
      "serverReady trigger mode should be breakpoint (httpRequest)",
    );
    assert.ok(
      context.serverReadyInfo.phases.some(
        p => p.phase === "entry" || p.phase === "late",
      ),
      `Expected serverReady action to execute for breakpoint trigger (httpRequest), but phases were: ${JSON.stringify(
        context.serverReadyInfo.phases,
      )}`,
    );
    assert.ok(
      context.serverReadyInfo.triggerSummary?.includes("Breakpoint"),
      `Expected serverReady trigger summary to mention Breakpoint (httpRequest), but was: ${context.serverReadyInfo.triggerSummary}`,
    );
    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      "Did not pause at expected user breakpoint line after serverReady continue (httpRequest)",
    );
    assert.ok(context.hitBreakpoint, "hitBreakpoint missing (httpRequest)");
    assert.strictEqual(
      context.hitBreakpoint?.line,
      userBreakpointLine,
      "hitBreakpoint line mismatch (httpRequest)",
    );
  });

  it("runs action when serverReady pattern matches output", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "serverPattern.js");
    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);
    const lines = serverDoc.getText().split(/\r?\n/);
    const patternLine
      = lines.findIndex(l => l.includes("PATTERN_READY_LINE")) + 1;
    const userBreakpointSnippet
      = lines.find(l => l.includes("USER_BREAKPOINT_TARGET")) ?? "";
    const userBreakpointLine
      = lines.findIndex(l => l.includes("USER_BREAKPOINT_TARGET")) + 1;
    assert.ok(patternLine > 0, "Did not find pattern trigger line");
    assert.ok(userBreakpointSnippet, "Did not find user breakpoint snippet");
    assert.ok(
      userBreakpointLine > patternLine,
      "Unexpected user breakpoint line ordering",
    );
    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: "Run node/serverPattern.js",
      timeoutSeconds: 90,
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            code: userBreakpointSnippet,
            variable: "readyHits",
            onHit: "break",
          },
        ],
      },
      serverReady: {
        trigger: {
          pattern: "Pattern server listening on http://localhost:31338",
        },
        action: { type: "httpRequest", url: "http://localhost:31338/health" },
      },
    });
    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      "Did not pause at expected user breakpoint line after serverReady pattern",
    );
    assert.strictEqual(
      context.serverReadyInfo.triggerMode,
      "pattern",
      "serverReady trigger mode should be pattern",
    );
    assert.ok(
      context.serverReadyInfo.phases.some(
        phase => phase.phase === "immediate",
      ),
      "serverReady pattern should execute immediate phase",
    );
    assert.ok(
      context.serverReadyInfo.triggerSummary
        ?.toLowerCase()
        .includes("debug output")
        || context.serverReadyInfo.triggerSummary
          ?.toLowerCase()
          .includes("terminal"),
      "serverReady trigger summary should describe pattern hit source",
    );
  });

  it("demo scenario: httpRequest includes query param and captures queryParam at API handler breakpoint", async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const demoRequestPath = path.join(extensionRoot, "demoRequest.json");
    const sharedRequest = JSON.parse(
      fs.readFileSync(demoRequestPath, { encoding: "utf8" }),
    ) as {
      workspaceFolder: string
      configurationName: string
      breakpointConfig: {
        breakpoints: Array<{
          path: string
          code: string
          variable: string
          onHit: "break" | "captureAndContinue" | "captureAndStopDebugging"
        }>
      }
      serverReady: {
        trigger: { pattern: string }
        action: { type: "httpRequest", url: string }
      }
    };

    assert.strictEqual(
      sharedRequest.workspaceFolder,
      "__WORKSPACE_B__",
      `demoRequest.json workspaceFolder must be '__WORKSPACE_B__' placeholder, got: ${String(
        sharedRequest.workspaceFolder,
      )}`,
    );

    const workspaceFolder = path.join(extensionRoot, "test-workspace", "node");
    const serverPath = path.join(workspaceFolder, "server.js");
    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    assert.ok(
      sharedRequest.breakpointConfig?.breakpoints?.length === 1,
      "demoRequest.json breakpointConfig.breakpoints must contain exactly 1 breakpoint",
    );

    const demoBreakpoint = sharedRequest.breakpointConfig.breakpoints[0];
    assert.strictEqual(
      demoBreakpoint.path,
      "server.js",
      `demoRequest.json breakpoint path must be 'server.js', got: ${String(
        demoBreakpoint.path,
      )}`,
    );

    const apiBreakpointSnippet = demoBreakpoint.code;
    const apiBreakpointLine
      = serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(apiBreakpointSnippet)) + 1;
    assert.ok(
      apiBreakpointLine > 0,
      "Did not find expected API query breakpoint snippet line",
    );

    const readyPattern = sharedRequest.serverReady.trigger.pattern;

    const context = await startDebuggingAndWaitForStop({
      sessionName: "",
      workspaceFolder,
      nameOrConfiguration: sharedRequest.configurationName,
      timeoutSeconds: 180,
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            code: apiBreakpointSnippet,
            variable: demoBreakpoint.variable,
            onHit: demoBreakpoint.onHit,
          },
        ],
      },
      serverReady: {
        trigger: { pattern: readyPattern },
        action: {
          type: "httpRequest",
          url: sharedRequest.serverReady.action.url,
        },
      },
    });

    assert.strictEqual(
      context.serverReadyInfo.triggerMode,
      "pattern",
      "serverReady trigger mode should be pattern (demo scenario)",
    );
    assert.ok(
      context.serverReadyInfo.phases.some(phase => phase.phase === "immediate"),
      "serverReady pattern should execute immediate phase (demo scenario)",
    );
    assert.ok(
      typeof context.frame.line === "number" && context.frame.line > apiBreakpointLine,
      "Expected default step-over to advance past the API handler breakpoint line before capture",
    );
    assert.strictEqual(context.hitBreakpoint?.line, apiBreakpointLine);

    const queryParamVar = (context.scopeVariables ?? [])
      .flatMap(scope => scope.variables)
      .find(v => v.name === "queryParam");

    assert.ok(
      queryParamVar,
      "queryParam variable not found in pre-collected scopeVariables",
    );
    assert.ok(
      String(queryParamVar?.value).includes("from-demo"),
      `Expected queryParam to include 'from-demo', but was: ${String(
        queryParamVar?.value,
      )}`,
    );
  });
});
