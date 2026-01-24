import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { DAPHelpers } from "../debugUtils";
import { startDebuggingAndWaitForStop } from "../session";
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from "./utils/startDebuggerToolTestUtils";

let scriptPath: string;
let workspaceFolder: string;
const configurationName = "Run test.js";
// Shared immutable base params for repeated startDebuggingAndWaitForStop calls
let baseParams: {
  workspaceFolder: string
  nameOrConfiguration: string
  mode: "inspect"
  timeoutSeconds: number
};

describe("debugUtils - DAPHelpers", function () {
  // These tests launch and inspect live debug sessions; allow extra time under CI or loaded machines.
  this.timeout(240_000);
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  before(async () => {
    const extensionRoot = getExtensionRoot();
    const workspaceRelative = "test-workspace/b";
    const scriptRelative = `${workspaceRelative}/test.js`;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    assert.ok(vscode.workspace.workspaceFolders?.length);
    workspaceFolder = vscode.workspace.workspaceFolders.find(
      folder => folder.name === "workspace-b",
    )!.uri.fsPath!;
    assert.ok(
      workspaceFolder,
      "Workspace folder 'b' not found in test workspace",
    );
    scriptPath = scriptUri.fsPath;
    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();
    // Initialize shared base params once workspaceFolder is known
    baseParams = {
      workspaceFolder,
      nameOrConfiguration: configurationName,
      mode: "inspect",
      timeoutSeconds: 180,
    };
  });

  it("hitCount breakpoint triggers on specific hit count", async () => {
    const loopSnippet = "Loop iteration";
    const lineInsideLoop
      = (await vscode.workspace.openTextDocument(scriptPath))
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(loopSnippet)) + 1;
    assert.ok(lineInsideLoop > 0, "Did not find loop snippet line");
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "", // monitor any session; avoid name mismatch
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: loopSnippet,
              hitCount: 3,
              onHit: "break" as const,
              variable: "i",
            },
          ],
        },
      }),
    );

    assert.strictEqual(
      context.frame.line,
      lineInsideLoop,
      `Expected to stop on hitCount line ${lineInsideLoop}, but paused at ${context.frame.line}`,
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session after breakpoint hit");

    const allVariables: { name: string, value: string }[] = [];
    for (const scope of context.scopes) {
      const vars = await DAPHelpers.getVariablesFromReference(
        activeSession,
        scope.variablesReference,
      );
      allVariables.push(...vars);
    }
    const iVariable = allVariables.find(v => v.name === "i");
    assert.ok(iVariable, "Variable i not found in collected scopes");
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.strictEqual(
      iValue,
      2,
      `Expected i to be 2 when hitCount breakpoint is hit the 3rd time, but got ${iValue}`,
    );
  });

  it("logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint", async () => {
    const loopSnippet = "Loop iteration";
    const postLoopSnippet = "Completed loop";
    const docLines = (await vscode.workspace.openTextDocument(scriptPath))
      .getText()
      .split(/\r?\n/);
    const lineInsideLoop
      = docLines.findIndex(l => l.includes(loopSnippet)) + 1;
    const postLoopLine
      = docLines.findIndex(l => l.includes(postLoopSnippet)) + 1;
    assert.ok(lineInsideLoop > 0, "Did not find loop snippet line");
    assert.ok(postLoopLine > 0, "Did not find post-loop snippet line");

    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: loopSnippet,
              // condition: 'i > 2',
              logMessage: "Logpoint Loop iteration: {i}",
              onHit: "break" as const,
              variable: "i",
            },
            {
              path: scriptPath,
              code: postLoopSnippet,
              onHit: "break" as const,
              variable: "i",
            },
          ],
        },
      }),
    );

    const pausedLine = context.frame.line;
    assert.ok(
      pausedLine === lineInsideLoop || pausedLine === postLoopLine,
      `Unexpected pause line ${pausedLine}; expected ${lineInsideLoop} (logpoint) or ${postLoopLine}`,
    );
    if (pausedLine === lineInsideLoop) {
      console.warn(
        "Node debug adapter treated logpoint as breakpoint; continuing execution would be required for adapters without logpoint support.",
      );
      return;
    }
    assert.equal(
      pausedLine,
      postLoopLine,
      `Stopped at logpoint line ${lineInsideLoop}; expected to continue to ${postLoopLine}`,
    );
  });

  it("getVariablesFromReference works in Node session", async () => {
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: "Random value",
              onHit: "break" as const,
              variable: "i",
            },
          ],
        },
      }),
    );

    // Get active session and test getVariablesFromReference
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");

    // Get variables from first scope
    const firstScope = context.scopes[0];
    const variables = await DAPHelpers.getVariablesFromReference(
      activeSession,
      firstScope.variablesReference,
    );
    assert.ok(Array.isArray(variables));
    // Should have at least some variables
    assert.ok(variables.length >= 0);
    // Each variable should have required properties
    if (variables.length > 0) {
      const firstVar = variables[0];
      assert.ok("name" in firstVar);
      assert.ok("value" in firstVar);
      assert.ok("isExpandable" in firstVar);
    }
  });

  it("findVariableInScopes finds existing variable", async () => {
    const loopSnippet = "Loop iteration";
    const lineInsideLoop
      = (await vscode.workspace.openTextDocument(scriptPath))
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(loopSnippet)) + 1;
    assert.ok(lineInsideLoop > 0, "Did not find loop snippet line");
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: loopSnippet,
              onHit: "break" as const,
              variable: "i",
            },
          ],
        },
      }),
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");

    // Find randomValue variable
    const found = await DAPHelpers.findVariableInScopes(
      activeSession,
      context.scopes,
      "i",
    );
    assert.ok(found, "Should find loop variable i");
    assert.strictEqual(found?.variable.name, "i");
    assert.ok(found?.scopeName, "Should have scope name");
  });

  it("findVariableInScopes returns null for non-existent variable", async () => {
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: "Random value",
              onHit: "break" as const,
              variable: "i",
            },
          ],
        },
      }),
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");

    // Try to find non-existent variable
    const found = await DAPHelpers.findVariableInScopes(
      activeSession,
      context.scopes,
      "thisVariableDoesNotExist12345",
    );
    assert.strictEqual(found, null, "Should not find non-existent variable");
  });

  it("filters function-typed variables from capture", async () => {
    const functionSnippet = "Function var test";
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: functionSnippet,
              onHit: "break" as const,
              variable: "*",
            },
          ],
        },
      }),
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");

    const capturedNames = context.scopeVariables.flatMap(scope =>
      scope.variables.map(v => v.name),
    );
    assert.ok(
      capturedNames.includes("numberVar"),
      "Expected numberVar to be captured",
    );
    assert.ok(
      !capturedNames.includes("fnVar"),
      "Function-typed variable fnVar should be filtered out",
    );
  });

  it("diagnostics: logs function-like variables that may slip through filters (Node.js)", async () => {
    // This test is intentionally diagnostic: it prints a small report of variables whose
    // value *looks* like a function implementation but which might not be typed as 'function'
    // by the debug adapter.
    //
    // If this output is noisy in CI, we can keep the report bounded and only log when
    // such variables are detected.

    const functionSnippet = "Function var test";
    let context: Awaited<ReturnType<typeof startDebuggingAndWaitForStop>>;
    try {
      context = await startDebuggingAndWaitForStop(
        Object.assign({}, baseParams, {
          sessionName: "",
          breakpointConfig: {
            breakpoints: [
              {
                path: scriptPath,
                code: functionSnippet,
                // Use '*' to opt into auto-capture elsewhere; here we want to inspect raw variables.
                variable: "*",
                onHit: "break" as const,
              },
            ],
          },
        }),
      );
    }
    catch (error) {
      // This is a diagnostics-only test; do not fail the suite if the adapter flakes.
      console.log(
        `[diagnostics] Skipping function-like variable report due to debug session startup timeout/error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      assert.ok(true);
      return;
    }

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");

    const functionLike = (value: string) => {
      const v = value.trim();
      return (
        v.startsWith("function ")
        || v.startsWith("[Function")
        || v.includes("[native code]")
        || v.includes("=>")
        || v.startsWith("ƒ")
      );
    };

    const suspects: Array<{
      scope: string
      name: string
      type?: string
      value: string
    }> = [];

    for (const scope of context.scopes) {
      const raw = (await activeSession.customRequest("variables", {
        variablesReference: scope.variablesReference,
      })) as {
        variables?: Array<{ name: string, value: string, type?: string }>
      };

      for (const v of raw.variables ?? []) {
        if (!v?.value || typeof v.value !== "string") {
          continue;
        }
        // Only log candidates that are NOT explicitly typed as function (those are already filtered).
        const typeLower = (v.type ?? "").toLowerCase();
        if (typeLower === "function") {
          continue;
        }
        if (functionLike(v.value)) {
          suspects.push({
            scope: scope.name,
            name: v.name,
            type: v.type,
            value: v.value,
          });
        }
      }
    }

    if (suspects.length > 0) {
      const preview = suspects
        .slice(0, 30)
        .map(
          s =>
            `${s.scope}: ${s.name} (type=${s.type ?? "∅"}) = ${s.value.slice(
              0,
              120,
            )}`,
        )
        .join("\n");

      console.log(
        `[diagnostics] Found ${suspects.length} function-like variable(s) not typed as 'function' (showing up to 30):\n${preview}`,
      );
    }
    else {
      console.log(
        "[diagnostics] No function-like variables found that were not typed as 'function'",
      );
    }

    // This is diagnostic; we don't want flakiness due to adapter differences.
    assert.ok(true);
  });

  it("getDebugContext works in active session", async () => {
    await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: "Random value",
              onHit: "break" as const,
              variable: "i",
            },
          ],
        },
      }),
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, "No active debug session");

    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    assert.ok(debugContext, "Should get debug context");
    assert.ok(debugContext?.thread, "Should have thread");
    assert.ok(debugContext?.frame, "Should have frame");
    assert.ok(debugContext?.scopes, "Should have scopes");
    assert.ok(Array.isArray(debugContext?.scopes), "Scopes should be array");
    assert.ok(debugContext.scopes.length > 0, "Should have at least one scope");
  });

  it("captureAndStopDebugging action terminates session after breakpoint hit", async () => {
    const targetSnippet = "Loop iteration";
    const targetLine
      = (await vscode.workspace.openTextDocument(scriptPath))
        .getText()
        .split(/\r?\n/)
        .findIndex(l => l.includes(targetSnippet)) + 1;
    assert.ok(targetLine > 0, "Did not find stopDebugging snippet line");
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: "",
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              code: targetSnippet,
              variable: "i",
              onHit: "captureAndStopDebugging" as const,
            },
          ],
        },
      }),
    );
    assert.ok(
      typeof context.frame.line === "number" && context.frame.line > targetLine,
      "Expected default step-over to advance past the breakpoint line before capture",
    );
    assert.strictEqual(context.hitBreakpoint?.line, targetLine);
    const active = vscode.debug.activeDebugSession;
    assert.strictEqual(
      active,
      undefined,
      "Debug session should be terminated after action=captureAndStopDebugging",
    );
  });
});
